# Journey Audit — Deferred (needs-approval) Follow-ups

Date: 2026-05-13
Parent: `2026-05-13-user-journey-audit.md`
Status: queued — none of these have been started

The user-journey audit recommended nine fixes. Five were shipped today as safe inline edits
(variant-label strip, CTA inversion, trial-disclosure copy, risk-reversal, Telegram hero).
Four remain because each requires design decisions, schema changes, or cross-cutting work
that should not be auto-executed. They are scoped below so each can be picked up as a
dedicated branch with explicit approval.

---

## #4 — Dashboard overload (1,462 LOC, 8 competing surfaces)

**Why it's blocked**
- Cutting sections off the dashboard is a product decision, not a refactor. Need to know which surfaces are load-bearing for retention vs. ornamental.
- Risk of regressing the FOMO loop ("Unlocking soon" countdown + Telegram CTAs together are deliberate conversion pressure — strip them and conversion may drop).

**Recommended scope for a future commit**
- Default-collapse `SignalHistory` and `Potential signals` (50–69%) for first-visit sessions; remember expansion state in `localStorage`.
- Replace the three competing Telegram CTAs (`Join free public channel` + `ConnectTelegramButton` + `TelegramInviteBadge`) with one "Get signals on Telegram" pill that opens a modal offering both options based on tier.
- Move `OnboardingOverlay` from bottom-right floater (lines 1455 in `DashboardClient.tsx`) to a sticky top strip until step 1 auto-completes. Bottom-right widgets are dismissed without being read.
- Promote the filter bar (timeframe / direction / asset class) behind a "Filters" disclosure on first visit; keep it expanded for returning sessions.

**Effort:** 1–2 days. Touches `DashboardClient.tsx` + `onboarding-overlay.tsx` + a new `TelegramCTAModal` component. Needs visual QA on dashboard at 3 widths.

**Verification gate before merge**
- Dashboard initial paint < 2 visible competing CTAs
- OnboardingOverlay visible without scroll on first load
- Conversion-funnel snapshot pre/post (Pricing visits per Dashboard session)

---

## #5 — Activation event instrumentation

**Why it's blocked**
- Adds a new DB table (`user_taken_signals` or similar) — DB schema decision, migration.
- Adds a new tracked event type — telemetry plumbing decision.
- Requires deciding: do users mark "taken" manually, or do we infer from Binance/RoboForex broker bridge if they've connected one?

**Recommended scope**
- Migration: `user_taken_signals (id uuid pk, user_id uuid, signal_id text, taken_at timestamptz, source text)` — source ∈ `{manual, broker_bridge}`.
- New API: `POST /api/signals/:id/taken` — writes the row.
- New UI: "I took this" button on `SignalCard` for logged-in users.
- New analytics view: `daily_activation_rate` = `count(distinct user_id where first_taken_at within trial_window)` / `count(distinct user_id where trial_started_within(7d))`.
- Plumb event into existing analytics layer (PostHog/Plausible — check `apps/web/lib/analytics.ts` for current shape).

**Effort:** 2–3 days including migration + UI + analytics wiring.

**Decision needed before starting**
1. Manual button only, or auto-infer from broker bridge?
2. Should we backfill historical `signal_history` rows with `inferred_taken=true` for symbols the user opened detail on? (probably no — too noisy)
3. Where does the event sink? PostHog? In-house?

---

## #6 — /welcome webhook race

**Why it's blocked**
- The proposed fix is to write `tier='pro_pending'` from the Stripe checkout success_url **before** the webhook lands, then flip to `pro_confirmed` on webhook. This is a billing-state model change.
- Today's `getUserTier` returns `'free' | 'pro' | 'enterprise'`. Adding `pro_pending` touches every consumer.
- Risk: a user lands on /welcome with `pro_pending`, sees premium UI, but Stripe ultimately fails the charge (declined card retry, fraud hold, etc.). We'd need a reconciliation path.

**Safer interim fix that can ship today**
- Edit `apps/web/app/welcome/page.tsx:64-68` so the H1 reads:
  - `"You're in. Let's finish setup."` if `verified === true` regardless of `waitForTierFlip` result
  - The webhook race only affects what `useUserSession` / `getUserTier` says — but `verified` already proves the Stripe session was for this user
- Add: "Your card has been charged $0. First charge in 7 days." line as visible reassurance even when polling timed out.

**Recommended scope (full fix, later)**
- Migration: add `subscription_state text` column to `users` ∈ `{free, pro_pending, pro_active, pro_past_due, pro_cancelled}`.
- Refactor `getUserTier` to compute `tier` from `subscription_state` + grace-period rules already in `PAST_DUE_GRACE_DAYS`.
- Stripe success_url handler pre-writes `pro_pending` before redirect to `/welcome`.
- Webhook flips `pro_pending` → `pro_active` on `invoice.payment_succeeded`, or back to `free` on `checkout.session.expired`.

**Effort:** 1 day for interim copy fix. 3-4 days for the full state-model change including consumer audit.

---

## #7 — Logged-in vs marketing navbar split

**Why it's blocked**
- `apps/web/app/components/navbar.tsx` is shared across every route. Splitting it means deciding which routes are "logged-in / app" vs "logged-out / marketing."
- The dashboard, billing, settings, alerts, paper-trading, etc. are app-only. Pricing, blog, docs, devto-stats, share, etc. are marketing.
- Need to pass session state into the navbar (currently it's purely static).

**Recommended scope**
- Add `await readSessionFromCookies()` in a new server component `<AppNavbar />`.
- Render `<MarketingNavbar />` (current state, 13+13 dropdown items) when `session === null`.
- Render `<AppNavbar />` (Dashboard, Signals, Track Record, Alerts, Settings, Billing — 6 items max) when `session !== null`.
- Move Tools / Community links to footer-only.
- Optional: add a "Switch to marketing site" link in the app navbar for users who want to see /pricing as a Pro user.

**Effort:** 1 day. Touches navbar.tsx (split into 2) + page.tsx layouts that include it + tests if any.

**Sequencing note**
This is least risky after #4 lands, since #4 already reduces the dashboard's reliance on top-nav links to direct users around the product.

---

## Suggested execution order

If picking these back up in a single sprint, the cheapest sequence is:

1. **#6 interim copy fix** (1h) — ship the H1 + "card charged $0" reassurance now; defer the state-model rewrite.
2. **#4 dashboard simplification** (1–2 days) — biggest UX impact, most contained change.
3. **#5 activation instrumentation** (2–3 days) — once #4 lands, signal cards are clearer to instrument.
4. **#7 navbar split** (1 day) — lowest risk after #4 reduces nav dependence.
5. **#6 full state-model change** (3–4 days) — only if churn data shows the race matters in practice.

Total: ~2 weeks of focused work to close the audit. Each step independently ships value.
