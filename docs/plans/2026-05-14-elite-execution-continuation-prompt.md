# Continuation Prompt — Elite plan + Broker Automation

> Paste this entire file into a fresh Claude Code (or other agent) session
> rooted at `/home/naim/.openclaw/workspace/tradeclaw/`. It contains every
> load-bearing fact, file path, and acceptance bar needed to keep building
> without re-onboarding.

---

## Mission

Ship TradeClaw **Elite** — a paid tier that auto-executes the production
`hmm-top3` signals on the user's own demo broker accounts (Binance Futures
Testnet first, RoboForex R StocksTrader second). The current Elite surface
is waitlist-only; the goal is to convert it into a working product.

Two parallel tracks:
- **Track A — Productize Elite**: pricing, entitlement, key-storage, UI.
- **Track B — Finish broker automation**: realized-PnL backfill on Binance,
  R StocksTrader bridge + executor multi-broker dispatch.

Track B must validate the published track record on a 30-day demo soak
before Track A opens to paying users.

---

## Operating rules (read before writing any code)

1. Read [/home/naim/.openclaw/workspace/CLAUDE.md](../../../CLAUDE.md) and
   the project-level [tradeclaw/CLAUDE.md](../../CLAUDE.md). The "TradeClaw
   — Signal Generation Architecture" section is load-bearing.
2. Production deploys via `railway up --detach` from `tradeclaw/` repo
   root. **GitHub auto-deploy is OFF on the `web` service.** Pushing to
   `main` does NOT deploy.
3. Two writers exist for `signal_history`: request side-effect
   (`tracked-signals.ts`) and the 5-min cron (`/api/cron/signals`). Both
   use `getSignals()` → `generateSignalsFromTA()`. **Only the cron resolves
   4h/24h outcomes.** Do not break this.
4. Never edit `scripts/scanner-engine.py` thinking it changes production.
   It is local-only Python writing to local SQLite. The live engine is
   `apps/web/app/lib/signal-generator.ts` + `ta-engine.ts`.
5. Commit size hard limit: ≤15 files per commit. Split by layer
   (migration → service → API → UI). Never bundle CI / tooling with
   product changes.
6. After each change, run the smallest check that proves correctness
   (one test, one curl, one `psql`). No "should work" claims.

---

## Current state (as of 2026-05-14)

### Elite product surface (Track A)

- `apps/web/app/pricing/PricingCards.tsx` — Elite shown as "Coming Soon"
- `apps/web/components/EliteInterestForm.tsx` — waitlist + WTP survey
- `apps/web/app/api/elite/interest/route.ts` — POST handler, rate-limited
- `apps/web/lib/elite-interest.ts` — validation + upsert into `elite_interest`
- **No Stripe price for Elite.** `apps/web/lib/stripe-tiers.ts` defines Free
  and Pro only. No entitlement gate. No broker-key UI. No execution scoping
  per user.

### Broker automation (Track B)

