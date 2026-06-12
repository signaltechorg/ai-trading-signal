/**
 * Tests for the daily time-series momentum entry module (Phase 4.5, D2).
 * Written first (TDD), then the implementation is filled in.
 *
 * Signal: trailing N-day return relative to the N-day SMA.
 *   momentum(i) = close[i] - SMA_N(close, i)   (price vs trailing N-day MA)
 *   long bias when momentum > 0, short when momentum < 0.
 * Entry timing: emit ONLY on a fresh momentum cross (sign flip of momentum),
 *   so a sustained trend produces a single entry, not one per bar.
 * Confidence: normalized |distance of price from the N-day MA|, clamped [0,1].
 */
import type { OHLCV } from '@tradeclaw/core';
import { dailyMomentumEntry } from '../entry/daily-momentum';

const BASE_TS = 1700000000000;
const DAY_MS = 86_400_000;

const CTX = { symbol: 'BTCUSDT', timeframe: '1d' } as const;

/** Build candles from an explicit close series. Wicks are tight & symmetric. */
function candlesFromCloses(closes: number[]): OHLCV[] {
  return closes.map((close, i) => ({
    timestamp: BASE_TS + i * DAY_MS,
    open: close,
    high: close + Math.abs(close) * 0.001,
    low: close - Math.abs(close) * 0.001,
    close,
    volume: 100,
  }));
}

/** Monotonically rising close series. */
function risingCloses(n: number, start = 100, step = 1): number[] {
  return Array.from({ length: n }, (_, i) => start + i * step);
}

/** Monotonically falling close series. */
function fallingCloses(n: number, start = 300, step = 1): number[] {
  return Array.from({ length: n }, (_, i) => start - i * step);
}

/** Flat (constant) close series. */
function flatCloses(n: number, value = 100): number[] {
  return Array.from({ length: n }, () => value);
}

/**
 * A trend ONSET: `flat` bars at `value`, then `rise` bars climbing by `step`.
 * The cross detector needs an onset — a price that starts at/below its trailing
 * MA and then rises through it — to fire. A strictly monotonic-from-bar-0 series
 * is above its own trailing MA from the first computable bar and so never
 * crosses; that degenerate case is intentionally a no-signal case. Real trends
 * have an onset, which is exactly what this module is built to catch.
 */
function flatThenRising(flat: number, rise: number, value = 100, step = 1): number[] {
  return [...flatCloses(flat, value), ...risingCloses(rise, value, step)];
}

/** A trend onset in the other direction: flat, then falling through the MA. */
function flatThenFalling(flat: number, fall: number, value = 300, step = 1): number[] {
  return [...flatCloses(flat, value), ...fallingCloses(fall, value, step)];
}

