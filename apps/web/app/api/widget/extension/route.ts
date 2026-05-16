import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const DEFAULT_PAIRS = ['BTCUSD', 'ETHUSD', 'XAUUSD'];

function parsePairs(rawPairs: string | null) {
  if (!rawPairs) return DEFAULT_PAIRS;

  const pairs = rawPairs
    .split(',')
    .map((pair) => pair.trim().toUpperCase())
    .filter(Boolean)
    .filter((pair, index, arr) => arr.indexOf(pair) === index)
    .slice(0, 3);

  return pairs.length > 0 ? pairs : DEFAULT_PAIRS;
}

function buildSignalUrl(baseUrl: string, signal: { id?: string; symbol?: string }) {
  if (!signal.id) {
    return `${baseUrl}/dashboard`;
  }

  return `${baseUrl}/signal/${signal.id}`;
}

async function pickBestSignal(request: NextRequest, pair: string) {
  const url = new URL('/api/signals', request.url);
  url.searchParams.set('symbol', pair);
  url.searchParams.set('minConfidence', '0');

  const response = await fetch(url.toString(), {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  const signals = Array.isArray(data?.signals) ? data.signals : [];
  if (signals.length === 0) {
    return null;
  }

  return [...signals].sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0))[0];
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const baseUrl = requestUrl.origin;
  const pairs = parsePairs(requestUrl.searchParams.get('pairs'));

  const signals = await Promise.all(
    pairs.map(async (pair) => {
      const best = await pickBestSignal(request, pair);

      if (!best) {
        return {
          symbol: pair,
          direction: 'NEUTRAL',
          confidence: 0,
          entry: null,
          timeframe: 'H1',
          updatedAt: new Date().toISOString(),
          source: 'fallback',
          signalUrl: `${baseUrl}/dashboard`,
        };
      }

      return {
        symbol: pair,
        direction: best.direction ?? best.signal ?? 'NEUTRAL',
        confidence: Math.round(best.confidence ?? 0),
        entry: best.entry ?? null,
        timeframe: best.timeframe ?? 'H1',
        updatedAt: best.timestamp ?? dataFallbackTimestamp(best),
        source: best.source ?? 'live',
        signalUrl: buildSignalUrl(baseUrl, best),
      };
    })
  );

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      baseUrl,
      pairs,
      signals,
      dashboardUrl: `${baseUrl}/dashboard`,
      trackRecordUrl: `${baseUrl}/track-record`,
      pricingUrl: `${baseUrl}/pricing`,
    },
    {
      headers: {
        'Cache-Control': 'private, s-maxage=30, stale-while-revalidate=60',
      },
    }
  );
}

function dataFallbackTimestamp(signal: { timestamp?: string }) {
  return signal.timestamp || new Date().toISOString();
}
