import { computePricingStats, type RawPricingAgg } from '../pricing-stats';

describe('pricing-stats — computePricingStats', () => {
  it('returns nulls when no rows resolved yet', () => {
    const stats = computePricingStats(null);
    expect(stats).toEqual({
      closedSignalsAllTime: 0,
      winRatePct: null,
      cumulativePnlPct: 0,
    });
  });

  it('computes win rate and cumulative PnL from raw aggregate', () => {
    const agg: RawPricingAgg = {
      closed_count: '100',
      wins: '73',
      cumulative_pnl: '128.5',
    };
    const stats = computePricingStats(agg);
    expect(stats.closedSignalsAllTime).toBe(100);
    expect(stats.winRatePct).toBe(73);
    expect(stats.cumulativePnlPct).toBeCloseTo(128.5, 1);
  });

  it('rounds win rate to one decimal', () => {
    const agg: RawPricingAgg = {
      closed_count: '300',
      wins: '187',
      cumulative_pnl: '42.0',
    };
    // 187 / 300 = 0.6233... → 62.3
    const stats = computePricingStats(agg);
    expect(stats.winRatePct).toBeCloseTo(62.3, 1);
  });

  it('treats zero closed count as null win rate, not NaN', () => {
    const agg: RawPricingAgg = {
      closed_count: '0',
      wins: '0',
      cumulative_pnl: '0',
    };
    const stats = computePricingStats(agg);
    expect(stats.closedSignalsAllTime).toBe(0);
    expect(stats.winRatePct).toBeNull();
    expect(stats.cumulativePnlPct).toBe(0);
  });

  it('coerces string fields safely; non-numeric → 0 / null', () => {
    const agg: RawPricingAgg = {
      closed_count: 'abc',
      wins: 'xyz',
      cumulative_pnl: 'NaN',
    };
    const stats = computePricingStats(agg);
    expect(stats.closedSignalsAllTime).toBe(0);
    expect(stats.winRatePct).toBeNull();
    expect(stats.cumulativePnlPct).toBe(0);
  });
});
