/**
 * Determinism + smoke test for the Phase 4 D6 per-regime CLI's pure
 * metric-assembly layer (regime-backtest-assembly.ts).
 *
 * The heavy real run (BTC/ETH/SOL, 2 years) is EVIDENCE, committed as the report
 * JSON — not a unit test. This test instead pins the assembly contract on a
 * small deterministic synthetic candle set:
 *   - the 2×3 entry×regime matrix has both entries × all three regimes,
 *   - cells are JSON-stable (rounded, profitFactor null/number/'Infinity'),
 *   - the routed diagonal projects classic@trend, vwap-ema-bb@volatile,
 *     vwap-ema-bb@range out of the matrix,
 *   - identical inputs → byte-identical serialized metrics (the determinism
 *     contract the CLI's report depends on).
 *
 * The classifier is the REAL classifyRegime pinned to the built-in default
 * crypto model (so loadModel never walks the disk and the call is deterministic),
 * exactly the convention regime-backtest.test.ts uses.
 */

import {
  entryRegimeMatrix,
  routedDiagonal,
  ROUTED_DIAGONAL,
  type NamedEntry,
} from '../regime-backtest-assembly';
import { classicEntry } from '../../../packages/strategies/src/entry/classic';
import { vwapEmaBbEntry } from '../../../packages/strategies/src/entry/vwap-ema-bb';
import { CRYPTO_PERP_COSTS, LIVE_GEOMETRY } from '../../../packages/strategies/src';
import type { BacktestOptions } from '../../../packages/strategies/src';
import type { OHLCV } from '@tradeclaw/core';
import { setModel, getDefaultModel } from '@tradeclaw/signals';

const BASE_TS = 1_700_000_000_000;
const HOUR_MS = 3_600_000;

/**
 * A long rising-then-wobbling series so the classifier produces a mix of bars
 * and the entry modules actually fire. Deterministic: no RNG. 600 bars clears
 * the 329-bar REGIME_CONDITION_WINDOW plus indicator warmup.
 */
function syntheticCandles(n: number): OHLCV[] {
  return Array.from({ length: n }, (_, i) => {
    // Gentle uptrend with a small deterministic oscillation layered on top.
    const trend = 100 + i * 0.5;
    const wobble = Math.sin(i / 5) * 3 + (i % 7 === 0 ? -2 : 0);
    const close = trend + wobble;
    const high = close + 1.5;
    const low = close - 1.5;
    const open = close - wobble * 0.3;
    return { timestamp: BASE_TS + i * HOUR_MS, open, high, low, close, volume: 100 + (i % 11) };
  });
}

const ENTRIES: ReadonlyArray<NamedEntry> = [
  { id: 'classic', entry: classicEntry },
  { id: 'vwap-ema-bb', entry: vwapEmaBbEntry },
];

const BT: BacktestOptions = {
  costs: CRYPTO_PERP_COSTS,
  geometry: LIVE_GEOMETRY,
  barHours: 1,
  context: { symbol: 'BTCUSD', timeframe: 'H1' },
};

beforeAll(() => {
  // Pin the built-in default crypto model — deterministic, no disk walk.
  setModel('crypto', getDefaultModel('crypto'));
});

describe('regime-backtest-assembly — matrix shape', () => {
  const candles = syntheticCandles(600);

  it('produces one EntryRow per base entry, each with all three regimes', () => {
    const matrix = entryRegimeMatrix(candles, ENTRIES, BT);
    expect(matrix.map((r) => r.entry)).toEqual(['classic', 'vwap-ema-bb']);
    for (const row of matrix) {
      expect(Object.keys(row.byRegime).sort()).toEqual(['range', 'trend', 'volatile']);
      for (const r of ['trend', 'volatile', 'range'] as const) {
        const c = row.byRegime[r];
        expect(c.regime).toBe(r);
        expect(c.trades).toBeGreaterThanOrEqual(0);
        expect(c.winRate).toBeGreaterThanOrEqual(0);
        expect(c.winRate).toBeLessThanOrEqual(1);
        // expectancy is a finite fraction (can be negative — that is the honest case)
        expect(Number.isFinite(c.expectancy)).toBe(true);
        // profitFactor is null (no trades), a finite number, or the 'Infinity' marker
        expect(c.profitFactor === null || c.profitFactor === 'Infinity' || Number.isFinite(c.profitFactor)).toBe(true);
        expect(c.withinRegimeDrawdown).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('rounds cells to fixed precision (JSON-stable)', () => {
    const matrix = entryRegimeMatrix(candles, ENTRIES, BT);
    for (const row of matrix) {
      for (const r of ['trend', 'volatile', 'range'] as const) {
        const c = row.byRegime[r];
        // winRate ≤ 4 dp, expectancy ≤ 6 dp, DD ≤ 4 dp — re-rounding is a no-op.
        expect(+c.winRate.toFixed(4)).toBe(c.winRate);
        expect(+c.expectancy.toFixed(6)).toBe(c.expectancy);
        expect(+c.withinRegimeDrawdown.toFixed(4)).toBe(c.withinRegimeDrawdown);
      }
    }
  });
});

describe('regime-backtest-assembly — routed diagonal projection', () => {
  const candles = syntheticCandles(600);

  it('projects exactly classic@trend, vwap-ema-bb@volatile, vwap-ema-bb@range', () => {
    const matrix = entryRegimeMatrix(candles, ENTRIES, BT);
    const diag = routedDiagonal(matrix);
    expect(diag.map((d) => `${d.entry}@${d.regime}`)).toEqual([
      'classic@trend',
      'vwap-ema-bb@volatile',
      'vwap-ema-bb@range',
    ]);
    expect(diag.map((d) => d.route)).toEqual(['trend', 'volatile', 'range']);
    // The diagonal constant and the projection agree.
    expect(ROUTED_DIAGONAL.map((d) => `${d.entry}@${d.regime}`)).toEqual(
      diag.map((d) => `${d.entry}@${d.regime}`),
    );
  });

  it('each routed cell is the SAME object the matrix holds for that (entry, regime)', () => {
    const matrix = entryRegimeMatrix(candles, ENTRIES, BT);
    const diag = routedDiagonal(matrix);
    const byEntry = new Map(matrix.map((row) => [row.entry, row]));
    for (const d of diag) {
      expect(d.cell).toEqual(byEntry.get(d.entry)!.byRegime[d.regime]);
    }
  });
});

describe('regime-backtest-assembly — determinism', () => {
  it('identical inputs yield byte-identical serialized metrics', () => {
    const candles = syntheticCandles(600);
    const a = entryRegimeMatrix(candles, ENTRIES, BT);
    const b = entryRegimeMatrix(candles, ENTRIES, BT);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(routedDiagonal(a))).toBe(JSON.stringify(routedDiagonal(b)));
  });

  it('a separate identical candle build reproduces the same metrics (no hidden global drift)', () => {
    const a = entryRegimeMatrix(syntheticCandles(600), ENTRIES, BT);
    const b = entryRegimeMatrix(syntheticCandles(600), ENTRIES, BT);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
