/**
 * The calibration API previously compared signal_history's 0-100 confidence
 * against 0-1 bucket bounds: every bucket was empty, each fell back to
 * winRate = midpoint, and the reliability chart rendered as perfectly
 * calibrated — fabricated by construction. These tests pin the fix:
 * 0-100 → 0-1 normalization, the canonical isCountedResolved population,
 * and null (not midpoint) for empty buckets.
 */

jest.mock('@/lib/signal-history', () => {
  const actual = jest.requireActual('@/lib/signal-history');
  return {
    ...actual,
    readHistoryAsync: jest.fn(),
  };
});

import { GET } from '../route';
import { readHistoryAsync, type SignalHistoryRecord } from '@/lib/signal-history';

const mockedHistory = readHistoryAsync as jest.MockedFunction<typeof readHistoryAsync>;

function mkRecord(over: Partial<SignalHistoryRecord>): SignalHistoryRecord {
  return {
    id: Math.random().toString(36).slice(2),
    pair: 'BTCUSD',
    timeframe: 'H1',
    direction: 'BUY',
    confidence: 72,
    entryPrice: 50000,
    timestamp: Date.now() - 86_400_000,
    tp1: 51000,
    sl: 49500,
    isSimulated: false,
    gateBlocked: false,
    outcomes: {
      '4h': null,
      '24h': { price: 51000, pnlPct: 2.0, hit: true, target: 'TP1' },
    },
    ...over,
  };
}

beforeEach(() => {
  mockedHistory.mockReset();
});

describe('GET /api/calibration', () => {
  it('normalizes 0-100 confidence into the right buckets and excludes non-counted rows', async () => {
    mockedHistory.mockResolvedValue([
      // counted: conf 72 win → bucket 70-79%
      mkRecord({ id: 'win72', confidence: 72 }),
      // counted: conf 85 loss → bucket 80-89%
      mkRecord({
        id: 'loss85',
        confidence: 85,
        outcomes: { '4h': null, '24h': { price: 49500, pnlPct: -1.0, hit: false, target: 'SL' } },
      }),
      // excluded: auto-expired close
      mkRecord({
        id: 'expired',
        confidence: 75,
        outcomes: { '4h': null, '24h': { price: 50100, pnlPct: 0.2, hit: true, target: 'expired' } },
      }),
      // excluded: gate-blocked
      mkRecord({ id: 'gated', confidence: 75, gateBlocked: true }),
      // excluded: simulated
      mkRecord({ id: 'sim', confidence: 75, isSimulated: true }),
    ]);

    const res = await GET();
    const body = await res.json();

    expect(body.totalSignals).toBe(2);

    const byLabel = new Map(body.buckets.map((b: { label: string }) => [b.label, b]));
    expect(byLabel.get('70-79%')).toMatchObject({ count: 1, wins: 1, winRate: 1 });
    expect(byLabel.get('80-89%')).toMatchObject({ count: 1, wins: 0, winRate: 0 });

    // Empty buckets report null, NOT the fake midpoint fallback.
    expect(byLabel.get('50-59%')).toMatchObject({ count: 0, winRate: null, calibrationError: null });
    expect(byLabel.get('90-99%')).toMatchObject({ count: 0, winRate: null, calibrationError: null });

    // Brier on the 0-1 scale: ((0.72-1)^2 + (0.85-0)^2) / 2
    const expectedBrier = (Math.pow(0.72 - 1, 2) + Math.pow(0.85 - 0, 2)) / 2;
    expect(body.brier).toBeCloseTo(expectedBrier, 6);
  });

  it('confidence exactly 100 lands in the top bucket instead of falling out of all buckets', async () => {
    mockedHistory.mockResolvedValue([
      mkRecord({ id: 'conf100', confidence: 100 }),
    ]);

    const res = await GET();
    const body = await res.json();

    expect(body.totalSignals).toBe(1);
    const top = body.buckets.find((b: { label: string }) => b.label === '90-99%');
    expect(top).toMatchObject({ count: 1, wins: 1, winRate: 1 });
  });

  it('returns null brier/ece with no counted rows instead of fabricated values', async () => {
    mockedHistory.mockResolvedValue([
      mkRecord({ id: 'sim-only', isSimulated: true }),
    ]);

    const res = await GET();
    const body = await res.json();

    expect(body.totalSignals).toBe(0);
    expect(body.brier).toBeNull();
    expect(body.ece).toBeNull();
    expect(body.isSimulated).toBe(true);
    for (const b of body.buckets) {
      expect(b.winRate).toBeNull();
    }
  });
});
