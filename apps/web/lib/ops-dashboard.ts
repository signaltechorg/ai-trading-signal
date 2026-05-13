// Ops dashboard data loaders — read-only queries over existing audit tables.
// Plan: docs/plans/2026-05-13-tradeclaw-ops-dashboard.md (Layer 1 PR 1).
// All queries are parameterized via lib/db-pool.ts and return typed rows.

import { query, queryOne } from './db-pool';

export interface TodayCounts {
  signals24h: number;
  gateBlocked24h: number;
  wins24h: number;
  losses24h: number;
  pending24h: number;
  lastRunStartedAt: string | null;
  lastRunFinishedAt: string | null;
  lastRunTotalSignals: number | null;
  lastRunVerifiedSignals: number | null;
  lastRunWinCount: number | null;
  lastRunLossCount: number | null;
  lastRunPendingCount: number | null;
  lastRunTriggerSource: string | null;
}

export interface GatedSignalRow {
  id: string;
  pair: string;
  direction: 'BUY' | 'SELL';
  confidence: string;
  gate_reason: string | null;
  strategy_id: string | null;
  created_at: string;
}

export interface RecentSignalRow {
  id: string;
  pair: string;
  direction: 'BUY' | 'SELL';
  confidence: string;
  entry_price: string;
  strategy_id: string | null;
  outcome_4h: { hit?: boolean; pnlPct?: number } | null;
  outcome_24h: { hit?: boolean; pnlPct?: number } | null;
  gate_blocked: boolean;
  created_at: string;
}

interface CountRow {
  c: string;
}

interface LastRunRow {
  run_started_at: string;
  run_finished_at: string | null;
  total_signals: number;
  verified_signals: number;
  win_count: number;
  loss_count: number;
  pending_count: number;
  trigger_source: string;
}

export async function loadTodayCounts(): Promise<TodayCounts> {
  const fallback: TodayCounts = {
    signals24h: 0,
    gateBlocked24h: 0,
    wins24h: 0,
    losses24h: 0,
    pending24h: 0,
    lastRunStartedAt: null,
    lastRunFinishedAt: null,
    lastRunTotalSignals: null,
    lastRunVerifiedSignals: null,
    lastRunWinCount: null,
    lastRunLossCount: null,
    lastRunPendingCount: null,
    lastRunTriggerSource: null,
  };

  try {
    const [signals, gated, wins, losses, pending, lastRun] = await Promise.all([
      queryOne<CountRow>(
        `SELECT COUNT(*)::text AS c FROM signal_history
         WHERE created_at > NOW() - INTERVAL '24 hours'`,
      ),
      queryOne<CountRow>(
        `SELECT COUNT(*)::text AS c FROM signal_history
         WHERE gate_blocked = TRUE
           AND created_at > NOW() - INTERVAL '24 hours'`,
      ),
      queryOne<CountRow>(
        `SELECT COUNT(*)::text AS c FROM signal_history
         WHERE created_at > NOW() - INTERVAL '24 hours'
           AND (outcome_24h->>'hit')::boolean = TRUE`,
      ),
      queryOne<CountRow>(
        `SELECT COUNT(*)::text AS c FROM signal_history
         WHERE created_at > NOW() - INTERVAL '24 hours'
           AND outcome_24h IS NOT NULL
           AND (outcome_24h->>'hit')::boolean = FALSE`,
      ),
      queryOne<CountRow>(
        `SELECT COUNT(*)::text AS c FROM signal_history
         WHERE created_at > NOW() - INTERVAL '24 hours'
           AND outcome_24h IS NULL`,
      ),
      queryOne<LastRunRow>(
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
         LIMIT 1`,
      ),
    ]);

    return {
      signals24h: Number(signals?.c ?? '0'),
      gateBlocked24h: Number(gated?.c ?? '0'),
      wins24h: Number(wins?.c ?? '0'),
      losses24h: Number(losses?.c ?? '0'),
      pending24h: Number(pending?.c ?? '0'),
      lastRunStartedAt: lastRun?.run_started_at ?? null,
      lastRunFinishedAt: lastRun?.run_finished_at ?? null,
      lastRunTotalSignals: lastRun?.total_signals ?? null,
      lastRunVerifiedSignals: lastRun?.verified_signals ?? null,
      lastRunWinCount: lastRun?.win_count ?? null,
      lastRunLossCount: lastRun?.loss_count ?? null,
      lastRunPendingCount: lastRun?.pending_count ?? null,
      lastRunTriggerSource: lastRun?.trigger_source ?? null,
    };
  } catch {
    return fallback;
  }
}

export async function loadGatedSignals(limit = 30): Promise<GatedSignalRow[]> {
  try {
    return await query<GatedSignalRow>(
      `SELECT
         id,
         pair,
         direction,
         confidence::text     AS confidence,
         gate_reason,
         strategy_id,
         created_at::text     AS created_at
       FROM signal_history
       WHERE gate_blocked = TRUE
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
    );
  } catch {
    return [];
  }
}

export async function loadRecentSignals(limit = 30): Promise<RecentSignalRow[]> {
  try {
    return await query<RecentSignalRow>(
      `SELECT
         id,
         pair,
         direction,
         confidence::text     AS confidence,
         entry_price::text    AS entry_price,
         strategy_id,
         outcome_4h,
         outcome_24h,
         gate_blocked,
         created_at::text     AS created_at
       FROM signal_history
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
    );
  } catch {
    return [];
  }
}
