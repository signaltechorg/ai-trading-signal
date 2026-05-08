/**
 * R StocksTrader (RoboForex) symbol mapping.
 *
 * Plan: docs/plans/2026-05-08-demo-roboforex-rstockstrader.md §4
 *
 * signal_history.pair stores TwelveData-canonical codes (BTCUSD, EURUSD,
 * AAPLUSD, …). R StocksTrader uses its own codes (BTC/USD, EUR/USD,
 * AAPL.US, …). This table is the bridge.
 *
 * IMPORTANT: every value here is provisional until verified against the
 * live `/instruments` endpoint on the operator's account. Drift any entry
 * that fails the lookup; do NOT fall back to a "similar" symbol.
 *
 * Unknown TradeClaw pair → caller logs error_code = 'symbol_not_rstockstrader_eligible'
 * and skips the signal. Keep behaviour identical to BINANCE_SYMBOLS in
 * apps/web/app/lib/ohlcv.ts so the executor dispatch layer is symmetric.
 */

export type RStocksTraderAssetClass =
  | 'crypto-cfd'
  | 'fx'
  | 'metal'
  | 'energy-cfd'
  | 'us-stock'
  | 'us-etf'
  | 'index-cfd';

export interface RStocksTraderSymbolEntry {
  symbol: string;
  assetClass: RStocksTraderAssetClass;
}

/**
 * Maps TradeClaw canonical pair → R StocksTrader symbol entry.
 *
 * Keep entries alphabetised within each asset-class block so diffs stay
 * minimal as new TradeClaw pairs come online.
 */
export const RSTOCKSTRADER_SYMBOLS: Readonly<Record<string, RStocksTraderSymbolEntry>> = {
  // ─── Crypto CFDs (no perp funding; spread/financing model) ──────────────
  BTCUSD: { symbol: 'BTC/USD', assetClass: 'crypto-cfd' },
  DOGEUSD: { symbol: 'DOGE/USD', assetClass: 'crypto-cfd' },
  ETHUSD: { symbol: 'ETH/USD', assetClass: 'crypto-cfd' },
  SOLUSD: { symbol: 'SOL/USD', assetClass: 'crypto-cfd' },
  XRPUSD: { symbol: 'XRP/USD', assetClass: 'crypto-cfd' },
  // BNBUSD intentionally omitted — not listed on R StocksTrader at time of
  // writing. Caller must skip with symbol_not_rstockstrader_eligible.

  // ─── FX majors ──────────────────────────────────────────────────────────
  AUDUSD: { symbol: 'AUD/USD', assetClass: 'fx' },
  EURUSD: { symbol: 'EUR/USD', assetClass: 'fx' },
  GBPUSD: { symbol: 'GBP/USD', assetClass: 'fx' },
  NZDUSD: { symbol: 'NZD/USD', assetClass: 'fx' },
  USDCAD: { symbol: 'USD/CAD', assetClass: 'fx' },
  USDCHF: { symbol: 'USD/CHF', assetClass: 'fx' },
  USDJPY: { symbol: 'USD/JPY', assetClass: 'fx' },

  // ─── Metals (spot) ──────────────────────────────────────────────────────
  XAGUSD: { symbol: 'XAG/USD', assetClass: 'metal' },
  XAUUSD: { symbol: 'XAU/USD', assetClass: 'metal' },

  // ─── Energy CFDs ────────────────────────────────────────────────────────
  // BNOUSD is a US ETF on the cash exchange (BNO), not a futures-style
  // energy CFD; resolved below in the us-etf block. WTIUSD here.
  WTIUSD: { symbol: 'XTI/USD', assetClass: 'energy-cfd' },

  // ─── US single stocks ───────────────────────────────────────────────────
  AAPLUSD: { symbol: 'AAPL.US', assetClass: 'us-stock' },
  AMZNUSD: { symbol: 'AMZN.US', assetClass: 'us-stock' },
  GOOGLUSD: { symbol: 'GOOGL.US', assetClass: 'us-stock' },
  METAUSD: { symbol: 'META.US', assetClass: 'us-stock' },
  MSFTUSD: { symbol: 'MSFT.US', assetClass: 'us-stock' },
  NVDAUSD: { symbol: 'NVDA.US', assetClass: 'us-stock' },
  TSLAUSD: { symbol: 'TSLA.US', assetClass: 'us-stock' },

  // ─── US ETFs ────────────────────────────────────────────────────────────
  BNOUSD: { symbol: 'BNO.US', assetClass: 'us-etf' },
  QQQUSD: { symbol: 'QQQ.US', assetClass: 'us-etf' },
  SPYUSD: { symbol: 'SPY.US', assetClass: 'us-etf' },
};

/**
 * Lookup helper. Returns null when the TradeClaw pair has no R StocksTrader
 * counterpart. Callers MUST check for null and skip the signal — never
 * default to a similar symbol.
 */
export function toRStocksTraderSymbol(pair: string): RStocksTraderSymbolEntry | null {
  return RSTOCKSTRADER_SYMBOLS[pair] ?? null;
}
