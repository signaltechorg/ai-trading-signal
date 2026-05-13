// /ops Telegram command handlers. Admin-gated by OPS_TELEGRAM_ADMIN_IDS env.
// Plan: docs/plans/2026-05-13-tradeclaw-ops-dashboard.md (Layer 2 PR 2).
//
// Non-admin senders are silently ignored — no error reveal, no surface for
// probing whether a chat ID is in the admin set.

import {
  loadGatedSignals,
  loadRecentSignals,
  loadTodayCounts,
  type GatedSignalRow,
  type RecentSignalRow,
  type TodayCounts,
} from './ops-dashboard';
import { query } from './db-pool';
import { sendTelegramMessage, escapeHtml } from './telegram-send';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;

interface SignalRunLogRow {
  run_started_at: string;
  run_finished_at: string | null;
  total_signals: number;
  verified_signals: number;
  win_count: number;
  loss_count: number;
  pending_count: number;
  trigger_source: string;
}

export function parseOpsAdminIds(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.OPS_TELEGRAM_ADMIN_IDS ?? '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

export function isOpsAdmin(
  telegramUserId: number | string | undefined,
  ids: Set<string> = parseOpsAdminIds(),
): boolean {
  if (telegramUserId === undefined || telegramUserId === null) return false;
  return ids.has(String(telegramUserId));
}

// Caller passes the full message text (e.g. "/ops gated 5"). Returns true
// iff the message was an /ops command — including non-admin sends, which
// return true so the webhook does NOT fall through to the "Unknown command"
// reply (which would leak the existence of /ops).
export async function handleOpsCommand(
  chatId: number,
  fromUserId: number | undefined,
  text: string,
): Promise<boolean> {
  const tokens = text.trim().split(/\s+/);
  const head = tokens[0]?.toLowerCase();
  if (!head || head !== '/ops') return false;

  if (!isOpsAdmin(fromUserId)) {
    // Silently consume — never reveal the gate.
    return true;
  }

  const sub = (tokens[1] ?? 'today').toLowerCase();
  const limit = clampLimit(tokens[2]);

  switch (sub) {
    case 'today':
      await sendTelegramMessage(chatId, renderTodayMessage(await loadTodayCounts()));
      return true;
    case 'gated':
      await sendTelegramMessage(chatId, renderGatedMessage(await loadGatedSignals(limit), limit));
      return true;
    case 'recent':
      await sendTelegramMessage(chatId, renderRecentMessage(await loadRecentSignals(limit), limit));
      return true;
    case 'runs':
      await sendTelegramMessage(chatId, renderRunsMessage(await loadRecentRuns(limit), limit));
      return true;
    case 'help':
    default:
      await sendTelegramMessage(chatId, renderHelpMessage());
      return true;
  }
}

function clampLimit(raw: string | undefined): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

async function loadRecentRuns(limit: number): Promise<SignalRunLogRow[]> {
  try {
    return await query<SignalRunLogRow>(
      `SELECT
         run_started_at::text   AS run_started_at,
         run_finished_at::text  AS run_finished_at,
         total_signals,
         verified_signals,
         win_count,
         loss_count,
         pending_count,
         trigger_source
       FROM signal_run_log
       ORDER BY run_started_at DESC
       LIMIT $1`,
      [limit],
    );
  } catch {
    return [];
  }
}

// ── Renderers (HTML parse mode) ────────────────────────────────────────────

export function renderTodayMessage(today: TodayCounts): string {
  const decided = today.wins24h + today.losses24h;
  const winRate = decided > 0 ? `${Math.round((today.wins24h / decided) * 100)}%` : 'n/a';
  const lastRun = today.lastRunStartedAt
    ? formatTimestamp(today.lastRunStartedAt)
    : 'no rows';

  const lines: string[] = [
    '<b>TradeClaw Ops — Today (last 24h)</b>',
    '',
    `Signals: <b>${today.signals24h}</b>`,
    `Gate-blocked: <b>${today.gateBlocked24h}</b>`,
    `Wins / Losses / Pending: <b>${today.wins24h}</b> / <b>${today.losses24h}</b> / <b>${today.pending24h}</b>`,
    `24h win rate: <b>${winRate}</b>`,
    '',
    `Last cron run: <code>${escapeHtml(lastRun)}</code>`,
  ];
  if (today.lastRunTriggerSource) {
    lines.push(`Trigger: <code>${escapeHtml(today.lastRunTriggerSource)}</code>`);
  }
  if (today.lastRunTotalSignals !== null) {
    lines.push(
      `Run snapshot: ${today.lastRunTotalSignals} total · ${today.lastRunVerifiedSignals ?? 0} verified · ` +
        `${today.lastRunWinCount ?? 0}W / ${today.lastRunLossCount ?? 0}L / ${today.lastRunPendingCount ?? 0}P`,
    );
  }
  return lines.join('\n');
}

export function renderGatedMessage(rows: GatedSignalRow[], limit: number): string {
  if (rows.length === 0) {
    return '<b>No gate-blocked signals recorded.</b>';
  }
  const lines: string[] = [
    `<b>Gated signals — last ${rows.length} of ${limit} requested</b>`,
    '',
  ];
  for (const r of rows) {
    const conf = formatConfidence(r.confidence);
    const reason = r.gate_reason ? escapeHtml(r.gate_reason) : '<i>no reason</i>';
    lines.push(
      `<code>${escapeHtml(r.pair)}</code> ${r.direction} · conf ${conf} · ` +
        `${formatRelativeTime(r.created_at)}`,
      `  ↳ ${reason}`,
    );
  }
  return lines.join('\n');
}

export function renderRecentMessage(rows: RecentSignalRow[], limit: number): string {
  if (rows.length === 0) {
    return '<b>No signals recorded.</b>';
  }
  const lines: string[] = [
    `<b>Recent signals — last ${rows.length} of ${limit} requested</b>`,
    '',
  ];
  for (const r of rows) {
    const conf = formatConfidence(r.confidence);
    const outcomes = formatOutcomes(r);
    const gated = r.gate_blocked ? ' · <b>gated</b>' : '';
    lines.push(
      `<code>${escapeHtml(r.pair)}</code> ${r.direction} · conf ${conf} · ` +
        `entry ${escapeHtml(r.entry_price)}${gated}`,
      `  ${outcomes} · ${formatRelativeTime(r.created_at)}`,
    );
  }
  return lines.join('\n');
}

export function renderRunsMessage(rows: SignalRunLogRow[], limit: number): string {
  if (rows.length === 0) {
    return '<b>No signal_run_log rows yet.</b>';
  }
  const lines: string[] = [
    `<b>Recent cron runs — last ${rows.length} of ${limit} requested</b>`,
    '',
  ];
  for (const r of rows) {
    lines.push(
      `<code>${escapeHtml(formatTimestamp(r.run_started_at))}</code> · ` +
        `${r.total_signals} total · ${r.win_count}W/${r.loss_count}L/${r.pending_count}P`,
      `  trigger: <code>${escapeHtml(r.trigger_source)}</code>`,
    );
  }
  return lines.join('\n');
}

export function renderHelpMessage(): string {
  return [
    '<b>TradeClaw Ops commands</b>',
    '',
    '<code>/ops today</code> — 24h counts + last cron run',
    '<code>/ops gated [n]</code> — last N gate-blocked signals (default 10, max 30)',
    '<code>/ops recent [n]</code> — last N signals with outcomes (default 10, max 30)',
    '<code>/ops runs [n]</code> — last N signal_run_log rows (default 10, max 30)',
    '<code>/ops help</code> — this message',
  ].join('\n');
}

// ── Formatters ─────────────────────────────────────────────────────────────

function formatConfidence(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : value;
}

function formatOutcomes(r: RecentSignalRow): string {
  const out4 = formatOutcomePill(r.outcome_4h, '4h');
  const out24 = formatOutcomePill(r.outcome_24h, '24h');
  return `${out4} · ${out24}`;
}

function formatOutcomePill(
  outcome: { hit?: boolean; pnlPct?: number } | null,
  label: string,
): string {
  if (!outcome) return `${label}: pending`;
  const pnl = typeof outcome.pnlPct === 'number' ? `${outcome.pnlPct.toFixed(2)}%` : '—';
  if (outcome.hit === true) return `${label}: hit (${pnl})`;
  return `${label}: miss (${pnl})`;
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(t)) return iso;
  const diffSec = Math.round((Date.now() - t) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  return `${Math.round(diffSec / 86400)}d ago`;
}

function formatTimestamp(iso: string): string {
  return iso.slice(0, 19).replace('T', ' ');
}
