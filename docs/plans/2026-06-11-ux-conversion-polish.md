# UX / Conversion Polish — 2026-06-11

Goal: make the core journey (landing → pricing → screener → signin) complete, lovable, and honest, without architecture rewrites. Branch `ux-polish`, one concern per commit, build gate `npm run build` (330 pages) after each.

## Finding 1 — Marketing surfaces show losing stats computed with the wrong denominator (CRITICAL)

Production today:

- Landing ProofHero: `Cumulative P&L (30d) -195.67%`, `Profit factor 0.85`, `Recent win rate 26%`
- Pricing stat bar: `37.9% win rate`, `-38.2% cumulative PnL`

Two distinct causes:

1. **Denominator bug.** `lib/pricing-stats.ts` and `lib/landing-stats.ts` do not exclude `gate_blocked` rows. The canonical predicate `isCountedResolved` (lib/signal-history.ts:37) excludes simulated, gate-blocked, and zero-pnl placeholder rows, and its doc comment says to use it for every public denominator (`/api/signals/history`, `/api/signals/equity`, `/api/leaderboard` already do). Verified against production API: canonical all-time = 3,256 resolved, 38.8% WR, +86.1% summed 24h PnL (+107.5% equity return), break-even WR 36.9%. The landing's -195.67% becomes -60.9% under the canonical 30d computation — the rest of the gap is gate-blocked rows the engine refused to trade.
2. **Framing defect.** The 30d window is genuinely red right now (canonical 30d: 34.4% WR, -60.9%); all profit came from the earlier period. The entire history is <90 days old. Leading marketing surfaces with a transient red window while the true all-time record is profitable is self-sabotage; hiding red entirely would be dishonest. Honest middle: show clearly-labeled all-time canonical stats with break-even/payoff context, keep /track-record as the full-transparency surface (equity curve includes the recent drawdown).

Fix (layered commits):

- `fix(stats)`: add `AND COALESCE(gate_blocked, false) = FALSE` to all queries in `lib/pricing-stats.ts` and `lib/landing-stats.ts`; switch both to all-time window; add payoff/break-even aggregates. Extend `lib/__tests__/pricing-stats.test.ts`.
- `feat(pricing)`: stat bar shows all-time canonical WR / resolved count / cumulative PnL + one caption line: wins-vs-losses payoff and break-even win rate, linking to /track-record.
- `feat(landing)`: ProofHero tiles use all-time canonical stats, relabel "(30d)" → since-launch framing, replace `Recent win rate` tile (recent-100 window) with all-time WR + break-even subtext.

Product call flagged for review: marketing surfaces switch from 30d to all-time framing. Decided autonomously because the 30d framing currently shows engine-refused trades as losses and contradicts /track-record's own math.

## Finding 2 — Onboarding checklist renders for anonymous visitors (HIGH, pending verification)

"Getting Started" panel mounts for anonymous visitors on /, /signin, /today; covers the hero on 390px mobile. Audit agent confirming mount conditions + fix (hide for anonymous or collapse on mobile).

## Finding 3+ — pending audit agents

- Screener default-filter empty state ("8 of 37" tiles vs "No assets match your filters" table contradiction).
- /today loading skeleton (lone spinner pre-hydration).
- Possible duplicated footer on mobile landing.
- Nav dead links, mobile overflow, perf/static-ification wins.

## Verification

- `npm run build` green, 330 pages, after every commit.
- Jest: `pricing-stats` suite green (DB-latency flake in paper-trading-db is known, not a gate).
- Post-deploy: curl tradeclaw.win/pricing + / and confirm rendered stats match the canonical API numbers; screenshot before/after.

## Deploy

GitHub auto-deploy is OFF. PR to naimkatiman/tradeclaw, then `railway up --detach` from repo root (linked to tradeclaw/production/web).
