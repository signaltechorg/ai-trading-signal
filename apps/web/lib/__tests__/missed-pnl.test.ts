import {
  computeMissedPnl,
  type MissedPnlSignal,
} from '../missed-pnl';

function sig(overrides: Partial<MissedPnlSignal> = {}): MissedPnlSignal {
  return {
    symbol: 'BTCUSD',
    direction: 'BUY',
    pnlPct: 2,
    createdAt: '2026-05-08T00:00:00.000Z',
    ...overrides,
  };
}

describe('missed-pnl — computeMissedPnl', () => {
  it('returns empty result when no signals', () => {
    const result = computeMissedPnl([]);
    expect(result).toEqual({
      signals: [],
      totalPnlPct: 0,
      totalPnlDollars: 0,
    });
  });

  it('picks top N by pnlPct descending', () => {
    const inputs: MissedPnlSignal[] = [
      sig({ symbol: 'A', pnlPct: 1 }),
      sig({ symbol: 'B', pnlPct: 5 }),
      sig({ symbol: 'C', pnlPct: 3 }),
      sig({ symbol: 'D', pnlPct: 4 }),
      sig({ symbol: 'E', pnlPct: 2 }),
    ];
    const result = computeMissedPnl(inputs, { topN: 3 });
    expect(result.signals.map((s) => s.symbol)).toEqual(['B', 'D', 'C']);
    expect(result.totalPnlPct).toBeCloseTo(12, 5);
  });

  it('default top N is 3', () => {
    const inputs: MissedPnlSignal[] = [
      sig({ symbol: 'A', pnlPct: 1 }),
      sig({ symbol: 'B', pnlPct: 2 }),
      sig({ symbol: 'C', pnlPct: 3 }),
      sig({ symbol: 'D', pnlPct: 4 }),
    ];
    const result = computeMissedPnl(inputs);
    expect(result.signals).toHaveLength(3);
  });

  it('excludes negative pnlPct — only counts wins they missed', () => {
    const inputs: MissedPnlSignal[] = [
      sig({ symbol: 'A', pnlPct: 5 }),
      sig({ symbol: 'B', pnlPct: -3 }),
      sig({ symbol: 'C', pnlPct: -10 }),
      sig({ symbol: 'D', pnlPct: 2 }),
    ];
    const result = computeMissedPnl(inputs, { topN: 3 });
    expect(result.signals.map((s) => s.symbol)).toEqual(['A', 'D']);
    expect(result.totalPnlPct).toBeCloseTo(7, 5);
  });

  it('computes dollars from default 1% sizing on $10k', () => {
    // pnlPct=5 means price moved 5%. 1% of $10k = $100 position.
    // $100 * 5% = $5 P&L per trade.
    const inputs: MissedPnlSignal[] = [sig({ pnlPct: 5 })];
    const result = computeMissedPnl(inputs, { topN: 1 });
    expect(result.totalPnlPct).toBeCloseTo(5, 5);
    expect(result.totalPnlDollars).toBeCloseTo(5, 2);
  });

  it('respects custom positionSizePct and notional', () => {
    // 2% size on $50k account = $1000 position. 5% move = $50.
    const inputs: MissedPnlSignal[] = [sig({ pnlPct: 5 })];
    const result = computeMissedPnl(inputs, {
      topN: 1,
      positionSizePct: 2,
      notional: 50_000,
    });
    expect(result.totalPnlDollars).toBeCloseTo(50, 2);
  });

  it('returns zero dollars when all signals are losses', () => {
    const inputs: MissedPnlSignal[] = [
      sig({ pnlPct: -2 }),
      sig({ pnlPct: -5 }),
    ];
    const result = computeMissedPnl(inputs);
    expect(result.totalPnlPct).toBe(0);
    expect(result.totalPnlDollars).toBe(0);
    expect(result.signals).toHaveLength(0);
  });

  it('rounds dollars to two decimal places', () => {
    // 3.33% on 1% size of $10k = $3.33
    const inputs: MissedPnlSignal[] = [sig({ pnlPct: 3.33 })];
    const result = computeMissedPnl(inputs, { topN: 1 });
    expect(result.totalPnlDollars).toBeCloseTo(3.33, 2);
  });
});
