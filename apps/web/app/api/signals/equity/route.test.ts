import { NextRequest } from 'next/server';
import type { SignalHistoryRecord } from '../../../../lib/signal-history';
import { getResolvedSlice } from '../../../../lib/signal-slice';

jest.mock('../../../../lib/signal-history', () => {
  const realOutcome = (outcome: SignalHistoryRecord['outcomes']['24h']) =>
    Boolean(outcome && (outcome.pnlPct !== 0 || outcome.hit));

  return {
    isCountedResolved: jest.fn((record: SignalHistoryRecord) =>
      !record.isSimulated
      && !record.gateBlocked
      && realOutcome(record.outcomes['24h']),
    ),
  };
});

jest.mock('../../../../lib/signal-slice', () => ({
  parseScope: jest.fn((raw: string | null | undefined) => raw === 'free' ? 'free' : 'pro'),
  getResolvedSlice: jest.fn(),
}));

import { GET } from '../route';

const mockedGetResolvedSlice = getResolvedSlice as jest.MockedFunction<typeof getResolvedSlice>;

function record(overrides: Partial<SignalHistoryRecord>): SignalHistoryRecord {
  return {
    id: 'signal-1',
    pair: 'BTCUSD',
    timeframe: 'H1',
    direction: 'BUY',
    confidence: 75,
    entryPrice: 100,
    sl: 98,
    timestamp: 1_717_000_000_000,
    gateBlocked: false,
    isSimulated: false,
    outcomes: {
      '4h': { price: 101, pnlPct: 1, hit: true },
      '24h': { price: 102, pnlPct: 2, hit: true },
    },
    ...overrides,
  };
}

function primeSlice(records: SignalHistoryRecord[]): void {
  mockedGetResolvedSlice.mockResolvedValueOnce({
    scopedRecords: records,
    periodFiltered: records,
    resolved: records.filter((r) => !r.isSimulated && !r.gateBlocked && r.outcomes['24h'] !== null),
    cutoffTs: null,
    earliestTimestamp: records.length > 0 ? Math.min(...records.map((r) => r.timestamp)) : null,
  });
}

function makeReq(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

describe('GET /api/signals/equity rolling win rates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 7d / 30d / 90d rolling win-rate snapshots alongside the main summary', async () => {
    const now = Date.now();
    primeSlice([
      record({
        id: '3d-win',
        timestamp: now - (3 * 24 * 60 * 60 * 1000),
        outcomes: { '4h': { price: 101, pnlPct: 1, hit: true }, '24h': { price: 103, pnlPct: 3, hit: true } },
      }),
      record({
        id: '10d-loss',
        timestamp: now - (10 * 24 * 60 * 60 * 1000),
        outcomes: { '4h': { price: 99, pnlPct: -1, hit: false }, '24h': { price: 97, pnlPct: -3, hit: false } },
      }),
      record({
        id: '40d-win',
        timestamp: now - (40 * 24 * 60 * 60 * 1000),
        outcomes: { '4h': { price: 101, pnlPct: 1, hit: true }, '24h': { price: 102, pnlPct: 2, hit: true } },
      }),
      record({
        id: '100d-loss',
        timestamp: now - (100 * 24 * 60 * 60 * 1000),
        outcomes: { '4h': { price: 99, pnlPct: -1, hit: false }, '24h': { price: 96, pnlPct: -4, hit: false } },
      }),
    ]);

    const res = await GET(makeReq('/api/signals/equity'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.rollingWinRates).toEqual({
      '7d': { totalSignals: 1, resolvedSignals: 1, winRate: 100 },
      '30d': { totalSignals: 2, resolvedSignals: 2, winRate: 50 },
      '90d': { totalSignals: 3, resolvedSignals: 3, winRate: 66.7 },
    });
    expect(body.summary.totalSignals).toBe(4);
    expect(body.summary.winRate).toBe(50);
  });
});
