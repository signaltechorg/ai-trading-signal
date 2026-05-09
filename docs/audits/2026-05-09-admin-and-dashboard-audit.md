# Admin + User Dashboard Audit — 2026-05-09

Scope: `apps/web/app/admin/**`, `apps/web/app/dashboard/**`, supporting auth in `apps/web/lib/admin-gate.ts`, `apps/web/middleware.ts`, `apps/web/app/api/auth/{login,session}/route.ts`, `apps/web/app/api/admin/social-queue/route.ts`.

Method: read all source files in scope (15 files, ~3k LOC), trace auth and data flow, cross-check against route gating in middleware. No fixes attempted — report only, per the audit framing.

---

## TL;DR

The admin surface uses **two incompatible auth UX flows for the same secret**, the user-dashboard layout silently accepts the admin cookie, and the cookie value is the literal `ADMIN_SECRET` (no per-session token). None of these are exploitable from outside given the middleware gating, but they create real ops debt the moment a second admin or paying-team-admin appears.

User dashboard is functionally fine. The 1462-line `DashboardClient.tsx` is a code-quality target, not an audit finding.

---

## Critical (fix-now)

### C1. `/admin/social-queue` page persists raw `ADMIN_SECRET` in localStorage

[apps/web/app/admin/social-queue/page.tsx:29-72](apps/web/app/admin/social-queue/page.tsx#L29-L72)

The social-queue admin page asks the operator to paste the admin secret into a `<input type="password">`, persists it in `localStorage.setItem('admin_secret', ...)`, and ships it as `Authorization: Bearer <secret>` on every fetch.

The same surface already has a working httpOnly+secure+strict cookie session set by [apps/web/app/api/auth/login/route.ts:33-42](apps/web/app/api/auth/login/route.ts#L33-L42), and the middleware at [apps/web/middleware.ts:236-254](apps/web/middleware.ts#L236-L254) accepts that cookie for `/api/admin/*`. So the localStorage flow is **redundant** with the cookie session and **leaks the master secret into XSS-readable storage** for no reason.

The `/admin/page.tsx` index links to this page as a tile ("Social Queue"), so it is reachable from normal admin navigation, not legacy.

Recommendation: delete the localStorage path, drop the `Authorization` header, rely on the cookie that's already there.

### C2. `/api/admin/social-queue` route still has `ADMIN_SECRET ?? CRON_SECRET` fallback

[apps/web/app/api/admin/social-queue/route.ts:4](apps/web/app/api/admin/social-queue/route.ts#L4)

```ts
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? process.env.CRON_SECRET;
```

In practice this fallback is dead — middleware [apps/web/middleware.ts:213-221](apps/web/middleware.ts#L213-L221) returns 503 in production if `ADMIN_SECRET` is unset, so the request can't reach this route handler.

But the code reads as "the cron secret is also a valid admin credential," which is wrong both as documentation and as defense-in-depth. Anyone reading the route believes social-queue is reachable with `CRON_SECRET`. Drop the `?? CRON_SECRET`.

---

## High (fix-soon)

### H1. The `tc_admin` cookie value is the literal `ADMIN_SECRET`

[apps/web/app/api/auth/login/route.ts:33](apps/web/app/api/auth/login/route.ts#L33), checked against the env value at [apps/web/lib/admin-gate.ts:38-43](apps/web/lib/admin-gate.ts#L38-L43)

The login endpoint stores the master secret as the cookie value. httpOnly + secure + strict mostly contain it, but the design has these consequences:

- **No per-admin attribution.** When a session is "via secret," `requireAdmin()` returns `via: 'secret'` with no email. Pro-grants stamps `'tc_admin (secret)'` as `granted_by` for every secret-based admin. Once you have more than one admin, the audit table at [apps/web/app/admin/pro-grants/page.tsx:79-94](apps/web/app/admin/pro-grants/page.tsx#L79-L94) is uninformative.
- **No per-session revocation.** All admin sessions share the same cookie value. Rotating the secret invalidates every device and every active session at once.
- **No expiry beyond 7 days.** No idle timeout, no audit on issuance.

For a one-person product this is acceptable. For the SaaS roadmap (paying users, eventual team admins, support staff) this is debt. Standard fix: store an opaque random token in the cookie and look it up against an `admin_sessions` table with `(token, admin_email, issued_at, revoked_at)`. Move `safeStringEqual` from "do you have the secret?" to "is your session token still valid?".

### H2. `/dashboard/layout.tsx` accepts the `tc_admin` cookie as a user-session substitute

[apps/web/app/dashboard/layout.tsx:18-23](apps/web/app/dashboard/layout.tsx#L18-L23)

```ts
const adminSecret = process.env.ADMIN_SECRET;
const cookieValue = cookieStore.get('tc_admin')?.value;
if (adminSecret && cookieValue && safeStringEqual(cookieValue, adminSecret)) {
  return <>{children}</>;
}
```

An admin (no real `userId`) can render `/dashboard`. But:
- `useUserSession()` on the client returns `status: 'anonymous'`
- The billing page renders the "Not signed in" banner ([apps/web/app/dashboard/billing/page.tsx:263-271](apps/web/app/dashboard/billing/page.tsx#L263-L271))
- Stripe checkout/portal calls have no `userId`

So the admin sees a half-broken anonymous shell of `/dashboard`. Not exploitable, but the affordance does nothing useful. Either:
- Remove the bypass and require a real session for `/dashboard`, **or**
- If the intent is "admin can preview the user dashboard," provide an actual impersonation flow (`?as=<email>` with a server-side identity switch) instead of a half-state.

### H3. `AdminLoginClient` ignores `?redirect=<path>` set by middleware

[apps/web/app/admin/login/AdminLoginClient.tsx:32](apps/web/app/admin/login/AdminLoginClient.tsx#L32) always calls `router.push('/dashboard')` after a successful login.

Middleware sets `?redirect=<original-path>` when it bounces the admin to login ([apps/web/middleware.ts:244-246](apps/web/middleware.ts#L244-L246)). The login client never reads it. So clicking a deep link to `/admin/pro-grants` while logged-out lands the operator on `/dashboard` after auth, not `/admin/pro-grants`.

UX regression, not a security issue. Fix: read `searchParams.get('redirect')`, allowlist same-origin pathnames, push there instead of `/dashboard`. The allowlist matters — without it this becomes an open-redirect.

---

## Medium

### M1. Rate limiter is per-process, not per-IP-globally

[apps/web/middleware.ts:19](apps/web/middleware.ts#L19) uses an in-memory `Map`. On a multi-pod Railway deployment the cap multiplies by pod count.

For `/api/auth/login` specifically, this is the brute-force surface for `ADMIN_SECRET`. Whether 60/min/pod is meaningful depends on `ADMIN_SECRET` entropy — can't verify env value from source. If the secret is a strong 32+ random char value, fine. If it's a memorable string, the per-pod limit is load-bearing and weaker than it looks. Note for the SaaS migration: move to a Redis-backed limiter (or upstash) so caps survive horizontal scaling.

### M2. No audit log for money-impacting admin actions

Pro grants and revocations modify `pro_email_grants` rows ([apps/web/app/admin/pro-grants/actions.ts:44-67](apps/web/app/admin/pro-grants/actions.ts#L44-L67)). Social queue actions toggle post status. No append-only audit trail beyond row mtime.

For a product where granting Pro = giving away $29-$290 of paid product, "who did what when" should be queryable independent of the row state. An `admin_audit_log` table with `(actor, action, target, payload_json, at)` written from `grantProAction`, `revokeProAction`, and the social-queue handlers would close this.

### M3. `/admin/login` page renders inside the admin shell

[apps/web/app/admin/layout.tsx:17-23](apps/web/app/admin/layout.tsx#L17-L23) wraps every `/admin/*` page with `<PageNavBar />`, including the login page. The layout comment acknowledges this is intentional ("UserMenu correctly renders the Sign in CTA"). It works, but it does mean an unauthenticated visitor to `/admin/login` sees the public site nav, which doesn't match the focused-modal style of the login form. Cosmetic.

---

## Low / informational

- **L1.** `apps/web/app/admin/page.tsx` exposes raw user emails and tier in the "Recent signups" table for anyone passing `requireAdmin`. Acceptable for owner-only access; less acceptable as team admins are added. Combine with M2 (audit log) when revisiting.
- **L2.** `apps/web/app/admin/page.tsx:43-45` swallows the failure of the `premium_signals` count with `.catch(() => ({ c: '0' }))`. Silent zero hides a missing-table error from the operator. A `—` rendering on per-card error would be more honest.
- **L3.** `requireAdmin()` wraps each page individually rather than using a shared `/admin` layout (because the login route lives under the same path and would cause a redirect loop). The current pattern is correct, but every new admin page must remember to call `requireAdmin()` first. Worth a comment on `AdminLayout` (already present) and a server-side test that fails the build if any new `/admin/*` page omits it.
- **L4.** `dashboard/page.tsx` swallows all errors from `getTrackedSignals` with an empty catch. The client falls back to re-fetch, but a server-side log would help diagnose when SSR pre-fetch silently degrades.
- **L5.** `DashboardClient.tsx` is 1462 lines, single-file client component, ~30+ child component imports. Code-quality target — split into `SignalsGrid`, `OnboardingBanner`, `TelegramSection`, etc. Not an audit finding, but worth a follow-up plan doc if you intend to onboard contributors.
- **L6.** `dashboard/billing/page.tsx`'s "Upgrade to Pro" button is enabled for anonymous visitors (`currentTier === 'free'` is true for both signed-out users and free-tier signed-in users). Clicking it as anonymous probably 401s at `/api/stripe/checkout` — not a vuln, but a confusing dead-end. Either disable the button when `isDemo` or have it bounce to `/signin?next=/dashboard/billing`.

---

## Out of scope (noted but not investigated)

- `/api/auth/google/start` and the rest of the Google OAuth path — only its session-cookie consumption was traced.
- `/earningsedge/dashboard` — separate product surface, brief skim only confirmed it's a localStorage-only history view, no shared auth concerns.
- The Stripe checkout/portal/webhook path — referenced from billing but not opened.
- Telegram link-token API — referenced from billing/dashboard but not opened.

---

## Suggested fix order

1. **C1 + C2** together — single PR, removes the localStorage flow and the dead `?? CRON_SECRET`. Small, surgical.
2. **H3** — read `?redirect=`, allowlist same-origin. UX win, no risk.
3. **M2** — add `admin_audit_log` table + write from pro-grants and social-queue handlers. One migration + 4 insert calls.
4. **H1** — opaque session-token migration. Bigger change. Defer until a second admin or team-admin actually appears, but stop adding new code that depends on `via: 'secret'` semantics.
5. **H2** — decide intent, then either remove the bypass or build a real impersonation flow.
6. **M1** — Redis rate limiter when multi-pod becomes real.
