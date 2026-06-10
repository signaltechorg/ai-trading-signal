import candles from '../fixtures/candles-100.json';
import {
  regimeAwareEntry,
  MIN_REGIME_CLASSIFICATION_BARS,
} from '../../entry/regime-aware';
import { classicEntry } from '../../entry/classic';
import { setModel, getDefaultModel } from '@tradeclaw/signals';
import type { HMMModelParams } from '@tradeclaw/signals';

/**
 * Model injection note: the classifier caches models per ASSET CLASS and the
 * cache cannot be cleared from here (clearModelCache is not part of the
 * package public API). Each injecting test therefore uses a symbol from an
 * asset class no other test touches: XAUUSD → metals (valid model),
 * EURUSD → forex (broken model). BTCUSD/crypto tests never inject.
 */

describe('regime-aware entry module', () => {
  it('has id "regime-aware"', () => {
    expect(regimeAwareEntry.id).toBe('regime-aware');
  });

  it('produces a subset of classic signals (filters, never adds)', () => {
    const ctx = { symbol: 'BTCUSD', timeframe: 'H1' };
    const classic = classicEntry.generateSignals(candles as any, ctx);
    const regime = regimeAwareEntry.generateSignals(candles as any, ctx);
    expect(regime.length).toBeLessThanOrEqual(classic.length);
    for (const sig of regime) {
      const match = classic.find(
        (c) => c.barIndex === sig.barIndex && c.direction === sig.direction,
      );
      expect(match).toBeDefined();
    }
  });

  it('is deterministic', () => {
    const ctx = { symbol: 'BTCUSD', timeframe: 'H1' };
    const a = regimeAwareEntry.generateSignals(candles as any, ctx);
    const b = regimeAwareEntry.generateSignals(candles as any, ctx);
    expect(a).toEqual(b);
  });

  describe('pass-through contract (Phase 3, plan D2)', () => {
    it('passes both directions once classification succeeds: output equals classic', () => {
      // XAUUSD → metals. Inject a valid model so classification deterministically
      // succeeds without touching model files on disk.
      setModel('metals', getDefaultModel('metals'));
      const ctx = { symbol: 'XAUUSD', timeframe: 'H1' };
      const classic = classicEntry.generateSignals(candles as any, ctx);
      // Non-vacuous: at least one signal must sit past the classification
      // minimum so the regime filter actually classifies (not just fail-open).
      expect(
        classic.some((s) => s.barIndex + 1 >= MIN_REGIME_CLASSIFICATION_BARS),
      ).toBe(true);
      // All structural regimes allow BUY and SELL (direction routing is
      // Phase 4), so the filter must pass every classic signal through.
      const regime = regimeAwareEntry.generateSignals(candles as any, ctx);
      expect(regime).toEqual(classic);
    });
  });

  describe('fail-open contract', () => {
    it('allows all signals through when the window is too short to classify', () => {
      const short = (candles as any[]).slice(0, MIN_REGIME_CLASSIFICATION_BARS - 1);
      const ctx = { symbol: 'BTCUSD', timeframe: 'H1' };
      const classic = classicEntry.generateSignals(short as any, ctx);
      expect(classic.length).toBeGreaterThan(0); // non-vacuous
      expect(regimeAwareEntry.generateSignals(short as any, ctx)).toEqual(classic);
    });

    it('allows all signals through when the classifier throws', () => {
      // EURUSD → forex. Inject a model whose state labels are outside the
      // canonical vocabulary: classifyRegime decodes fine, then throws on the
      // label lookup — exercising the catch → fail-open path.
      const broken: HMMModelParams = {
        ...getDefaultModel('forex'),
        state_labels: { '0': 'up', '1': 'down', '2': 'sideways' } as any,
      };
      setModel('forex', broken);
      const ctx = { symbol: 'EURUSD', timeframe: 'H1' };
      const classic = classicEntry.generateSignals(candles as any, ctx);
      // Non-vacuous: the throw path only fires for windows past the minimum.
      expect(
        classic.some((s) => s.barIndex + 1 >= MIN_REGIME_CLASSIFICATION_BARS),
      ).toBe(true);
      expect(regimeAwareEntry.generateSignals(candles as any, ctx)).toEqual(classic);
    });
  });
});