Built and working:
- `apps/web/lib/execution/executor.ts` — 60s tick, universe + EMA/ADX
  gates, sizing, bracket orders. Gate-zero symbol-mapping fix landed at
  [executor.ts:16,174](../../apps/web/lib/execution/executor.ts#L174)
  (imports `BINANCE_SYMBOLS`, rewrites `sig.pair → binancePair`).
- `apps/web/lib/execution/binance-futures.ts` — REST client, dry-run mode,
  testnet detection.
- `apps/web/lib/execution/sizing.ts` — risk-first sizing (1% equity,
  1.5× ATR stop, 5× leverage cap).
- `apps/web/lib/execution/risk-rails.ts` — daily/weekly loss kill switches
  via `/fapi/v1/income`.
- `apps/web/lib/execution/position-manager.ts` — SL-to-breakeven on TP1.
- `apps/web/instrumentation.ts:48-65` — self-scheduled cron, gated by
  `EXECUTION_MODE !== 'disabled'`.
- Migration `apps/web/migrations/018_pilot_executions.sql` — creates
  `executions`, `execution_errors`, `universe_snapshots`.

Stubs only (no runtime):
- `apps/web/lib/execution/rstockstrader-bridge.ts` — interface only,
  zero HTTP, comment at line 16 explicitly says "no runtime calls".
- `apps/web/lib/execution/rstockstrader-symbols.ts` — symbol-mapping
  scaffold.
- **No `EXECUTION_BROKER` dispatch in executor.** `grep -n
  EXECUTION_BROKER apps/web/lib/execution/executor.ts` returns nothing.

Known gap:
- `executions.realized_pnl` is **NULL on every row**. The position manager
  marks `status='closed'` but never backfills PnL. The 30-day
  reconciliation SQL in `docs/plans/2026-05-06-demo-binance.md` §4
  cannot run until this is fixed.

### IBKR

Not started. Plan doc only at `docs/plans/2026-05-06-demo-ibkr.md`.
Out of scope for this continuation prompt unless Track B finishes early.

---

## Work plan (do in order)

### Phase 0 — Binance soak (start TODAY, runs passively for 30 days)

Acceptance: a `hmm-top3` signal on a USDT-eligible symbol produces a row in
`executions` on Railway Postgres within 5 minutes.

1. Confirm Zaky has a **Futures Testnet** key from
   `https://testnet.binancefuture.com` (not `testnet.binance.vision`).
2. Set Railway env vars on the `web` service:
   - `BINANCE_API_KEY`, `BINANCE_API_SECRET`
   - `BINANCE_BASE_URL=https://testnet.binancefuture.com`
   - `BINANCE_MARKET_DATA_URL=https://fapi.binance.com`
   - `EXECUTION_MODE=testnet` (after handshake — start `disabled`)
   - `EXEC_RISK_PCT=1`, `EXEC_MAX_LEVERAGE=5`, `EXEC_MAX_POSITIONS=4`
   - `EXEC_DAILY_LOSS_PCT=5`, `EXEC_WEEKLY_LOSS_PCT=12`
   - `EXEC_TELEGRAM_CHAT_ID=<Zaky's private chat>`
3. Apply migration `018_pilot_executions.sql` if not already applied:
   `psql $DATABASE_URL -f apps/web/migrations/018_pilot_executions.sql`
4. `railway up --detach`
5. Handshake: `curl -H "Authorization: Bearer $CRON_SECRET" \
   https://tradeclaw.win/api/cron/execute` — should log
   `EXECUTION_MODE=disabled — tick skipped`.
6. Flip `EXECUTION_MODE=testnet` on Railway. Watch
   `psql $DATABASE_URL -c "SELECT * FROM executions ORDER BY created_at
   DESC LIMIT 5"` for first fill.
7. Set a calendar reminder for day +30.

### Phase 1 — Realized PnL backfill (BLOCKS RECONCILIATION)

Acceptance: every closed `executions` row has a non-null `realized_pnl`
within 60 seconds of `closed_at`.

Approach (pick option A — fewer moving parts):

**Option A — extend `position-manager.ts`:**
- When the manager marks `status='closed'`, fetch the closing fill's
  avgPrice (Binance `GET /fapi/v1/userTrades?symbol=&orderId=`).
- Compute `realized_pnl = (exitPrice - entryPrice) * qty * sideSign`.
  For shorts `sideSign = -1`.
- Subtract `commission` from the userTrades response.
- `UPDATE executions SET realized_pnl=$1, exit_price=$2 WHERE id=$3`.

**Option B — separate income cron:**
- New `/api/cron/income` that pulls `/fapi/v1/income?incomeType=REALIZED_PNL`
  every 5 min, joins on `clientOrderId` prefix → `signal_id`.
- Slower, more independent, harder to reconcile timestamps.

Add a migration for `executions.exit_price NUMERIC` if not present.

Test:
```bash
psql $DATABASE_URL -c "SELECT signal_id, realized_pnl, risk_usd,
  realized_pnl / NULLIF(risk_usd, 0) AS realized_R
  FROM executions WHERE status='closed' ORDER BY closed_at DESC LIMIT 10"
```

### Phase 2 — R StocksTrader implementation

Acceptance: a manual REST POST from the bridge against
`https://stockstrader.roboforex.com/api/...` places a 0.01 lot EUR/USD
demo order, then cancels it.

Required steps (full plan in
[docs/plans/2026-05-08-demo-roboforex-rstockstrader.md](2026-05-08-demo-roboforex-rstockstrader.md)):

1. Zaky pulls `/instruments` from the live API tab and confirms the
   actual symbol codes against §4 of the plan doc. Update
   `rstockstrader-symbols.ts` from the real response.
2. Implement `rstockstrader-bridge.ts`:
   - `getAccountInfo()` — read `equity`, `balance`, `marginFree`.
   - `getInstrumentSpec(symbol)` — cache 1h.
   - `placeBracket({ symbol, side, qty, entry, stop, tp, clientRef })` —
     single REST call with attached SL/TP.
   - `cancelOrder(orderId)`, `getOpenPositions()`.
   - Token-bucket rate limiter (default 10 req/sec — verify from API tab).
   - All writes guarded by `EXECUTION_MODE !== 'disabled'`, identical
     dry-run logging to `binance-futures.ts`.
3. Add `EXECUTION_BROKER` dispatch in `executor.ts`:
   ```ts
   const broker = (process.env.EXECUTION_BROKER ?? 'binance').toLowerCase();
   if (broker === 'r-stockstrader') {
     await runRStocksTraderTick(...);
     return;
   }
   // existing binance path
   ```
   Keep the per-broker code paths separate. Do not try to share an
   abstract "broker" interface on the first pass — it will leak
   asymmetries (MT5 lot vs futures qty, attached vs separate SL/TP).
4. Migration: `executions.broker` is already `VARCHAR(32)` per
   `018_pilot_executions.sql:23` — no schema change needed.
5. Env vars on Railway:
   - `RSTOCKSTRADER_BASE_URL`, `RSTOCKSTRADER_TOKEN`,
     `RSTOCKSTRADER_ACCOUNT_ID`, `EXECUTION_BROKER=r-stockstrader`,
     `EXEC_FX_PER_TRADE_NOTIONAL_PCT=100`,
     `EXEC_STOCK_PER_TRADE_NOTIONAL_PCT=100`,
     `EXEC_CRYPTO_CFD_PER_TRADE_NOTIONAL_PCT=50`.

Day-30 acceptance bar (per plan doc §10):
- Realized R per trade ≥ +0.20R (vs published +0.32R)
- Win rate ≥ 42% (vs published 46%)
- Max drawdown ≤ 35%
- ≥ 60 sized trades placed
- < 3 broker-rejected errors not caught by sizing
- Equity-curve correlation with `outcome_24h`-derived paper curve ≥ 0.85

### Phase 3 — Elite product surface

Only start once Phase 1 reconciliation has 14+ days of data inside the
acceptance band.

1. **Stripe price**: add `STRIPE_PRICE_ELITE` env + entries in
   `apps/web/lib/stripe-tiers.ts`. Two SKUs — `elite-monthly` and
   `elite-yearly`. Provisional pricing pulled from WTP survey median.
2. **Entitlement**: extend `tier` enum (today: `free | pro`) to add
   `elite`. Migration on the `users` table. Update
   `apps/web/components/TierBadge.tsx`, `apps/web/lib/__tests__/tier.test.ts`,
   webhook handler, and any route guards (grep for
   `tier === 'pro'` and `tier !== 'free'` — every site needs review).
3. **Broker-key storage**: new migration `019_user_broker_credentials.sql`
   with `user_id`, `broker` (`binance` | `r-stockstrader`),
   `account_id`, `encrypted_token`, `encrypted_secret`, `mode`
   (`demo` | `live`), `created_at`. Encrypt at rest using
   `BROKER_CREDS_KEY` (32 bytes hex on Railway). AES-256-GCM. Test
   roundtrip locally before deploying.
4. **Per-user executor scoping**: the current executor is single-tenant
   (house keys). Change `executor.ts` to iterate over each Elite user's
   active credential set, scope the cron tick per user. Risk rails
   become per-user too. **This is the most invasive change** —
   consider a new `runPerUserTick(userId)` helper and keep house-key
   path for Phase 0/1 soak.
5. **UI**: `/dashboard/elite` — connect-broker form, position list,
   realized R curve, kill-switch toggle.
6. **Onboarding**: Stripe checkout success → email → in-app prompt to
   add broker credentials → run handshake → flip user's
   `execution_enabled` flag.
7. **Email**: existing trial/missed-pnl pipeline (`75 4da6d801`) can
   piggyback for "your first Elite trade fired" notification.

### Phase 4 — IBKR (defer)

Plan doc exists at `2026-05-06-demo-ibkr.md`. Implement only if Phase 2
soak passes and there is demand for US-stock execution. Requires running
IB Gateway somewhere addressable (not Railway — needs persistent TCP).
Local on Zaky's box is the documented path. Skip if Phase 2 fully
covers the user request.

---

## Hard constraints

- **Never** flip `EXECUTION_MODE=live` until Phase 2 §10 acceptance bar
  is met AND a human (Zaky) has explicitly approved on a per-broker
  basis.
- **Never** store unencrypted broker tokens in Postgres. AES-256-GCM only.
- **Never** ship Phase 3 to paying users while `executions.realized_pnl`
  is still NULL on most rows.
- **Never** edit `apps/web/app/lib/signal-generator.ts` or `ta-engine.ts`
  as part of execution work. Signal generation is upstream — out of
  scope here.
- **Never** add a "broker abstraction" library on the first pass. Keep
  per-broker code paths separate until two are working end-to-end.

---

## Verification checklist before each merge

- `npm run build` from repo root succeeds (workspace rule)
- `npm run test -w apps/web` — relevant unit tests pass
- Migration tested locally against `DATABASE_URL` pointing at a scratch DB
- `EXECUTION_MODE=disabled` is the default in any new env block
- For executor changes: run `apps/web/lib/execution/executor.ts` against
  a single signal in dev (`npm run dev -w apps/web` then post to
  `/api/cron/execute` with the cron secret)
- For UI changes: hit the page in `npm run dev`, do not rely on type
  check alone

---

## Files you will touch (anchor list)

### Track A (Elite product)
- `apps/web/app/pricing/PricingCards.tsx`
- `apps/web/components/EliteInterestForm.tsx`
- `apps/web/lib/stripe-tiers.ts`
- `apps/web/lib/elite-interest.ts`
- `apps/web/app/api/elite/interest/route.ts`
- `apps/web/app/api/stripe/checkout/route.ts`
- `apps/web/app/api/stripe/webhook/route.ts`
- `apps/web/lib/db.ts`
- `apps/web/migrations/019_user_broker_credentials.sql` (new)
- `apps/web/components/TierBadge.tsx`
- `apps/web/app/dashboard/billing/page.tsx`
- `apps/web/app/dashboard/elite/page.tsx` (new)

### Track B (broker automation)
- `apps/web/lib/execution/executor.ts`
- `apps/web/lib/execution/binance-futures.ts`
- `apps/web/lib/execution/position-manager.ts` (PnL backfill)
- `apps/web/lib/execution/rstockstrader-bridge.ts` (currently stub)
- `apps/web/lib/execution/rstockstrader-symbols.ts`
- `apps/web/lib/execution/risk-rails.ts`
- `apps/web/instrumentation.ts`
- `apps/web/app/api/cron/execute/route.ts`
- `apps/web/migrations/018_pilot_executions.sql` (PnL column if needed)

---

## Done definition

Elite is **shippable** when all of these are true:
1. `executions.realized_pnl` is populated on ≥ 95% of closed rows.
2. Binance 30-day soak hits §10 acceptance bar.
3. R StocksTrader 30-day soak hits same bar.
4. Stripe Elite SKUs exist, entitlement flows end-to-end through the
   webhook into the `users.tier` column.
5. A real user can: sign up → pay → enter broker creds (demo) → see
   first auto-execution land within 1 hour.
6. Kill switch (per-user `execution_enabled=false`) halts new orders
   within one cron tick.

Stop when all six are green. Do not keep polishing.
