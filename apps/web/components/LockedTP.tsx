'use client';

import { useState } from 'react';
import { Lock } from 'lucide-react';

export interface LockedTPProps {
  /** TP level being masked (2 or 3). */
  level: 2 | 3;
  /** Optional call-site tag, appended to the upgrade CTA for analytics. */
  from?: string;
}

export function buildLockedTPFallbackHref(level: 2 | 3, from?: string): string {
  const fromTag = from ? `tp${level}-${from}` : `tp${level}`;
  const params = new URLSearchParams({
    resume: 'checkout',
    interval: 'monthly',
    from: fromTag,
  });
  return `/pricing?${params.toString()}`;
}

/**
 * Inline row stub shown in place of a hidden TP2/TP3 value for free users.
 * It takes logged-out users through /signin and then back to /pricing with a
 * resume=checkout hint so the pricing page can fire Stripe automatically.
 * That keeps the upgrade path to a single click after auth instead of making
 * users hunt for the CTA again.
 */
export function LockedTP({ level, from }: LockedTPProps) {
  const [loading, setLoading] = useState(false);
  const fallbackHref = buildLockedTPFallbackHref(level, from);

  async function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (loading) return;
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tier: 'pro', interval: 'monthly' }),
      });
      if (res.status === 401) {
        window.location.href = `/signin?next=${encodeURIComponent(fallbackHref)}`;
        return;
      }
      if (!res.ok) {
        window.location.href = fallbackHref;
        return;
      }
      const payload = (await res.json().catch(() => ({}))) as { url?: string };
      if (payload.url) {
        window.location.href = payload.url;
        return;
      }
      window.location.href = fallbackHref;
    } catch {
      window.location.href = fallbackHref;
    }
  }

  return (
    <a
      href={fallbackHref}
      onClick={handleClick}
      aria-label={`Take profit ${level} requires Pro — start trial`}
      aria-busy={loading || undefined}
      className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5 text-[11px] font-medium text-emerald-400 hover:bg-emerald-500/15 transition-colors disabled:opacity-60"
    >
      <Lock className="h-2.5 w-2.5" aria-hidden="true" />
      <span>{loading ? 'Redirecting…' : `Pro — unlock TP${level}`}</span>
    </a>
  );
}
