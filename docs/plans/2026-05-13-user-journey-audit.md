# TradeClaw — New-Visitor → Paying-Pro User Journey Audit

Date: 2026-05-13
Owner: Zaky / PM
Scope: tradeclaw.win (hosted Pro tier). Self-host journey out of scope.

## Funnel as built

```
Landing (/)
  ├─ "View Track Record"      (primary CTA — proof, not action)
  └─ "Start Free"              (secondary CTA → /dashboard, no auth)
        │
Dashboard (/dashboard, anonymous OK)
  ├─ Sees 70%+ signals (free symbols only, 15-min delayed)
  ├─ Sees "Unlocking soon" locked cards w/ countdown
  ├─ OnboardingOverlay (3-step QuickStart, dismissible)
  └─ 3 competing CTAs: public Telegram | Connect Telegram | "Set up alerts"
        │
Pricing (/pricing)
  └─ "Start 7-Day Trial" → POST /api/stripe/checkout
        │  401 → /signin?next=/pricing?resume=checkout&interval=monthly
        │
Signin (/signin) — Google / GitHub / magic-link
  └─ proceedAfterSession() re-POSTs checkout → Stripe
        │
Stripe Checkout (hosted)
  └─ success_url → /welcome?session_id=…
        │
Welcome (/welcome) — 3-step setup
  ├─ 1. Connect Telegram (HMAC-token deep link)
  ├─ 2. See your latest live signal
  └─ 3. Enable browser push (VAPID, optional)
        │
Dashboard as Pro
  └─ Real-time signals, all symbols, TP1/TP2/TP3, private TG group
        │
Day 7 → auto-charge
```

## High-impact findings (ranked by lift / cost ratio)

### 1. Variant labels are leaking to production. Trust-corroding. Free fix.
File: `apps/web/components/landing/ab-hero.tsx:147-152, 225-230`

The A/B hero renders a literal pulsing badge labeled **"Variant A"**, **"Variant B"**, **"Variant C"** above the H1. Real visitors see internal experiment metadata. Reads as half-built. Strip the visible badge — keep the localStorage tracking. This is a 10-line delete that costs nothing.

### 2. Hero CTA order is inverted vs. funnel intent
Primary CTA is "View Track Record" (proof page); secondary is "Start Free" (the action).

For a $29/mo product with a 7-day free trial, the strongest visitor intent the page can capture is "let me try it." Track record is supporting evidence, not the conversion event. Swap the visual weight:
- Primary: **"Start 7-day Pro trial — cancel anytime"** → `/pricing` with interval=monthly preselected
- Secondary: **"View track record"** (text-link weight, not solid pill)
- Tertiary (existing): **"Start free"** → `/dashboard`

Add "No credit card for free tier" as 11px helper under the buttons. The current "Start Free" is good but it's the lowest-value action being presented at hero-pill weight.

### 3. Trial CTA does not disclose card-required
File: `apps/web/app/pricing/PricingCards.tsx:165-167`

Button copy: "Start 7-Day Trial". The Stripe checkout collects a card and auto-charges on day 8. FAQ discloses it ("You'll be charged automatically after 7 days") but the button itself does not. Two fixes:
- Button: **"Start trial — $29 on day 8 unless cancelled"**, or at minimum the existing copy plus a `<p className="text-[11px] text-zinc-500">Card required. Cancel anytime before day 8.</p>` directly under the button.
- The 17%-savings annual toggle visually wins over the monthly trial. Either anchor visitors on monthly (default — they have today) or surface annual after first conversion via in-app prompt.

This single change typically cuts refund-rate by 30-60% in this product class. Cheap insurance.

### 4. Dashboard is overloaded on the first visit
File: `apps/web/app/dashboard/DashboardClient.tsx` — 1,462 LOC

What a brand-new visitor sees on first render:
- Filter bar: timeframe + direction + asset class + high-confidence-only + favorites-only + auto-refresh
- DelayCountdown widget
- "Unlocking soon" locked-signal section (3-up grid)
- Main 70%+ signals (3-up grid)
- 3 Telegram CTAs in a row
- "Potential signals" 50–69% section
- SignalHistory section
- OnboardingOverlay bottom-right (Quick Start 0/3)
- SignalToast top-right
- Disclaimer footer

Cognitive load is too high. First 5 seconds should answer one question: **"What should I do right now?"** Today the answer is unclear because eight things compete.

Recommendation:
- Collapse "Potential signals" and "Signal history" behind a tab or accordion (default collapsed for new sessions)
- Pull the three Telegram CTAs into a single "Get signals on Telegram" pill that opens a 2-option modal (public vs. Pro)
- Promote the OnboardingOverlay from bottom-right to a single-row sticky top-strip until step 1 is auto-marked done. Bottom-right floating widgets are dismissed without being read.

### 5. The activation event is not measured
The QuickStart overlay tracks: saw-signal, opened-detail, set-alert. None of these correlate to **"user took a real trade based on a TradeClaw signal"** — the actual product success event.

