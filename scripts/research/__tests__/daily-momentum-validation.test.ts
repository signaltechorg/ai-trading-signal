/**
 * Determinism + smoke test for the Phase 4.5 D4 daily-momentum validation CLI's
 * pure metric-assembly layer (daily-momentum-assembly.ts).
 *
 * The heavy real run (10 majors, ~6 years of daily bars) is EVIDENCE, committed
 * as the report JSON — not a unit test. This test instead pins the assembly
 * contract on a small deterministic synthetic daily series:
 *   - computeSymbol produces a full-range result + the requested folds, each with
 *     all three configs (signal-flip, geometry-2R, geometry-4R),
 *   - cells are JSON-stable (rounded; profitFactor null/number/'Infinity'),
 *   - the costed vs zero-cost split is coherent (drag = zero − costed),
 *   - aggregateConfig counts positives/thin/folds correctly,
 *   - verdictFor enforces the deployable bar (mean>0 + majority + sample + folds),
 *   - identical inputs → byte-identical serialized metrics (the determinism
 *     contract the CLI's report depends on).
 *
 * No disk I/O, no DB, no candle dumps — the synthetic series is built in-memory,
 * exactly the convention regime-backtest-cli.test.ts uses.
 */

import {
  CONFIGS,
  THIN_CELL_MIN_TRADES,
  DAILY_MOMENTUM_STRATEGY,
  toMetrics,
  windowCells,
  computeSymbol,
  aggregateConfig,
  verdictFor,
  type SymbolResult,
  type ConfigAggregate,
  type CostedCell,
} from '../daily-momentum-assembly';
import { CRYPTO_PERP_COSTS, runBacktest, ZERO_COSTS } from '../../../packages/strategies/src';
import type { OHLCV } from '@tradeclaw/core';

const BASE_TS = 1_600_000_000_000;
const DAY_MS = 86_400_000;

/**
 * A long daily series with several deterministic trend reversals so the
 * 28-day momentum cross actually fires both long and short. Triangle-wave drift
 * (up for ~120 bars, down for ~120, repeat) layered with a small oscillation,
 * plus a tiny per-bar high/low band. No RNG — fully deterministic. 800 bars
 * clears the 28-bar momentum + 14-bar ATR warmup and gives multiple crosses.
 */
function syntheticDailyCandles(n: number): OHLCV[] {
  return Array.from({ length: n }, (_, i) => {
    const phase = i % 240;
    const leg = phase < 120 ? phase : 240 - phase; // 0→120→0 triangle
    const trend = 100 + leg * 0.8;
    const wobble = Math.sin(i / 9) * 2;
    const close = trend + wobble;
    const high = close + 2;
    const low = close - 2;
    const open = close - wobble * 0.4;
    return { timestamp: BASE_TS + i * DAY_MS, open, high, low, close, volume: 1000 + (i % 13) };
  });
}

const COSTS = CRYPTO_PERP_COSTS;
const BAR_HOURS = 24;
const CTX = { symbol: 'BTCUSD', timeframe: 'D1' };

describe('daily-momentum-assembly — window + symbol shape', () => {
  const candles = syntheticDailyCandles(800);

  it('windowCells produces all three configs, each with a costed + zero-cost run', () => {
    const cells = windowCells(candles, COSTS, BAR_HOURS, CTX);
    expect(Object.keys(cells).sort()).toEqual(['geometry-2R', 'geometry-4R', 'signal-flip']);
    for (const cfg of CONFIGS) {
      const c = cells[cfg.id];
      expect(c.costed).toBeDefined();
      expect(c.zeroCost).toBeDefined();
      // Costs only ever reduce return → costed ≤ zero-cost; drag is non-negative.
      expect(c.costed.totalReturn).toBeLessThanOrEqual(c.zeroCost.totalReturn);
      expect(c.frictionDrag).toBeGreaterThanOrEqual(0);
      // The zero-cost run charges nothing.
      expect(c.zeroCost.avgCostPct).toBe(0);
    }
  });

  it('the zero-cost run charges 0 cost while the costed run charges > 0 when trades exist', () => {
    const cells = windowCells(candles, COSTS, BAR_HOURS, CTX);
    const sf = cells['signal-flip'];
    expect(sf.costed.totalTrades).toBeGreaterThan(0);
    expect(sf.costed.avgCostPct).toBeGreaterThan(0);
  });

  it('drag equals zero-cost minus costed return (rounded)', () => {
    const cells = windowCells(candles, COSTS, BAR_HOURS, CTX);
    for (const cfg of CONFIGS) {
      const c = cells[cfg.id];
      expect(c.frictionDrag).toBe(+(c.zeroCost.totalReturn - c.costed.totalReturn).toFixed(6));
    }
  });

  it('computeSymbol returns the full range plus the requested fold count', () => {
    const r = computeSymbol('BTCUSD', candles, 4, COSTS, BAR_HOURS, 'D1');
    expect(r.symbol).toBe('BTCUSD');
    expect(r.candleCount).toBe(800);
    expect(r.folds).toHaveLength(4);
    for (const f of r.folds) {
      expect(Object.keys(f.byConfig).sort()).toEqual(['geometry-2R', 'geometry-4R', 'signal-flip']);
      expect(f.candleCount).toBeGreaterThan(0);
    }
    // Folds partition the series with no gaps/overlap.
    expect(r.folds.reduce((s, f) => s + f.candleCount, 0)).toBe(800);
  });
});

