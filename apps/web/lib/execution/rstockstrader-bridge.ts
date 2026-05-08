/**
 * R StocksTrader (RoboForex) REST bridge — INTERFACE ONLY.
 *
 * Plan: docs/plans/2026-05-08-demo-roboforex-rstockstrader.md §9
 *
 * Implementation deliberately deferred to a follow-up PR. This file pins
 * the surface area so executor.ts dispatch (also a follow-up) can be
 * symmetric with binance-futures.ts: same shape of inputs, same kind of
 * outputs, same idempotency guarantees.
 *
 * Endpoint paths and exact field names on the R StocksTrader REST API
 * are intentionally NOT hard-coded here — the operator dashboard is the
 * authoritative source. The implementation PR will pin them once the
 * /instruments and /accounts endpoints have been verified live.
 *
 * No runtime calls are made by this module today. Importing it has no
 * side effects beyond pulling type definitions.
 */

import type { OrderSide } from './binance-futures';
import type { RStocksTraderAssetClass } from './rstockstrader-symbols';

/**
 * Per-instrument trading rules pulled from `/instruments/{symbol}`.
 * Field names mirror what callers need; the bridge implementation maps
 * them from whatever the R StocksTrader response uses.
 */
export interface RStocksTraderInstrumentSpec {
  symbol: string;
  assetClass: RStocksTraderAssetClass;
  /** Smallest tradeable size in base units. */
  minQty: number;
  /** Quantity increment; orders rounded down to a multiple of this. */
  qtyStep: number;
  /** Price increment; SL/TP rounded to a multiple of this. */
  tickSize: number;
  /**
   * Contract size in base-asset units per "1 lot" (FX: typically 100 000;
   * XAUUSD: 100 oz; stocks: 1 share). Required for USD-risk derivation.
   */
  contractSize: number;
  /**
   * Minimum distance, in price units, between current price and any
   * attached SL/TP. Reject locally before posting if the proposed stop
   * is closer than this.
   */
  minStopDistance: number;
  digits: number;
}

export interface RStocksTraderAccountInfo {
  accountId: string;
  currency: string;
  balance: number;
  equity: number;
  marginUsed: number;
  marginFree: number;
}

export type RStocksTraderOrderType =
  // Names will be normalised by the bridge to whatever the R StocksTrader
  // API expects — callers stay decoupled from the wire format.
  | 'MARKET'
  | 'LIMIT'
  | 'STOP_ENTRY';

export interface RStocksTraderPlaceInput {
  symbol: string;
  side: OrderSide;
  type: RStocksTraderOrderType;
  /** Quantity in base units; caller has already rounded to qtyStep. */
  qty: number;
  /** Required for LIMIT and STOP_ENTRY. Ignored for MARKET. */
  triggerPrice?: number;
  /** Attached stop loss; absolute price, NOT a delta. */
  stopLoss: number;
  /** Attached take profit; absolute price, NOT a delta. */
  takeProfit: number;
  /**
   * Idempotency reference. Same value passed twice → second call must
   * be a no-op or return the original order id. The bridge maps this
   * to whatever client-reference field R StocksTrader exposes.
   * <= 64 chars, alphanumeric + dash + underscore.
   */
  clientRef: string;
  /** Optional human-readable comment surfaced in the dashboard. */
  comment?: string;
}

export interface RStocksTraderPlaceResult {
  brokerOrderId: string;
  /** Echoed back so callers can correlate even after retries. */
  clientRef: string;
  /** Status reported at placement time; 'pending' is normal for stop entries. */
  status: 'pending' | 'filled' | 'partially_filled' | 'rejected';
  filledQty?: number;
  avgFillPrice?: number;
  rejectReason?: string;
}

export interface RStocksTraderPosition {
  positionId: string;
  symbol: string;
  side: OrderSide;
  qty: number;
  openPrice: number;
  unrealizedPnl: number;
  stopLoss: number | null;
  takeProfit: number | null;
}

/**
 * Read-side and write-side surface that the executor depends on.
 * Implementations must be safe to construct lazily (e.g. inside a request
 * handler) and must NOT cache mutable state across calls — the executor
 * relies on each call hitting the broker fresh.
 */
export interface RStocksTraderBridge {
  /**
   * Read account equity / balance / margin headroom.
   * Used for sizing (`equity * EXEC_RISK_PCT / 100`).
   */
  getAccountInfo(): Promise<RStocksTraderAccountInfo>;

  /**
   * Per-symbol trading rules. Bridge implementations should cache for ~1h
   * to amortise the round-trip; key by `symbol`. Cache invalidation is
   * out of scope for this surface — a process restart clears it.
   */
  getInstrumentSpec(symbol: string): Promise<RStocksTraderInstrumentSpec>;

  /**
   * Place a bracket (entry + attached SL + attached TP) in a single REST
   * call. Bridge MUST surface broker-side rejections as a non-throwing
   * `status = 'rejected'` result with `rejectReason` populated; only
   * network / 5xx errors should throw.
   */
  placeOrder(input: RStocksTraderPlaceInput): Promise<RStocksTraderPlaceResult>;

  /**
   * Cancel a still-pending entry order. Idempotent: cancelling an already
   * filled, already cancelled, or unknown order MUST resolve, not throw.
   */
  cancelOrder(brokerOrderId: string): Promise<void>;

  /** Snapshot of all currently open positions on the configured account. */
  listOpenPositions(): Promise<RStocksTraderPosition[]>;

  /**
   * Close an open position at market. Used by the kill-switch / position
   * manager paths, not by the entry executor. Same idempotency rule as
   * cancelOrder.
   */
  closePosition(positionId: string): Promise<void>;
}

export interface RStocksTraderEnv {
  baseUrl: string;
  token: string;
  accountId: string;
}

/**
 * Read environment, validate presence, return a bridge instance.
 * Implementation will throw at call-site (NOT at module-load) if any env
 * var is missing — matches binance-futures.ts behaviour so a misconfigured
 * deploy fails the handshake, not the cold boot.
 */
export function createRStocksTraderBridge(env: RStocksTraderEnv): RStocksTraderBridge {
  // Implementation deferred. See plan §9.
  void env;
  throw new Error(
    'rstockstrader-bridge: not implemented yet — see docs/plans/2026-05-08-demo-roboforex-rstockstrader.md',
  );
}

/**
 * Read env vars in one place so the executor dispatch layer (follow-up PR)
 * doesn't have to know about RoboForex specifics.
 *
 * Required env:
 *   RSTOCKSTRADER_BASE_URL    e.g. https://stockstrader.roboforex.com/api/...
 *   RSTOCKSTRADER_TOKEN       Bearer token from the dashboard
 *   RSTOCKSTRADER_ACCOUNT_ID  Numeric demo account id
 */
export function readRStocksTraderEnvOrNull(): RStocksTraderEnv | null {
  const baseUrl = process.env.RSTOCKSTRADER_BASE_URL;
  const token = process.env.RSTOCKSTRADER_TOKEN;
  const accountId = process.env.RSTOCKSTRADER_ACCOUNT_ID;
  if (!baseUrl || !token || !accountId) return null;
  return { baseUrl, token, accountId };
}
