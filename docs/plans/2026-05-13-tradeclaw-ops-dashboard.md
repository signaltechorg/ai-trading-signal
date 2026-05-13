# TradeClaw Ops Dashboard — Hermes-style operator visibility port

**Date:** 2026-05-13
**Status:** PR 1 scoped, PR 2 + PR 3 sequenced after
**Scope:** `apps/web` only. Reuses existing tables, existing auth, existing cron infra.

## Context

The Roboforex repo carries a design (`2026-05-01-hermes-port-design.md`) that ports
Hermes-style operator visibility — observable artifacts, ranked memory, periodic
surfacing — over a chatbot's existing learning tables. The same play applies to
TradeClaw: the signal engine already records everything an operator needs to see
(`signal_history`, `signal_run_log`, `admin_audit_log`, `pilot_executions`), but
there is no read surface for "is the engine still working, what got blocked,
what is the current state of the cron."

To verify health today an operator has to `psql` the production DB. No one does
that. The signal engine quietly degrades and no one notices until the daily
TC intel cron complains.

This plan builds the read surface. **Zero new tables. Zero new services. Zero
added cost.** Three thin layers over data the system already writes.

## Diagnosis

- **Symptom:** "improvement workflows run but feel insignificant — no visible
  feedback loop, no metrics" — quoted from the Roboforex design, applies 1:1
  to TradeClaw signal-engine ops.
- **Root cause:** Audit data is written (every cron tick writes to
  `signal_run_log`, every blocked signal writes `gate_blocked=true` rows), but
  there is no HTML view, no admin Telegram command, and no daily push.
- **Therefore:** Build the read surface. Do not build more learning, do not
  add more tables.

## Table mapping (Roboforex → TradeClaw)

| Roboforex panel        | TradeClaw equivalent                                              | Data source                                         |
|------------------------|-------------------------------------------------------------------|-----------------------------------------------------|
| Today (last 24h)       | Today                                                             | `signal_history`, `signal_run_log` 24h aggregates   |
| Missed queries         | Gated signals — what the gate refused and why                     | `signal_history WHERE gate_blocked = TRUE`          |
| Experiments            | **Deferred**                                                      | TradeClaw has no `experiments` table; `SIGNAL_ENGINE_PRESET` is tag-only per `workspace/CLAUDE.md` |
| Active lessons         | **Deferred** — no analog yet                                      | n/a                                                  |
| Quality trend          | Win-rate trend (30 day)                                           | `signal_history.outcome_24h` hit/miss bucketed daily |
| Memory inspector       | **Deferred** (no per-user conversation memory in TradeClaw)       | n/a                                                  |

PR 1 ships **Today, Gated, Recent Signals**. PR 4 (deferred) would add Win-rate
trend once PR 1 is live ≥1 week and queries are confirmed cheap.

## What already exists (do not rebuild)

### Tables (Postgres, Railway)
- `signal_history` — every emitted signal + outcomes (003, extended by 005/012/017)
- `signal_run_log` — per-cron-run audit with SHA-256 tamper-evidence (026)
- `admin_audit_log` — admin actions (028)
- `pilot_executions` — open positions, fills, errors (018)
- `processed_stripe_events` — billing audit (019)

### Auth (`lib/admin-gate.ts`)
- `requireAdmin()` server-component guard — Google-OAuth admin email OR
  `tc_admin` cookie matching `ADMIN_SECRET`. Redirects to `/admin/login`
  on failure. Reuse, do not reinvent `?key=` URL auth.

### DB helpers (`lib/db-pool.ts`)
- `query<T>()`, `queryOne<T>()` — parameterized pg queries with typed rows.

### Existing admin shell
- `app/admin/layout.tsx` + `app/admin/page.tsx` — index with stat cards + tiles.
  New /admin/ops route slots in as a tile.

### Cron infra
- `instrumentation.ts` self-schedules `/api/cron/*` every 5 min via `CRON_SECRET`
  bearer. PR 3's daily digest cron rides on the same pattern.

## Architecture

Three thin layers. Each is one commit. Each is one concern.

### Layer 1 — `/admin/ops` HTML dashboard (PR 1)
Server-rendered React server component. Same chrome + style as `/admin/page.tsx`
(zinc + emerald, lucide icons, `force-dynamic`).

Three panels:
1. **Today** — 24h counts: signals emitted, gate-blocked count, latest cron
   run timestamp + verified/win/loss/pending split from the most recent
   `signal_run_log` row.
2. **Gated signals — top 30 by recency** — symbol, direction, gate_reason,
   created_at. The operator can see *which* setups keep getting suppressed.
3. **Recent signals — top 30** — symbol, direction, confidence, 4h/24h
   outcome (hit/miss/pending), strategy_id, created_at.

Files:
- `apps/web/lib/ops-dashboard.ts` — three exported async functions
  returning typed rows: `loadTodayCounts()`, `loadGatedSignals()`,
  `loadRecentSignals()`.
- `apps/web/app/admin/ops/page.tsx` — server component, calls
  `requireAdmin()`, runs the three loaders via `Promise.all`, renders.
- `apps/web/app/admin/page.tsx` — add an "Ops Dashboard" tile linking
  to `/admin/ops`.

### Layer 2 — Admin Telegram commands (PR 2 — separate commit)
Gated by `parseAdminIds(env)` matching existing Telegram admin pattern:
- `/ops today` — last 24h summary (same data as Layer 1 panel 1).
- `/ops gated [n]` — top N most recent gated signals + reasons.
- `/ops recent [n]` — last N signals with outcomes.
- `/ops runs [n]` — last N `signal_run_log` rows.

