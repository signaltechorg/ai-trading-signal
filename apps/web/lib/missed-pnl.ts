import { query } from './db-pool';
import { PRO_PREMIUM_MIN_CONFIDENCE } from './tier';

export interface MissedPnlSignal {
  symbol: string;
  direction: 'BUY' | 'SELL';
  pnlPct: number;
  createdAt: string;
}

export interface MissedPnlOptions {
  topN?: number;
  positionSizePct?: number;
  notional?: number;
}

export interface MissedPnlResult {
  signals: MissedPnlSignal[];
  totalPnlPct: number;
  totalPnlDollars: number;
}

const DEFAULT_TOP_N = 3;
const DEFAULT_POSITION_SIZE_PCT = 1;
const DEFAULT_NOTIONAL = 10_000;

function roundTo(n: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

export function computeMissedPnl(
  signals: MissedPnlSignal[],
  opts: MissedPnlOptions = {},
): MissedPnlResult {
  const topN = opts.topN ?? DEFAULT_TOP_N;
  const positionSizePct = opts.positionSizePct ?? DEFAULT_POSITION_SIZE_PCT;
  const notional = opts.notional ?? DEFAULT_NOTIONAL;

  const wins = signals
    .filter((s) => s.pnlPct > 0)
    .sort((a, b) => b.pnlPct - a.pnlPct)
    .slice(0, topN);

  const totalPnlPct = wins.reduce((acc, s) => acc + s.pnlPct, 0);

  // Dollars = pnlPct (as %) * position size as $ / 100
  //        = pnlPct * (positionSizePct / 100 * notional) / 100
  //        = pnlPct * positionSizePct * notional / 10_000
  const totalPnlDollarsRaw = (totalPnlPct * positionSizePct * notional) / 10_000;

  return {
    signals: wins,
    totalPnlPct: roundTo(totalPnlPct, 2),
    totalPnlDollars: roundTo(totalPnlDollarsRaw, 2),
  };
}

interface PnlRow {
  pair: string;
  direction: 'BUY' | 'SELL';
  pnl_pct: string;
  created_at: string;
}

/**
 * Pull Pro-band winning signals from the user's trial window and compute
 * the missed-P&L pitch. Pro band = confidence at or above
 * PRO_PREMIUM_MIN_CONFIDENCE (the threshold free callers cannot see).
 *
 * Fail-soft: empty result on any DB error so the cron never blocks an
 * email send because the pitch enrichment failed.
 */
export async function getMissedProPnL(
  trialStart: Date,
  opts: MissedPnlOptions = {},
): Promise<MissedPnlResult> {
  try {
    const rows = await query<PnlRow>(
      `SELECT pair, direction,
              (outcome_24h->>'pnlPct')::numeric::text AS pnl_pct,
              created_at
         FROM signal_history
        WHERE created_at >= $1
          AND created_at <= NOW()
          AND is_simulated = FALSE
          AND outcome_24h IS NOT NULL
          AND confidence >= $2
          AND (outcome_24h->>'pnlPct')::numeric > 0
          AND NOT ((outcome_24h->>'pnlPct')::numeric = 0
                   AND (outcome_24h->>'hit')::boolean = FALSE)
        ORDER BY (outcome_24h->>'pnlPct')::numeric DESC
        LIMIT 25`,
      [trialStart, PRO_PREMIUM_MIN_CONFIDENCE],
    );

    const signals: MissedPnlSignal[] = rows.map((r) => ({
      symbol: r.pair,
      direction: r.direction,
      pnlPct: Number(r.pnl_pct),
      createdAt: new Date(r.created_at).toISOString(),
    }));

    return computeMissedPnl(signals, opts);
  } catch {
    return computeMissedPnl([], opts);
  }
}