describe('daily-momentum-assembly — toMetrics JSON-stability', () => {
  const candles = syntheticDailyCandles(800);

  it('rounds every numeric field to its fixed precision (re-rounding is a no-op)', () => {
    const cells = windowCells(candles, COSTS, BAR_HOURS, CTX);
    for (const cfg of CONFIGS) {
      for (const m of [cells[cfg.id].costed, cells[cfg.id].zeroCost]) {
        expect(+m.winRate.toFixed(4)).toBe(m.winRate);
        expect(+m.totalReturn.toFixed(6)).toBe(m.totalReturn);
        expect(+m.expectancy.toFixed(6)).toBe(m.expectancy);
        expect(+m.maxDrawdown.toFixed(4)).toBe(m.maxDrawdown);
        expect(+m.avgCostPct.toFixed(4)).toBe(m.avgCostPct);
        expect(m.profitFactor === null || m.profitFactor === 'Infinity' || Number.isFinite(m.profitFactor)).toBe(true);
      }
    }
  });

  it('a zero-trade run serializes profitFactor null and a reason, not a phantom number', () => {
    // Too few bars to clear the 28-bar momentum warmup → no signals.
    const tiny = syntheticDailyCandles(20);
    const m = toMetrics(runBacktest(tiny, DAILY_MOMENTUM_STRATEGY, { costs: ZERO_COSTS, barHours: BAR_HOURS, context: CTX }));
    expect(m.totalTrades).toBe(0);
    expect(m.profitFactor).toBeNull();
    expect(m.reason).not.toBeNull();
  });
});