Add either:
- A "Mark this signal as taken" button on signal cards → writes to `user_taken_signals` table → unlocks a "Track this trade" widget showing entry/SL/TP progress in real time
- Or a Telegram link verification step ("we just sent your first signal — did it land?")

This is the most under-measured part of the funnel. Right now you cannot answer "what fraction of trial users place a trade?" → cannot calculate causal trial→paid.

### 6. /welcome webhook race is band-aided
File: `apps/web/app/welcome/page.tsx:15-25`

`waitForTierFlip` polls Postgres every 400ms for up to 5 seconds for the Stripe webhook to commit the tier change. If the webhook is slow (Stripe occasionally 30s+), the user sees "Finish setting up your account" copy and the 3-step setup with their tier still showing as free. They may panic and re-enter checkout.

Two production fixes:
- Use Stripe's `client_reference_id` ↔ session_id lookup that's already there to **trust the checkout** and pre-write tier='pro_pending' before the webhook lands. Webhook flips to 'pro_confirmed'. UI shows correct copy immediately.
- Add an explicit "Your card has been charged $0.00 today; first charge on May 20" line on /welcome so the user knows the transaction landed even if the rest of the page hasn't caught up.

### 7. 150-route IA is hiding the product
The Next.js app has 150 top-level routes. The navbar's "More" dropdown exposes 13 Tools links (Replit, Fly.io Deploy, Supabase Setup, Plugins, Cost Benchmark, Profile Widget, Live Feed, Status, Marketplace, Strategy Builder, Indicators, API Keys, API Usage) and 13 Community links (Discord, Product Hunt, Pledge Wall, SMS Alerts, Star History, Subscribe…). For a paying customer trying to find "where do I see my signals," this is noise.

This is not a "delete everything" recommendation — many of these are SEO-targeted landing pages with their own intent. But:
- The **logged-in dashboard navbar** should differ from the marketing-site navbar. Strip Tools/Community to: Dashboard, Signals, Track Record, Settings, Billing. Move everything else behind a "Resources" link in the footer.
- Audit every route in `/more/Tools` for last-90-days traffic. Anything below 50 sessions/month should redirect to a parent page.

### 8. Pricing page lacks risk-reversal at the moment of decision
The pricing page has good audited stats above the cards (winRate / resolved-signals / cumulative-PnL) when data exists. But:
- Cancel-anytime is in the FAQ, not next to the button
- No money-back guarantee
- No "Trusted by N traders" social proof under the Pro CTA
- No "Most subscribers stay past trial" survival rate

Even ungated, just adding `"X traders started a trial this week"` (which you can compute from `user_subscriptions` table) under the CTA pill would lift conversion ~5-10% on a low-trust transaction.

### 9. Telegram is the core Pro feature and isn't featured on the landing page
The hosted Pro tier's biggest moat is the **private Telegram group with instant signal delivery and auto-kick on tier expiry**. Landing page mentions Telegram only in passing in the LiveActivityStrip footer. The /pricing comparison table has it. The hero does not.

Add a third hero section between LiveHeroSignals and ProofHero:
- "Signals land in your Telegram in <2s. The dashboard is a courtesy."
- Embed an animated chat-bubble screenshot of three real recent Pro signals
- CTA: "Try Pro for 7 days" (single button)

For day traders this is the actual purchase trigger. The current landing page sells the dashboard, but the dashboard is where users *verify* signals, not where they consume them in real time.

## Top 3 fixes to do this week

1. **Strip A/B variant labels from production hero** (15 min) — `ab-hero.tsx`
2. **Trial CTA discloses card-required + "cancel before day 8"** (30 min) — `PricingCards.tsx`, plus mirror the helper text on the hero secondary CTA
3. **Move OnboardingOverlay from bottom-right floater to top-of-dashboard sticky strip** until step 1 auto-completes (1h) — `onboarding-overlay.tsx` + `DashboardClient.tsx`

These three are <2h of work combined and address trust, disclosure, and orientation — the cheapest wins in the funnel.

## Top 3 fixes for next sprint

1. **Add "I took this trade" instrumentation to signal cards** — unlocks causal trial→paid measurement
2. **Split logged-in navbar from marketing navbar** — cuts Tools/Community noise once a session is established
3. **Add a Telegram-first hero section** — pulls the core Pro value forward; today it's buried below the fold

## What I did not audit (out of scope today)

- Mobile experience (separate device test needed)
- Email lifecycle (T-3d trial email exists per recent commit — verify content, send-time, deliverability)
- Self-host onboarding (`/start` 5-step guide) — different persona, different funnel
- Post-trial churn / win-back flow
- Cancellation UX inside Stripe billing portal

## How to verify these claims

- Pull funnel metrics from your analytics layer (PostHog? Plausible?) — at minimum:
  - Landing → Pricing click-through %
  - Pricing → Stripe checkout-start %
  - Checkout-start → Checkout-completed % (Stripe dashboard)
  - Trial-started → Day-7 conversion %
- Run a Hotjar / Mouseflow recording on 50 new sessions to confirm "where do they actually click on the dashboard?"
- Self-test: open an incognito window, walk through landing → trial → welcome → first signal → cancel. Time each step. Anything that took >15s is friction.