describe('dailyMomentumEntry', () => {
  it('exposes the expected module id', () => {
    expect(dailyMomentumEntry.id).toBe('daily-momentum');
  });

  describe('momentum signal correctness', () => {
    it('emits LONG on a clearly rising series (after an onset)', () => {
      // Flat, then a clear sustained rise. The rise crosses up through the MA
      // exactly once → one LONG entry, and no SHORT ever appears in an uptrend.
      const candles = candlesFromCloses(flatThenRising(40, 100));
      const signals = dailyMomentumEntry.generateSignals(candles, CTX);
      expect(signals.length).toBeGreaterThan(0);
      expect(signals.every((s) => s.direction === 'BUY')).toBe(true);
    });

    it('emits SHORT on a clearly falling series (after an onset)', () => {
      const candles = candlesFromCloses(flatThenFalling(40, 100));
      const signals = dailyMomentumEntry.generateSignals(candles, CTX);
      expect(signals.length).toBeGreaterThan(0);
      expect(signals.every((s) => s.direction === 'SELL')).toBe(true);
    });

    it('emits NOTHING on a strictly monotonic series with no onset', () => {
      // Documented edge case: a series above its own trailing MA from the first
      // computable bar never crosses, so the cross detector stays silent. This
      // is correct, not a miss — there is no trend ONSET to capture.
      const rising = dailyMomentumEntry.generateSignals(candlesFromCloses(risingCloses(120)), CTX);
      const falling = dailyMomentumEntry.generateSignals(candlesFromCloses(fallingCloses(120)), CTX);
      expect(rising.length).toBe(0);
      expect(falling.length).toBe(0);
    });

    it('emits little/nothing on a flat series', () => {
      const candles = candlesFromCloses(flatCloses(120));
      const signals = dailyMomentumEntry.generateSignals(candles, CTX);
      // Flat price never crosses its own MA → no momentum cross.
      expect(signals.length).toBe(0);
    });
  });

  describe('entry-timing — low-frequency property', () => {
    it('does NOT emit a signal on every bar of a sustained uptrend', () => {
      // 40 flat (onset), then 200 rising bars. ~200 bars sit above the MA, but
      // only the single onset cross fires — proving the low-frequency property.
      const candles = candlesFromCloses(flatThenRising(40, 200));
      const aboveMaBars = 200; // bars where momentum is positive
      const signals = dailyMomentumEntry.generateSignals(candles, CTX);
      expect(signals.length).toBe(1);
      expect(signals.length).toBeLessThan(aboveMaBars / 10);
    });

    it('emits one entry per regime change, not per bar (down→up→down)', () => {
      // 60 falling, then 60 rising, then 60 falling. Each leg is long enough
      // for the trailing-MA momentum to flip sign exactly once per turn.
      const closes = [
        ...fallingCloses(60, 300, 2),
        ...risingCloses(60, 180, 2),
        ...fallingCloses(60, 300, 2),
      ];
      const candles = candlesFromCloses(closes);
      const signals = dailyMomentumEntry.generateSignals(candles, CTX);
      // At most a handful of crosses across three legs — tens-per-year scale,
      // not hundreds. Concretely: well under 10 over 180 bars.
      expect(signals.length).toBeLessThan(10);
      expect(signals.length).toBeGreaterThanOrEqual(1);
      // There must be at least one BUY (the up-leg onset).
      expect(signals.some((s) => s.direction === 'BUY')).toBe(true);
    });
  });

  describe('no lookahead', () => {
    it('a signal at bar i is identical when the series is truncated at i+1', () => {
      const closes = [
        ...fallingCloses(50, 300, 2),
        ...risingCloses(80, 200, 2),
      ];
      const candles = candlesFromCloses(closes);
      const full = dailyMomentumEntry.generateSignals(candles, CTX);
      expect(full.length).toBeGreaterThan(0);

      for (const sig of full) {
        const truncated = candles.slice(0, sig.barIndex + 1);
        const reRun = dailyMomentumEntry.generateSignals(truncated, CTX);
        const last = reRun[reRun.length - 1];
        // The signal at bar i must be reproducible from candles[0..i] alone.
        expect(last).toBeDefined();
        expect(last.barIndex).toBe(sig.barIndex);
        expect(last.direction).toBe(sig.direction);
        expect(last.price).toBe(sig.price);
        expect(last.confidence).toBeCloseTo(sig.confidence, 10);
      }
    });
  });

  describe('warmup', () => {
    it('emits nothing when there are fewer than N bars', () => {
      // Default N = 28; fewer than that → no signals at all.
      const candles = candlesFromCloses(risingCloses(20));
      const signals = dailyMomentumEntry.generateSignals(candles, CTX);
      expect(signals).toEqual([]);
    });

    it('emits nothing for an empty series', () => {
      expect(dailyMomentumEntry.generateSignals([], CTX)).toEqual([]);
    });
  });

  describe('determinism', () => {
    it('produces identical signals for identical input', () => {
      const candles = candlesFromCloses([
        ...risingCloses(70, 100, 1.5),
        ...fallingCloses(70, 205, 1.5),
      ]);
      const a = dailyMomentumEntry.generateSignals(candles, CTX);
      const b = dailyMomentumEntry.generateSignals(candles, CTX);
      expect(a).toEqual(b);
    });
  });

  describe('confidence convention', () => {
    it('is always within [0, 1]', () => {
      const candles = candlesFromCloses([
        ...fallingCloses(60, 300, 2),
        ...risingCloses(60, 180, 2),
        ...fallingCloses(60, 300, 2),
      ]);
      const signals = dailyMomentumEntry.generateSignals(candles, CTX);
      expect(signals.length).toBeGreaterThan(0);
      for (const s of signals) {
        expect(s.confidence).toBeGreaterThanOrEqual(0);
        expect(s.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('increases with momentum strength (bigger gap to MA → higher confidence)', () => {
      // Two crosses with different post-cross slope. A steeper rise puts price
      // further above its MA at the cross bar → higher confidence.
      const gentle = candlesFromCloses([
        ...fallingCloses(40, 200, 1),
        ...risingCloses(60, 160, 0.5),
      ]);
      const steep = candlesFromCloses([
        ...fallingCloses(40, 200, 1),
        ...risingCloses(60, 160, 4),
      ]);
      const gentleSig = dailyMomentumEntry.generateSignals(gentle, CTX).find((s) => s.direction === 'BUY');
      const steepSig = dailyMomentumEntry.generateSignals(steep, CTX).find((s) => s.direction === 'BUY');
      expect(gentleSig).toBeDefined();
      expect(steepSig).toBeDefined();
      expect(steepSig!.confidence).toBeGreaterThan(gentleSig!.confidence);
    });
  });
});