describe('daily-momentum-assembly — determinism', () => {
  it('identical synthetic candles yield byte-identical serialized cells', () => {
    const a = windowCells(syntheticDailyCandles(800), COSTS, BAR_HOURS, CTX);
    const b = windowCells(syntheticDailyCandles(800), COSTS, BAR_HOURS, CTX);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('a full computeSymbol run is byte-identical on a re-run (no hidden global drift)', () => {
    const a = computeSymbol('BTCUSD', syntheticDailyCandles(800), 4, COSTS, BAR_HOURS, 'D1');
    const b = computeSymbol('BTCUSD', syntheticDailyCandles(800), 4, COSTS, BAR_HOURS, 'D1');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ===========================================================================
// Aggregate + verdict logic — built from synthetic SymbolResults directly so
// the robustness gate is isolated from the backtest (fast, exhaustive).
// ===========================================================================

/** A minimal CostedCell with a chosen costed return + trade count. */
function fakeCell(costedReturn: number, trades: number): CostedCell {
  const m = (ret: number) => ({
    totalTrades: trades,
    winRate: 0.3,
    totalReturn: ret,
    expectancy: ret / Math.max(1, trades),
    profitFactor: 1.1 as number | 'Infinity' | null,
    maxDrawdown: 0.2,
    sharpeRatio: 0.5,
    avgCostPct: 0.4,
    reason: null,
  });
  return { costed: m(costedReturn), zeroCost: m(costedReturn + 0.05), frictionDrag: 0.05 };
}

/** A SymbolResult whose every config + every fold carries the same fake cell. */
function fakeSymbol(symbol: string, costedReturn: number, trades: number, foldReturns: number[]): SymbolResult {
  const cellFor = (ret: number) => ({
    'signal-flip': fakeCell(ret, trades),
    'geometry-2R': fakeCell(ret, trades),
    'geometry-4R': fakeCell(ret, trades),
  });
  return {
    symbol,
    candleCount: 2000,
    firstBar: '2020-06-12T00:00:00.000Z',
    lastBar: '2026-06-10T00:00:00.000Z',
    full: cellFor(costedReturn),
    folds: foldReturns.map((ret, i) => ({
      label: `fold${i + 1}`,
      from: '2020-01-01',
      to: '2021-01-01',
      candleCount: 500,
      byConfig: cellFor(ret),
    })),
  };
}

describe('aggregateConfig — counts positives, thin, and fold stability', () => {
  it('counts a symbol positive-and-adequate only when return > 0 AND trades ≥ threshold', () => {
    const symbols = [
      fakeSymbol('A', 0.1, 50, [0.1, 0.1, 0.1, 0.1]), // positive, adequate
      fakeSymbol('B', 0.1, 10, [0.1, 0.1, 0.1, 0.1]), // positive but THIN
      fakeSymbol('C', -0.1, 50, [-0.1, -0.1, -0.1, -0.1]), // adequate but negative
    ];
    const agg = aggregateConfig('signal-flip', symbols);
    expect(agg.symbolsTotal).toBe(3);
    expect(agg.symbolsPositiveRaw).toBe(2); // A + B
    expect(agg.symbolsPositiveAndAdequate).toBe(1); // only A
    expect(agg.symbolsThin).toBe(1); // B
  });

  it('fold stability is the fraction of (symbol × fold) cells with positive costed return', () => {
    const symbols = [
      fakeSymbol('A', 0.1, 50, [0.1, -0.1, 0.1, -0.1]), // 2/4 positive
      fakeSymbol('B', 0.1, 50, [0.1, 0.1, 0.1, 0.1]), // 4/4 positive
    ];
    const agg = aggregateConfig('signal-flip', symbols);
    // 6 positive fold cells out of 8 total.
    expect(agg.foldStability).toBe(+(6 / 8).toFixed(4));
  });
});

describe('verdictFor — the deployable bar', () => {
  const baseAgg = (over: Partial<ConfigAggregate>): ConfigAggregate => ({
    config: 'signal-flip',
    symbolsTotal: 10,
    symbolsPositiveAndAdequate: 6,
    symbolsPositiveRaw: 6,
    symbolsThin: 0,
    meanCostedReturn: 0.1,
    meanZeroCostReturn: 0.15,
    meanExpectancy: 0.01,
    meanFrictionDrag: 0.05,
    meanTrades: 80,
    foldStability: 0.6,
    ...over,
  });

  it('DEPLOYABLE when mean > 0, majority positive+adequate, adequate sample, robust folds', () => {
    expect(verdictFor(baseAgg({})).verdict).toBe('DEPLOYABLE');
  });

  it('NEGATIVE when the mean cost-adjusted return is not positive', () => {
    expect(verdictFor(baseAgg({ meanCostedReturn: -0.05 })).verdict).toBe('NEGATIVE');
  });

  it('NEGATIVE when the mean is positive but the mean expectancy is not', () => {
    expect(verdictFor(baseAgg({ meanExpectancy: -0.001 })).verdict).toBe('NEGATIVE');
  });

  it('MARGINAL when positive overall but fewer than a majority of symbols clear', () => {
    const v = verdictFor(baseAgg({ symbolsPositiveAndAdequate: 4 }));
    expect(v.verdict).toBe('MARGINAL');
    expect(v.reasons.join(' ')).toMatch(/4\/10 symbols positive-and-adequate/);
  });

  it('MARGINAL when positive overall but folds are not robust across time', () => {
    const v = verdictFor(baseAgg({ foldStability: 0.4 }));
    expect(v.verdict).toBe('MARGINAL');
    expect(v.reasons.join(' ')).toMatch(/fold stability/);
  });

  it('MARGINAL when the overall sample is thin (mean trades below the floor)', () => {
    const v = verdictFor(baseAgg({ meanTrades: THIN_CELL_MIN_TRADES - 1 }));
    expect(v.verdict).toBe('MARGINAL');
    expect(v.reasons.join(' ')).toMatch(/below the 30-trade floor/);
  });

  it('majority is strictly more than half (6 of 10 passes, 5 does not)', () => {
    expect(verdictFor(baseAgg({ symbolsPositiveAndAdequate: 6 })).verdict).toBe('DEPLOYABLE');
    expect(verdictFor(baseAgg({ symbolsPositiveAndAdequate: 5 })).verdict).toBe('MARGINAL');
  });
});
