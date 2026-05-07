import { NextResponse } from 'next/server';
import {
  fetchBinancePrices,
  fetchHubQuotes,
  isHubEnabled,
} from '../../lib/data-providers';

/**
 * /api/prices — hub-first price aggregator.
 *
 * Architecture (per 2026-05-07 directive: market-data-hub is the single source
 * of truth, aggregating Twelve Data + Binance + RoboForex internally):
 *
 *   1. market-data-hub (primary)        — when MARKET_DATA_HUB_URL is set
 *   2. Binance public ticker (crypto)   — survival fallback if hub is down
 *   3. Stooq CSV (forex/metals)         — survival fallback if hub is down
 *   4. Static last-known-good           — ultimate safety net (clearly marked stale)
 *
 * Removed in this refactor (all now live inside the hub):
 *   - CoinGecko direct fetch
 *   - CoinCap fetch
 *   - Kraken fetch
 *   - Frankfurter fetch
 *   - Free Gold/Silver API fetch
 *
 * The two surviving local fallbacks (Binance, Stooq) only run for symbols the
 * hub didn't return — under normal operation the hub covers everything and
 * these never fire.
 */

const FALLBACK_DATE = '2026-03-15';
const FALLBACK_PRICES: Record<string, number> = {
  BTCUSD: 70798,
  ETHUSD: 2147.53,
  XRPUSD: 1.40,
  XAUUSD: 4505,
  XAGUSD: 71.36,
  EURUSD: 1.1559,
  GBPUSD: 1.3352,
  USDJPY: 159.53,
  AUDUSD: 0.6939,
  USDCAD: 1.3826,
  NZDUSD: 0.5799,
  USDCHF: 0.7922,
};

const STOOQ_SYMBOLS: Record<string, string> = {
  XAUUSD: 'xauusd',
  XAGUSD: 'xagusd',
  EURUSD: 'eurusd',
  GBPUSD: 'gbpusd',
  USDJPY: 'usdjpy',
  AUDUSD: 'audusd',
  USDCAD: 'usdcad',
  NZDUSD: 'nzdusd',
  USDCHF: 'usdchf',
};

interface PriceEntry {
  price: number;
  change24h: number;
  source: string;
}

async function fetchStooqFallback(
  prices: Record<string, PriceEntry>,
): Promise<void> {
  await Promise.allSettled(
    Object.entries(STOOQ_SYMBOLS).map(async ([symbol, stooqSym]) => {
      if (prices[symbol]) return;
      try {
        const res = await fetch(`https://stooq.com/q/l/?s=${stooqSym}&f=c&h&e=csv`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return;
        const text = await res.text();
        const lines = text.trim().split('\n');
        if (lines.length < 2) return;
        const val = parseFloat(lines[1].trim());
        if (!isNaN(val) && val > 0) {
          prices[symbol] = { price: val, change24h: 0, source: 'stooq' };
        }
      } catch {
        /* swallow — caller falls through to static last-known-good */
      }
    }),
  );
}

export async function GET() {
  try {
    const prices: Record<string, PriceEntry> = {};

    // ── 1. Hub (primary) ──────────────────────────────────────────────────
    if (isHubEnabled()) {
      const hubQuotes = await fetchHubQuotes();
      for (const q of hubQuotes) {
        prices[q.symbol] = {
          price: q.price,
          change24h: q.change24h ?? 0,
          source: q.source,
        };
      }
    }

    // ── 2. Binance crypto fallback (only if hub didn't cover the pair) ────
    if (Object.keys(prices).length === 0 || hasMissingCrypto(prices)) {
      const binanceQuotes = await fetchBinancePrices();
      for (const q of binanceQuotes) {
        if (!prices[q.symbol]) {
          prices[q.symbol] = {
            price: q.price,
            change24h: q.change24h ?? 0,
            source: q.source,
          };
        }
      }
    }

    // ── 3. Stooq forex/metals fallback ────────────────────────────────────
    if (hasMissingForexOrMetals(prices)) {
      await fetchStooqFallback(prices);
    }

    // ── 4. Static last-known-good (clearly marked stale) ──────────────────
    for (const [symbol, base] of Object.entries(FALLBACK_PRICES)) {
      if (!prices[symbol]) {
        prices[symbol] = { price: base, change24h: 0, source: 'fallback' };
      }
    }

    const hasFallback = Object.values(prices).some((p) => p.source === 'fallback');

    // Observability: per-request source distribution. Lets us see hub-vs-
    // fallback share in Railway logs without per-symbol inspection.
    const sourceCounts: Record<string, number> = {};
    for (const p of Object.values(prices)) {
      sourceCounts[p.source] = (sourceCounts[p.source] ?? 0) + 1;
    }
    console.info(
      JSON.stringify({
        evt: 'api/prices',
        count: Object.keys(prices).length,
        sources: sourceCounts,
        stale: hasFallback,
        hubEnabled: isHubEnabled(),
      }),
    );

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      count: Object.keys(prices).length,
      prices,
      hubEnabled: isHubEnabled(),
      ...(hasFallback && { stale: true, fallbackDate: FALLBACK_DATE }),
    });
  } catch {
    const fallback: Record<string, PriceEntry> = {};
    for (const [sym, price] of Object.entries(FALLBACK_PRICES)) {
      fallback[sym] = { price, change24h: 0, source: 'fallback' };
    }
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      count: Object.keys(fallback).length,
      prices: fallback,
      stale: true,
      fallbackDate: FALLBACK_DATE,
    });
  }
}

const CRYPTO_CORE = ['BTCUSD', 'ETHUSD'];
const FOREX_METAL_CORE = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'];

function hasMissingCrypto(prices: Record<string, PriceEntry>): boolean {
  return CRYPTO_CORE.some((s) => !prices[s]);
}

function hasMissingForexOrMetals(prices: Record<string, PriceEntry>): boolean {
  return FOREX_METAL_CORE.some((s) => !prices[s]);
}
