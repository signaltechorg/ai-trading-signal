# 2026-05-07 — User profile in navbar + member/admin separation

## Goal

Two outcomes:
1. Logged-in users see their Google/GitHub identity (avatar + display name) in the top bar so the "am I signed in?" question is answered at a glance.
2. The in-app navbar adapts its center link-set to the current section (public marketing, member app, admin) so each audience sees only their own surface.

## Approved scope

- DB schema additions: `users.avatar_url`, `users.auth_provider`. The `users.name` column already exists from migration `001_monetization.sql` and will be reused for display name.
- OAuth callbacks (`/api/auth/google/callback`, `/api/auth/github/callback`) capture `name`, picture/avatar URL, and provider, and persist on every successful sign-in (so a user who changes their photo upstream gets a refresh on their next sign-in).
- `/api/auth/session` returns `displayName`, `avatarUrl`, `authProvider` alongside the existing tier fields.
- New `UserMenu` component (avatar with fallback, tier pill, dropdown: Profile/Billing/Sign out). Anonymous renders a `Sign in` button.
- `PageNavBar` (the in-app sticky navbar at the top of the dashboard / screener / backtest / etc.) becomes pathname-aware: a `MEMBER_LINKS` set when on member routes, an `ADMIN_LINKS` set when on `/admin/*`, default = current `PRIMARY_LINKS`. UserMenu placed at the right.
- Marketing `Navbar` (the rounded-pill one on `/`) gets the same `UserMenu` next to its existing "Star on GitHub" CTA so identity carries across pages.
- `app/admin/layout.tsx` (new) wraps `/admin/*` so the admin navbar variant renders consistently on every admin page.

## Out of scope (deferred)

- Custom avatar upload / library integration (Gravatar fallback). User-supplied photos can be added later.
- Migrating away from email-as-primary-key to OAuth `provider+sub` identifiers. Today's email-merge behavior is preserved.
- Changing the marketing navbar's visual design; only the right-side CTA group gains a UserMenu.
- Reorganising the admin tile grid; today's tile layout stays.

## Member route list (confirmed)

`/dashboard`, `/screener`, `/backtest`, `/leaderboard`, `/track-record`, `/strategy-builder`, `/multi-timeframe`, `/paper-trading`, `/commentary`, `/journal`, `/glossary`, `/notifications`, `/alerts`, `/api-keys`, `/api-usage`, `/portfolio`, `/settings`.

Track Record stays accessible to anonymous visitors as well — it's a marketing/proof page — so it appears in both public and member nav.

## Admin route list

`/admin`, `/admin/pro-grants`, `/admin/social-queue`, `/admin/executions` plus external links (Stripe, Railway).

## Build sequence (one commit per layer)

| # | Layer | Files | Verification |
|---|---|---|---|
| 1 | Migration + db.ts | `apps/web/migrations/027_user_profile.sql` (new), `apps/web/lib/db.ts` (extend `UserRecord`/`UserRow`, add `upsertUserProfile`) | `npm run build` in `apps/web`. New SQL is idempotent (`IF NOT EXISTS`). |
| 2 | OAuth callbacks | `apps/web/app/api/auth/google/callback/route.ts`, `apps/web/app/api/auth/github/callback/route.ts` | Type-check. Manual local sign-in optional. |
| 3 | Session API + hook | `apps/web/app/api/auth/session/route.ts`, `apps/web/lib/hooks/use-user-tier.ts` (extend `ClientSession`) | Type-check. |
| 4 | UserMenu component | new `apps/web/components/UserMenu.tsx`, replace `TierBadge` slot in `apps/web/app/components/navbar.tsx`, add to `apps/web/components/PageNavBar.tsx` right side | Visual smoke test. |
| 5 | Pathname-aware nav | `apps/web/components/PageNavBar.tsx` (link-set switch), new `apps/web/app/admin/layout.tsx` | Type-check. Smoke test: `/dashboard` shows member links; `/admin` shows admin links; `/` shows marketing links. |

## Risks

- **OAuth provider field**: store as `'google' | 'github' | null`. We never overwrite once set — first provider wins (avoids confusing flips on cross-provider sign-in with same email).
- **Avatar URLs are hot-linked**: rendered with `referrerpolicy="no-referrer"` and a `User` lucide fallback if the image errors out.
- **Migration on shared prod**: idempotent `ADD COLUMN IF NOT EXISTS`, no backfill, no data risk.
- **TierBadge consumers**: `TierBadge` is imported only in the marketing `navbar.tsx`. UserMenu absorbs its responsibility; the file stays exported in case other surfaces want a standalone tier pill.

## Verification gate

After all 5 commits:
1. `npm run -s typecheck` (or `tsc --noEmit`) clean inside `apps/web`.
2. `npm run -s lint --silent` clean for the changed files.
3. Smoke matrix: anonymous on `/dashboard` (redirect to /signin) ✓; signed-in member on `/dashboard` (member links + UserMenu) ✓; admin on `/admin` (admin links + UserMenu) ✓.
