/**
 * Market Data Hub Provider — Redis-backed cache service on Railway
 *
 * For hosted TradeClaw: set MARKET_DATA_HUB_URL to use pre-cached data
 * For Docker / self-hosted: leave unset — falls through to free API chain
 *
 * Hub API:
 *   GET /api/candles/:symbol?interval=1h&limit=300  → OHLCV candles
 *   GET /api/quotes                                   → all latest quotes
 *   GET /api/quotes/:symbol                           → single quote
 *   GET /api/exchange-rates                           → forex rates
 */

import type { OHLCV, ForexRate, PriceQuote } from './types';
import { safeFetch } from './types';

/** Normalize hub URL: prepend https:// if missing, strip trailing slash */
function normalizeHubUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, '');
}

const HUB_URL = normalizeHubUrl(process.env.MARKET_DATA_HUB_URL ?? '');
const HUB_API_KEY = process.env.MARKET_DATA_HUB_API_KEY ?? '';

function hubHeaders(): HeadersInit {
  return HUB_API_KEY ? { Authorization: `Bearer ${HUB_API_KEY}` } : {};
}

// US equity tickers stored on the hub as bare Twelve Data symbols (no slash).
// TradeClaw uses the `<TICKER>USD` convention internally for consistency, but
// the hub + Twelve Data want the raw ticker.
//
// Note: DIA/SPY/QQQ/IWM/BNO removed in hub PR #40 (RoboForex provider). Index
// CFDs (NAS100, US500, US30, UK100, GER40, JPY225, FRA40, AUS200, SWI20, SPA35)
// and BRENT/USD now serve those use cases via R-primary dispatch. Bare index
// symbols pass through `fromHubSymbol()` unchanged because they're not in this
// set — that is intentional (the TradeClaw symbol IS the index code).
const STOCK_TICKERS = new Set([
  // Currently in hub seed (PR #40):
  'NVDA', 'TSLA', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META',
  // Pending hub seed (see docs/hub-seed-additions-2026-05-07.md):
  // Semis (high retail):
  'AMD', 'MU', 'AVGO', 'INTC', 'TSM', 'QCOM',
  // Financials:
  'JPM', 'GS', 'BAC',
  // Other consumer / crypto-correlated:
  'NFLX', 'DIS', 'COIN',
]);

/** Convert TradeClaw symbol (BTCUSD) → Hub symbol (BTC/USD) */
function toHubSymbol(symbol: string): string {
  // Stocks: strip USD suffix → bare ticker (NVDAUSD → NVDA)
  if (symbol.endsWith('USD')) {
    const ticker = symbol.slice(0, -3);
    if (STOCK_TICKERS.has(ticker)) return ticker;
  }
  // Forex/Metals: 6-char pairs like EURUSD, XAUUSD
  if (symbol.length === 6 && !symbol.includes('/')) {
    return `${symbol.slice(0, 3)}/${symbol.slice(3)}`;
  }
  // Crypto + multi-char commodities (BTCUSD, DOGEUSD, BRENTUSD)
  if (symbol.endsWith('USD') && symbol.length > 6) {
    return `${symbol.slice(0, -3)}/USD`;
  }
  if (symbol.endsWith('USD') && symbol.length <= 6) {
    return `${symbol.slice(0, 3)}/${symbol.slice(3)}`;
  }
  return symbol;
}

/** Convert TradeClaw timeframe → Twelve Data interval (used by hub) */
function toHubInterval(timeframe: string): string {
  const map: Record<string, string> = {
    M5: '5min',
    M15: '15min',
    H1: '1h',
    H4: '4h',
    D1: '1day',
  };
  return map[timeframe] ?? '1h';
}

/** Whether the hub is configured */
export function isHubEnabled(): boolean {
  return HUB_URL.length > 0;
}

interface HubCandleResponse {
  symbol: string;
  interval: string;
  count: number;
  values: Array<{
    datetime: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
}

interface HubExchangeRateResponse {
  data: Array<{
    from_currency: string;
    to_currency: string;
    rate: number;
    timestamp: number;
    fetched_at: string;
  }>;
  count: number;
}

/**
 * Fetch OHLCV candles from the market data hub
 */
export async function fetchHubCandles(
  symbol: string,
  timeframe: string,
  limit = 300,
): Promise<OHLCV[]> {
  if (!HUB_URL) return [];

  const hubSymbol = encodeURIComponent(toHubSymbol(symbol));
  const interval = toHubInterval(timeframe);
  const url = `${HUB_URL}/api/candles/${hubSymbol}?interval=${interval}&limit=${limit}`;

  const data = await safeFetch<HubCandleResponse>(url, { timeoutMs: 6000, headers: hubHeaders() });
  if (!data?.values?.length) return [];

  return data.values.map((v) => ({
    timestamp: new Date(v.datetime + ' UTC').getTime(),
    open: v.open,
    high: v.high,
    low: v.low,
    close: v.close,
    volume: v.volume,
  }));
}

/** Convert hub symbol back to TradeClaw symbol (BTC/USD → BTCUSD, BNO → BNOUSD) */
function fromHubSymbol(hubSym: string): string {
  if (hubSym.includes('/')) return hubSym.replace('/', '');
  if (STOCK_TICKERS.has(hubSym)) return `${hubSym}USD`;
  return hubSym;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

interface HubQuote {
  symbol: string;
  price?: number | string;
  close?: number | string;
  change?: number | string;
  percent_change?: number | string;
  high?: number | string;
  low?: number | string;
  volume?: number | string;
  timestamp?: number;
  datetime?: string;
}

interface HubQuotesResponse {
  data?: HubQuote[];
  count?: number;
}

/**
 * Fetch all latest quotes from the market data hub.
 * Returns TradeClaw-symbol-keyed PriceQuote[] (BTCUSD, BNOUSD, QQQUSD, EURUSD, ...).
 * Empty array when hub disabled or unreachable.
 */
export async function fetchHubQuotes(): Promise<PriceQuote[]> {
  if (!HUB_URL) return [];

  const data = await safeFetch<HubQuotesResponse>(`${HUB_URL}/api/quotes`, {
    timeoutMs: 5000,
    headers: hubHeaders(),
  });
  if (!data?.data?.length) return [];

  const out: PriceQuote[] = [];
  for (const q of data.data) {
    const price = asNumber(q.price) ?? asNumber(q.close);
    if (price === undefined || price <= 0) continue;
    out.push({
      symbol: fromHubSymbol(q.symbol),
      price,
      change24h: asNumber(q.percent_change) ?? asNumber(q.change),
      high24h: asNumber(q.high),
      low24h: asNumber(q.low),
      volume24h: asNumber(q.volume),
      timestamp: q.timestamp ? q.timestamp * 1000 : Date.now(),
      source: 'market-data-hub',
    });
  }
  return out;
}

/**
 * Fetch forex rates from the hub
 */
export async function fetchHubExchangeRates(): Promise<ForexRate[]> {
  if (!HUB_URL) return [];

  const data = await safeFetch<HubExchangeRateResponse>(
    `${HUB_URL}/api/exchange-rates`,
    { timeoutMs: 5000, headers: hubHeaders() },
  );
  if (!data?.data?.length) return [];

  return data.data.map((r) => ({
    pair: `${r.from_currency}${r.to_currency}`,
    rate: r.rate,
    timestamp: r.timestamp * 1000,
    source: 'market-data-hub',
  }));
}
