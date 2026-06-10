/**
 * Migration-048 broadcast-scope persistence: Tier-0 INSERT, graceful fallback
 * when the migration is unapplied, tri-state row mapping, and the catch-up
 * late-stamp that must never overwrite an existing decision.
 */

jest.mock('../db-pool', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  execute: jest.fn(() => Promise.resolve()),
}));

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://test/test';
});

afterAll(() => {
  if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

type SignalHistoryModule = typeof import('../signal-history');

function freshModule(): { mod: SignalHistoryModule; query: jest.Mock } {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dbPool = require('../db-pool') as { query: jest.Mock };
  dbPool.query.mockReset();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../signal-history') as SignalHistoryModule;
  return { mod, query: dbPool.query };
}

const baseRow = {
  id: 'sig-1',
  pair: 'BTCUSD',
  timeframe: 'H1',
  direction: 'BUY',
  confidence: 80,
  entry_price: 50000,
  tp1: 51000,
  sl: 49500,
  is_simulated: false,
  outcome_4h: null,
  outcome_24h: null,
  telegram_posted_at: null,
  telegram_message_id: null,
  created_at: new Date().toISOString(),
  last_verified: null,
  strategy_id: 'hmm-top3',
  mode: 'swing',
  entry_atr: null,
  atr_multiplier: null,
  max_adverse_excursion: null,
  gate_blocked: false,
  gate_reason: null,
};

describe('recordSignalAsync with a broadcast decision (Tier 0)', () => {
  it('inserts the regime / broadcast_blocked / reason / allocation columns', async () => {
    const { mod, query } = freshModule();
    query.mockResolvedValue([{ id: 'sig-1' }]);

    await mod.recordSignalAsync(
      'BTCUSD', 'H1', 'BUY', 80, 50000, 'sig-1', 51000, 49500, Date.now(), 'hmm-top3',
      undefined, undefined, undefined, undefined, undefined,
      { regime: 'trend', blocked: true, blockReason: 'circuit_breaker: streak', allocationPct: 7.5 },
    );

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('broadcast_blocked');
    expect(sql).toContain('broadcast_block_reason');
    expect(sql).toContain('allocation_pct');
    expect(sql).toContain('regime');
    expect(params).toEqual(expect.arrayContaining(['trend', true, 'circuit_breaker: streak', 7.5]));
  });

  it('falls back to the pre-048 INSERT when the broadcast columns are missing, and skips Tier 0 afterwards', async () => {
    const { mod, query } = freshModule();
    const missingErr = Object.assign(new Error('column "broadcast_blocked" of relation "signal_history" does not exist'), { code: '42703' });
    query
      .mockRejectedValueOnce(missingErr)        // Tier 0 probe fails
      .mockResolvedValue([{ id: 'sig-1' }]);    // Tier 1 succeeds

    await mod.recordSignalAsync(
      'BTCUSD', 'H1', 'BUY', 80, 50000, 'sig-1', 51000, 49500, Date.now(), 'hmm-top3',
      undefined, undefined, undefined, undefined, undefined,
      { blocked: false },
    );

    expect(query).toHaveBeenCalledTimes(2);
    const tier1Sql = query.mock.calls[1][0] as string;
    expect(tier1Sql).not.toContain('broadcast_blocked');
    expect(tier1Sql).toContain('gate_blocked');

    // Second record: Tier 0 is not probed again.
    query.mockClear();
    query.mockResolvedValue([{ id: 'sig-2' }]);
    await mod.recordSignalAsync(
      'ETHUSD', 'H1', 'BUY', 80, 3000, 'sig-2', 3100, 2950, Date.now(), 'hmm-top3',
      undefined, undefined, undefined, undefined, undefined,
      { blocked: false },
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0] as string).not.toContain('broadcast_blocked');
  });

  it('skips the Tier-0 probe entirely when no broadcast decision is supplied', async () => {
    const { mod, query } = freshModule();
    query.mockResolvedValue([{ id: 'sig-1' }]);

    await mod.recordSignalAsync('BTCUSD', 'H1', 'BUY', 80, 50000, 'sig-1', 51000, 49500, Date.now(), 'hmm-top3');

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0] as string).not.toContain('broadcast_blocked');
  });
});

describe('rowToRecord tri-state mapping (via readHistoryAsync)', () => {
  it('maps NULL broadcast_blocked to undefined, never to false', async () => {
    const { mod, query } = freshModule();
    query.mockResolvedValue([
      { ...baseRow, id: 'null-row', broadcast_blocked: null, regime: null },
      { ...baseRow, id: 'approved-row', broadcast_blocked: false, regime: 'trend', allocation_pct: '7.5' },
      { ...baseRow, id: 'blocked-row', broadcast_blocked: true, broadcast_block_reason: 'risk_veto: halt', regime: 'volatile' },
    ]);

    const records = await mod.readHistoryAsync();

    const byId = new Map(records.map((r) => [r.id, r]));
    expect(byId.get('null-row')!.broadcastBlocked).toBeUndefined();
    expect(byId.get('approved-row')!.broadcastBlocked).toBe(false);
    expect(byId.get('approved-row')!.allocationPct).toBe(7.5);
    expect(byId.get('approved-row')!.regime).toBe('trend');
    expect(byId.get('blocked-row')!.broadcastBlocked).toBe(true);
    expect(byId.get('blocked-row')!.broadcastBlockReason).toBe('risk_veto: halt');
  });
});

describe('updateBroadcastDecisionAsync (catch-up late-stamp)', () => {
  it('only fills rows whose decision is NULL', async () => {
    const { mod, query } = freshModule();
    query.mockResolvedValue([{ id: 'sig-1' }]);

    const stamped = await mod.updateBroadcastDecisionAsync([
      { id: 'sig-1', regime: 'range', blocked: false, allocationPct: 5 },
    ]);

    expect(stamped).toBe(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('broadcast_blocked IS NULL');
    expect(params).toEqual(['sig-1', 'range', false, null, 5]);
  });

  it('no-ops gracefully when migration 048 is missing', async () => {
    const { mod, query } = freshModule();
    const missingErr = Object.assign(new Error('column "broadcast_blocked" does not exist'), { code: '42703' });
    query.mockRejectedValue(missingErr);

    const stamped = await mod.updateBroadcastDecisionAsync([
      { id: 'sig-1', blocked: false },
    ]);

    expect(stamped).toBe(0);
  });
});
