import type { ReactNode } from 'react';
import { PageNavBar } from '../../components/PageNavBar';

/**
 * Admin shell — every page under /admin gets the same top navbar so operators
 * have one consistent surface (Pro Grants, Social Queue, Executions, "Back to
 * App") and a clear visual cue that they are in admin mode.
 *
 * The /admin/login page is the one exception: it intentionally has no chrome
 * because the user has no session yet. Routing-wise it still inherits this
 * layout, but PageNavBar's UserMenu correctly renders the "Sign in" CTA when
 * there's no session, which is exactly what we want.
 *
 * Auth gating itself lives in `requireAdmin()` inside each admin page.tsx
 * (a server-side check). This layout only adds chrome.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageNavBar />
      {children}
    </>
  );
}
