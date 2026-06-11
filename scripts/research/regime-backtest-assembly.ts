/**
 * Pure metric-assembly helpers for the per-regime walk-forward CLI
 * (Phase 4 — D6, the offline gate evidence).
 *
 * Kept OUT of the CLI's IIFE so the assembly logic is unit-testable without a
 * DB connection or a network fetch. The CLI (regime-backtest-cli.ts) is the
 * thin I/O shell: arg parsing, candle loading, file output, REGISTRY append.
 * Everything deterministic about the report — the 2×3 entry×regime matrix, the
 * fold slicing, the routed-diagonal projection — lives here and is exercised by
 * regime-backtest-cli.test.ts on a small synthetic candle set.
 *
 * Determinism contract: every function here is a pure function of its inputs
 * (candles + entry module + backtest options). The classifier inside
 * perRegimeMetrics is deterministic for a fixed model + candles (its only
 * non-determinism is a timestamp the C5 harness ignores), so the same candles +
 * code + model produce byte-identical metrics. No Date.now() here.
 */

import type { OHLCV } from '@tradeclaw/core';
import type { MarketRegime } from '@tradeclaw/signals';
import {
  perRegimeMetrics,
  REGIMES,
  type EntryModule,
  type BacktestOptions,
  type RegimeMetrics,
} from '../../packages/strategies/src';

/** A base entry under evaluation, paired with a stable display label. */
export interface NamedEntry {
  /** Stable label used in the report matrix (the entry's StrategyId). */
  id: string;
  entry: EntryModule;
}

/** The three routed cells — the diagonal the gate actually cares about. */
export const ROUTED_DIAGONAL: ReadonlyArray<{ entry: string; regime: MarketRegime }> = [
  { entry: 'classic', regime: 'trend' }, // trend route = classic momentum + C2 trend filter
  { entry: 'vwap-ema-bb', regime: 'volatile' }, // volatile route = mean reversion
  { entry: 'vwap-ema-bb', regime: 'range' }, // range route = band-edge fade
] as const;

/**
 * Rounded, JSON-stable view of one regime's metrics. Fixed precision so two
 * identical runs serialize byte-identically (the determinism contract). null
 * profitFactor is preserved (zero-trade bucket); Infinity (all-winners) is
 * serialized as the string "Infinity" because JSON cannot represent it.
 */
export interface RegimeCell {
  regime: MarketRegime;
  trades: number;
  winRate: number;
  /** Mean pnlPct AFTER modeled costs (fraction; 0.004 = +0.4%). */
  expectancy: number;
  profitFactor: number | 'Infinity' | null;
  withinRegimeDrawdown: number;
}

function roundCell(m: RegimeMetrics): RegimeCell {
  let pf: number | 'Infinity' | null;
  if (m.profitFactor === null) pf = null;
  else if (!Number.isFinite(m.profitFactor)) pf = 'Infinity';
  else pf = +m.profitFactor.toFixed(3);
  return {
    regime: m.regime,
    trades: m.trades,
    winRate: +m.winRate.toFixed(4),
    expectancy: +m.expectancy.toFixed(6),
    profitFactor: pf,
    withinRegimeDrawdown: +m.withinRegimeDrawdown.toFixed(4),
  };
}

/** One base entry's full per-regime row (all three regimes). */
export interface EntryRow {
  entry: string;
  byRegime: Record<MarketRegime, RegimeCell>;
}

/**
 * Run perRegimeMetrics for one base entry over `candles` and shape the result
 * into a JSON-stable row. The trend bucket gets the C2 trend filter (the
 * harness default applyTrendFilterToTrend=true); volatile/range do not. Costs +
 * geometry come from `backtest` (crypto perp + live ATR for the real run).
 */
export function entryRow(candles: OHLCV[], named: NamedEntry, backtest: BacktestOptions): EntryRow {
  const { byRegime } = perRegimeMetrics(candles, named.entry, { backtest });
  const out = {} as Record<MarketRegime, RegimeCell>;
  for (const r of REGIMES) out[r] = roundCell(byRegime[r]);
  return { entry: named.id, byRegime: out };
}

/**
 * The full 2×3 entry×regime matrix for one candle window. Drives both the
 * full-range result and each fold. `entries` is the set of base entries
 * (classic + vwap-ema-bb); each produces one EntryRow.
 */
export function entryRegimeMatrix(
  candles: OHLCV[],
  entries: ReadonlyArray<NamedEntry>,
  backtest: BacktestOptions,
): EntryRow[] {
  return entries.map((e) => entryRow(candles, e, backtest));
}

/** A routed-diagonal cell projected out of the matrix, for the headline gate read. */
export interface RoutedCell {
  route: 'trend' | 'volatile' | 'range';
  entry: string;
  regime: MarketRegime;
  cell: RegimeCell;
}

const ROUTE_OF_REGIME: Record<MarketRegime, 'trend' | 'volatile' | 'range'> = {
  trend: 'trend',
  volatile: 'volatile',
  range: 'range',
};

/**
 * Project the routed diagonal (classic@trend, vwap-ema-bb@volatile,
 * vwap-ema-bb@range) out of a computed matrix. This is the gate-relevant slice:
 * the three cells whose cost-adjusted expectancy must be > 0 to pass on paper.
 */
export function routedDiagonal(matrix: EntryRow[]): RoutedCell[] {
  const byEntry = new Map(matrix.map((row) => [row.entry, row]));
  const out: RoutedCell[] = [];
  for (const { entry, regime } of ROUTED_DIAGONAL) {
    const row = byEntry.get(entry);
    if (!row) continue; // entry not in the evaluated set — skip rather than throw
    out.push({ route: ROUTE_OF_REGIME[regime], entry, regime, cell: row.byRegime[regime] });
  }
  return out;
}
