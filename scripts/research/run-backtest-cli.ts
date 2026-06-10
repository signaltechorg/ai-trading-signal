/**
 * Headless research backtest runner (engine-makeover Phase 2).
 *
 * The missing middle of the research loop: hypothesis → COSTED backtest on
 * STORED candles → walk-forward folds → registered result. Reads exclusively
 * from the `candles` store so the same spec always replays the same bars —
 * never from live providers.
 *
 * Determinism contract: `spec` + `results` are pure functions of the stored
 * data; only `meta.runAt` varies between identical runs. Output filename is
 * derived from the spec, so re-running an experiment overwrites its file
 * instead of forking a near-duplicate.
 *
 * Usage:
 *   railway run --service Postgres npx tsx scripts/research/run-backtest-cli.ts \
 *     --symbol BTCUSD --timeframe H1 --from 2024-06-01 --to 2026-06-01 \
 *     --presets all --geometry live --costs auto --folds 4
 */

import fs from 'fs';
import path from 'path';
import {
  PRESETS,
  runBacktest,
  costModelFor,
  CRYPTO_PERP_COSTS,
  FX_COSTS,
  METALS_COSTS,
  ZERO_COSTS,
  LIVE_GEOMETRY,
  FIXED_LEGACY_GEOMETRY,
  type BacktestOptions,
  type BacktestResult,
  type StrategyId,
} from '../../packages/strategies/src';
import { connect, getStoredCandles, getCoverage } from './candle-db';

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const TF_HOURS: Record<string, number> = { H1: 1, H4: 4, D1: 24 };

function metrics(r: BacktestResult) {
  const avgCostPct = r.trades.length > 0
    ? r.trades.reduce((s, t) => s + (t.costPct ?? 0), 0) / r.trades.length
    : 0;
  return {
    totalTrades: r.totalTrades,
    winRate: +r.winRate.toFixed(4),
    profitFactor: Number.isFinite(r.profitFactor) ? +r.profitFactor.toFixed(3) : null,
    maxDrawdown: +r.maxDrawdown.toFixed(4),
    sharpeRatio: +r.sharpeRatio.toFixed(3),
    totalReturn: +r.totalReturn.toFixed(4),
    avgCostPct: +avgCostPct.toFixed(4),
    reason: r.reason ?? null,
  };
}

(async () => {
  const symbol = arg('symbol', 'BTCUSD').toUpperCase();
  const timeframe = arg('timeframe', 'H1').toUpperCase();
  const from = arg('from', '');
  const to = arg('to', '');
  const presetsArg = arg('presets', 'all');
  const geometryArg = arg('geometry', 'live');
  const costsArg = arg('costs', 'auto');
  const folds = Math.max(1, Number(arg('folds', '4')));
  const outDir = arg('out', 'docs/research/experiments');

  if (!from || !to) {
    console.error('Required: --from YYYY-MM-DD --to YYYY-MM-DD');
    process.exit(2);
  }
  const fromTs = Date.parse(`${from}T00:00:00Z`);
  const toTs = Date.parse(`${to}T00:00:00Z`);

  const geometry = geometryArg === 'legacy' ? FIXED_LEGACY_GEOMETRY : LIVE_GEOMETRY;
  const costs =
    costsArg === 'zero' ? ZERO_COSTS
    : costsArg === 'crypto' ? CRYPTO_PERP_COSTS
    : costsArg === 'fx' ? FX_COSTS
    : costsArg === 'metals' ? METALS_COSTS
    : costModelFor(symbol);
  const options: BacktestOptions = { costs, geometry, barHours: TF_HOURS[timeframe] ?? 1 };

  const presetIds = (presetsArg === 'all'
    ? (Object.keys(PRESETS) as StrategyId[])
    : (presetsArg.split(',').map((s) => s.trim()) as StrategyId[])
  ).filter((id) => id in PRESETS);

  const client = await connect();
  try {
    const candles = await getStoredCandles(client, symbol, timeframe, fromTs, toTs);
    if (candles.length < 100) {
      const cov = await getCoverage(client, symbol, timeframe);
      console.error(
        `Insufficient stored candles for ${symbol} ${timeframe} in [${from}, ${to}]: have ${candles.length}.` +
        (cov.count > 0
          ? ` Store covers ${new Date(cov.minTs!).toISOString().slice(0, 10)}→${new Date(cov.maxTs!).toISOString().slice(0, 10)} (${cov.count} bars).`
          : ' Store is empty for this series.') +
        ' Run scripts/research/backfill-candles.ts first.',
      );
      process.exit(3);
    }

    const foldSize = Math.floor(candles.length / folds);
    const results: Record<string, { full: ReturnType<typeof metrics>; folds: Array<ReturnType<typeof metrics> & { from: string; to: string }> }> = {};

    for (const id of presetIds) {
      const preset = PRESETS[id];
      const full = metrics(runBacktest(candles, preset, options));
      const foldResults = [];
      for (let f = 0; f < folds; f++) {
        const start = f * foldSize;
        const end = f === folds - 1 ? candles.length : (f + 1) * foldSize;
        const slice = candles.slice(start, end);
        foldResults.push({
          ...metrics(runBacktest(slice, preset, options)),
          from: new Date(slice[0].timestamp).toISOString().slice(0, 10),
          to: new Date(slice[slice.length - 1].timestamp).toISOString().slice(0, 10),
        });
      }
      results[id] = { full, folds: foldResults };
      console.log(
        `${id.padEnd(14)} trades=${String(full.totalTrades).padStart(4)} winRate=${(full.winRate * 100).toFixed(1)}% ` +
        `return=${(full.totalReturn * 100).toFixed(1)}% maxDD=${(full.maxDrawdown * 100).toFixed(1)}% PF=${full.profitFactor ?? '∞'} avgCost=${full.avgCostPct}%`,
      );
    }

    const spec = {
      symbol,
      timeframe,
      from,
      to,
      geometry: geometryArg === 'legacy' ? 'legacy-fixed-2-1' : 'live-atr14x2.5-tp2R',
      costs: { ...costs },
      folds,
      candleCount: candles.length,
      firstBar: new Date(candles[0].timestamp).toISOString(),
      lastBar: new Date(candles[candles.length - 1].timestamp).toISOString(),
      presets: presetIds,
    };
    const payload = { meta: { runAt: new Date().toISOString() }, spec, results };

    fs.mkdirSync(outDir, { recursive: true });
    const fileName = `${symbol}-${timeframe}-${from}-${to}-${geometryArg}-${costsArg}.json`;
    const outPath = path.join(outDir, fileName);
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

    const registryPath = path.join(outDir, 'REGISTRY.md');
    const headline = presetIds
      .map((id) => `${id} ${(results[id].full.totalReturn * 100).toFixed(1)}%/${(results[id].full.winRate * 100).toFixed(0)}%wr`)
      .join(' · ');
    fs.appendFileSync(
      registryPath,
      `- ${payload.meta.runAt.slice(0, 10)} \`${fileName}\` — ${symbol} ${timeframe} ${from}→${to}, ${spec.geometry}, costs=${costsArg}, ${candles.length} bars: ${headline}\n`,
    );
    console.log(`\nwritten: ${outPath}`);
  } finally {
    await client.end();
  }
})();
