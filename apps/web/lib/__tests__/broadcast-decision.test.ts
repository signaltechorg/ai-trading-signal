jest.mock('../winning-cells', () => ({
  isWinningCell: jest.fn(() => true),
  getWinningCellsMode: jest.fn(() => 'shadow'),
}));

jest.mock('../risk-pipeline', () => ({
  runRiskPipeline: jest.fn(),
}));

jest.mock('../regime-filter', () => ({
  fetchRegimeMap: jest.fn(() => Promise.resolve(new Map())),
  getDominantRegime: jest.fn(() => 'neutral'),
}));

import { computeBroadcastDecisions, type BroadcastCandidate } from '../broadcast-decision';
import { isWinningCell, getWinningCellsMode } from '../winning-cells';
import { runRiskPipeline } from '../risk-pipeline';
import { fetchRegimeMap } from '../regime-filter';

const mockedIsWinningCell = isWinningCell as jest.MockedFunction<typeof isWinningCell>;
const mockedCellsMode = getWinningCellsMode as jest.MockedFunction<typeof getWinningCellsMode>;
const mockedPipeline = runRiskPipeline as jest.MockedFunction<typeof runRiskPipeline>;
const mockedRegimeMap = fetchRegimeMap as jest.MockedFunction<typeof fetchRegimeMap>;

function candidate(id: string, symbol: string): BroadcastCandidate {
  return {
    id,
    symbol,
    timeframe: 'H1',
    direction: 'BUY',
    confidence: 80,
    entry: 100,
    takeProfit1: 104,
    stopLoss: 98,
  };
}

function pipelineResult(approved: Array<{ id: string; symbol: string }>, vetoed: Array<{ id: string; symbol: string; reason: string; vetoedBy: string }>, allocations: Array<{ symbol: string; positionSizePct: number }>) {
  return {
    approved: approved.map(({ id, symbol }) => ({ id, symbol, direction: 'BUY', confidence: 80, entry: 100, stopLoss: 98, takeProfit1: 104, takeProfit2: null, takeProfit3: null, timeframe: 'H1' })),
    vetoed: vetoed.map((v) => ({
      signal: { id: v.id, symbol: v.symbol, direction: 'BUY', confidence: 80, entry: 100, stopLoss: 98, takeProfit1: 104, takeProfit2: null, takeProfit3: null, timeframe: 'H1' },
      reason: v.reason,
      vetoedBy: v.vetoedBy,
    })),
    report: {
      regime: 'neutral',
      riskState: {},
      activeBreakers: [],
      canTrade: true,
      llmVerification: null,
      allocations: allocations.map((a) => ({ ...a, approved: true, reason: '' })),
      timestamp: new Date().toISOString(),
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedRegimeMap.mockResolvedValue(new Map() as never);
  mockedCellsMode.mockReturnValue('shadow' as never);
  mockedIsWinningCell.mockReturnValue(true as never);
});

describe('computeBroadcastDecisions', () => {
  it('returns empty map and runs nothing for an empty candidate list', async () => {
    const decisions = await computeBroadcastDecisions([]);
    expect(decisions.size).toBe(0);
    expect(mockedPipeline).not.toHaveBeenCalled();
    expect(mockedRegimeMap).not.toHaveBeenCalled();
  });

  it('records approved and vetoed decisions with regime + allocation', async () => {
    const a = candidate('a', 'BTCUSD');
    const b = candidate('b', 'ETHUSD');
    mockedRegimeMap.mockResolvedValue(new Map([['BTCUSD', 'bull']]) as never);
    mockedPipeline.mockResolvedValue(pipelineResult(
      [{ id: 'a', symbol: 'BTCUSD' }],
      [{ id: 'b', symbol: 'ETHUSD', reason: 'streak blocked', vetoedBy: 'circuit_breaker' }],
      [{ symbol: 'BTCUSD', positionSizePct: 7.5 }, { symbol: 'ETHUSD', positionSizePct: 0 }],
    ) as never);

    const decisions = await computeBroadcastDecisions([a, b]);

    const da = decisions.get('a')!;
    expect(da).toMatchObject({ blocked: false, recordable: true, regime: 'bull', allocationPct: 7.5 });
    const db = decisions.get('b')!;
    expect(db.blocked).toBe(true);
    expect(db.recordable).toBe(true);
    expect(db.blockReason).toBe('circuit_breaker: streak blocked');
    // ETHUSD not in regime map → dominant fallback
    expect(db.regime).toBe('neutral');
  });

  it('blocks non-winning cells deterministically when curation is active, without sending them to the pipeline', async () => {
    const a = candidate('a', 'BTCUSD');
    const b = candidate('b', 'DOGEUSD');
    mockedCellsMode.mockReturnValue('active' as never);
    mockedIsWinningCell.mockImplementation(((symbol: string) => symbol === 'BTCUSD') as never);
    mockedPipeline.mockResolvedValue(pipelineResult([{ id: 'a', symbol: 'BTCUSD' }], [], [{ symbol: 'BTCUSD', positionSizePct: 5 }]) as never);

    const decisions = await computeBroadcastDecisions([a, b]);

    expect(decisions.get('b')).toMatchObject({
      blocked: true,
      recordable: true,
      blockReason: expect.stringContaining('winning_cells'),
    });
    expect(decisions.get('a')).toMatchObject({ blocked: false });
    const pipelineInput = mockedPipeline.mock.calls[0][0] as Array<{ id: string }>;
    expect(pipelineInput.map((s) => s.id)).toEqual(['a']);
  });

  it('marks pipeline-outage fallbacks blocked=false and NOT recordable', async () => {
    const a = candidate('a', 'BTCUSD');
    mockedPipeline.mockRejectedValue(new Error('risk-state db down'));

    const decisions = await computeBroadcastDecisions([a]);

    expect(decisions.get('a')).toMatchObject({ blocked: false, recordable: false });
  });

  it('survives a regime-map fetch failure (decisions still computed, neutral regime)', async () => {
    const a = candidate('a', 'BTCUSD');
    mockedRegimeMap.mockRejectedValue(new Error('db down'));
    mockedPipeline.mockResolvedValue(pipelineResult([{ id: 'a', symbol: 'BTCUSD' }], [], []) as never);

    const decisions = await computeBroadcastDecisions([a]);

    expect(decisions.get('a')).toMatchObject({ blocked: false, recordable: true, regime: 'neutral' });
  });
});