One new file: `apps/web/lib/telegram-ops-commands.ts`. Wired into existing
Telegram webhook dispatcher.

### Layer 3 — Daily digest cron (PR 3 — separate commit)
- Schedule: `0 23 * * *` (23:00 UTC = 07:00 MYT next day, before Aiman's
  daily improvement cron at ~07:30).
- Pushes Layer 1 "Today" panel to each admin Telegram ID.
- Includes 24h deltas vs prior day (signal count, gate-blocked count, win-rate).
- On data-fetch failure: send a short error notice rather than skipping silently.

One new route: `apps/web/app/api/cron/ops-digest/route.ts`. Auth: bearer
`CRON_SECRET` via existing `requireCronAuth()`.

## Phasing

| PR | Scope                                         | LOC est. | Files |
|----|-----------------------------------------------|----------|-------|
| 1  | `/admin/ops` route, 3 panels                  | ~280     | 3 (+1 edit) |
| 2  | Telegram `/ops *` commands                    | ~150     | 1 + edits   |
| 3  | Daily digest cron                             | ~120     | 1 + register |
| 4  | Win-rate trend panel — deferred               | ~120     | 2           |

Each PR is one concern. Per global CLAUDE.md: no bundled concerns, ≤15 files
per commit. PR 1 must be live and verified ≥1 day before PR 2 starts.

## Out of scope

- **Experiments panel.** Needs an A/B framework first. `SIGNAL_ENGINE_PRESET`
  is a tag-only env per `workspace/CLAUDE.md` — there is no winner/baseline
  table to render. Revisit only when `getActivePreset()` actually dispatches
  to different generation code.
- **Roboforex `handlers/admin-dashboard.ts`.** That file targets Cloudflare D1
  with SQLite syntax and references tables that do not exist in TradeClaw.
  It is source material to translate from, not code to import.
- **Mutation actions from the dashboard.** Layer 1 is read-only. No
  rollback buttons, no auto-FAQ wrappers — TradeClaw has no equivalents.
- **Public exposure.** `/admin/ops` is admin-only via `requireAdmin()`.
  Do not expose any of this on the public track-record page.

## Verification plan

### After PR 1
- Local: `npm run build -w apps/web` succeeds.
- Local: `npm run dev -w apps/web`, hit `http://localhost:3000/admin/ops`,
  unauthenticated → redirects to `/admin/login`.
- Set `tc_admin` cookie to `ADMIN_SECRET`, reload, see three panels render.
- Each "Today" stat matches `psql` against production:
  ```
  SELECT COUNT(*) FROM signal_history WHERE created_at > NOW() - INTERVAL '24 hours';
  SELECT COUNT(*) FROM signal_history WHERE gate_blocked = TRUE AND created_at > NOW() - INTERVAL '24 hours';
  SELECT * FROM signal_run_log ORDER BY run_started_at DESC LIMIT 1;
  ```
- "Gated" panel rows show `gate_reason` column populated (per migration 017
  guarantee: non-null when `gate_blocked=true`).
- "Recent" panel shows outcome pills (hit/miss/pending) matching
  `signal_history.outcome_24h` JSONB.

### After PR 2
- DM `/ops today` from an admin Telegram ID, get formatted summary.
- DM `/ops gated 10` and verify rows match what `SELECT * FROM signal_history
  WHERE gate_blocked = TRUE ORDER BY created_at DESC LIMIT 10` returns.
- DM from a non-admin Telegram ID, get silently ignored (no leak).

### After PR 3
- Force the cron to run via `curl -X GET -H "Authorization: Bearer $CRON_SECRET"
  https://tradeclaw.win/api/cron/ops-digest` — receive Telegram digest.
- Wait one day, receive scheduled digest at 23:00 UTC.
- Force a data error (temporarily bad SQL in one loader), confirm error notice
  arrives instead of silence.

## Open decisions (not blocking PR 1)

- **Auth model:** stay on `requireAdmin()` (cookie or Google OAuth). No `?key=`
  URL grant. The Roboforex design used URL keys because it was a single-tenant
  Worker; TradeClaw already has session auth.
- **Time window:** 24h hard-coded in PR 1. Add a `?hours=N` query param only
  if operators ask for it.
- **Pagination:** none in PR 1. Top 30 by recency is enough for the daily
  observability use case. Add `LIMIT/OFFSET` only if the table grows useful
  enough that an operator wants to scroll history.

## References

- `apps/web/migrations/003_signal_history.sql` — base table
- `apps/web/migrations/017_gate_blocked.sql` — gate columns (PR 1 Layer 1 panel 2)
- `apps/web/migrations/026_signal_run_log.sql` — per-run audit (PR 1 Layer 1 panel 1)
- `apps/web/migrations/028_admin_audit_log.sql` — admin actions log
- `apps/web/lib/admin-gate.ts` — `requireAdmin()` reused as-is
- `apps/web/lib/db-pool.ts` — `query<T>()` reused as-is
- `apps/web/app/admin/page.tsx` — style + chrome reference
- `Roboforex/Docs/plans/2026-05-01-hermes-port-design.md` — source design
- `workspace/CLAUDE.md` — "TradeClaw — Signal Generation Architecture (load-bearing)"
