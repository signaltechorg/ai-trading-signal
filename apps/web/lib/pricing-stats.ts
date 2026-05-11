import { queryOne } from './db-pool';

export interface RawPricingAgg {
  closed_count: string;
  wins: string;
  cumulative_pnl: string;
}

export interface PricingStats {
  closedSignalsAllTime: number;
  winRatePct: number | null;
  cumulativePnlPct: number;
}

function safeNumber(input: string | null | undefined): number {
  if (input == null) return 0;
  const n = Number(input);
  return Number.isFinite(n) ? n : 0;
}

export function computePricingStats(agg: RawPricingAgg | null): PricingStats {
  if (!agg) {
    return { closedSignalsAllTime: 0, winRatePct: null, cumulativePnlPct: 0 };
  }
  const closed = safeNumber(agg.closed_count);
  const wins = safeNumber(agg.wins);
  const cumulative = safeNumber(agg.cumulative_pnl);
  const winRatePct = closed > 0 ? Math.round((wins / closed) * 1000) / 10 : null;
  return {
    closedSignalsAllTime: closed,
    winRatePct,
    cumulativePnlPct: cumulative,
  };
}

export async function getPricingStats(): Promise<PricingStats> {
  try {
    const row = await queryOne<RawPricingAgg>(
      `WITH closed AS (
         SELECT (outcome_24h->>'pnlPct')::numeric AS pnl_pct,
                (outcome_24h->>'hit')::boolean   AS hit
           FROM signal_history
          WHERE outcome_24h IS NOT NULL
            AND is_simulated = FALSE
            AND NOT ((outcome_24h->>'pnlPct')::numeric = 0
                     AND (outcome_24h->>'hit')::boolean = FALSE)
       )
       SELECT
         COUNT(*)::text                                              AS closed_count,
         COALESCE(SUM(CASE WHEN hit THEN 1 ELSE 0 END), 0)::text     AS wins,
         COALESCE(SUM(pnl_pct), 0)::text                             AS cumulative_pnl
         FROM closed`
    );
    return computePricingStats(row ?? null);
  } catch {
    return computePricingStats(null);
  }
}
