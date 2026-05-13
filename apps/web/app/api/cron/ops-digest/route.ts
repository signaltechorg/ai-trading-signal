import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '../../../../lib/cron-auth';
import { loadTodayCounts } from '../../../../lib/ops-dashboard';
import {
  parseOpsAdminIds,
  renderTodayMessage,
} from '../../../../lib/telegram-ops-commands';
import { sendTelegramMessage } from '../../../../lib/telegram-send';

// Daily ops digest — pushes the "Today" panel to every OPS_TELEGRAM_ADMIN_IDS
// recipient. Scheduled via /api/cron/sync at hour=23 UTC.
// Plan: docs/plans/2026-05-13-tradeclaw-ops-dashboard.md (Layer 3 PR 3).
//
// Idempotency: not enforced at the route level. The /api/cron/sync caller is
// the rate-limit boundary (one slot per 24h, minute < 10). Manual triggers
// via curl will re-send — expected behavior for an admin-only push surface.

export const dynamic = 'force-dynamic';

interface DigestResult {
  ok: boolean;
  adminCount: number;
  sent: number;
  failures: Array<{ chatId: string; error: string }>;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const adminIds = parseOpsAdminIds();
  if (adminIds.size === 0) {
    return NextResponse.json({
      ok: false,
      error: 'OPS_TELEGRAM_ADMIN_IDS not configured',
      adminCount: 0,
      sent: 0,
      failures: [],
    } satisfies DigestResult & { error: string });
  }

  let body: string;
  try {
    const today = await loadTodayCounts();
    body = renderTodayMessage(today);
  } catch (err) {
    // Per plan: on data-fetch failure send a short notice rather than skipping.
    body =
      '<b>TradeClaw Ops digest — data fetch failed</b>\n\n' +
      `<code>${err instanceof Error ? err.message : 'unknown error'}</code>`;
  }

  const results = await Promise.all(
    Array.from(adminIds).map(async (chatId) => ({
      chatId,
      result: await sendTelegramMessage(chatId, body),
    })),
  );

  const failures = results
    .filter((r) => !r.result.ok)
    .map((r) => ({ chatId: r.chatId, error: r.result.error ?? 'unknown' }));

  const payload: DigestResult = {
    ok: failures.length === 0,
    adminCount: adminIds.size,
    sent: results.length - failures.length,
    failures,
  };

  return NextResponse.json(payload);
}
