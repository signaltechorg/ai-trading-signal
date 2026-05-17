import type { AgentAnalysis, FinalVerdict } from './types';
import { updateJobStatus } from './research-jobs';
import { query } from '../db-pool';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RecentSignalRow {
  pair: string;
  direction: string;
  confidence: number;
  entry_price: number;
  tp1: number | null;
  sl: number | null;
  outcome_4h: { hit: boolean; pnlPct: number } | null;
  outcome_24h: { hit: boolean; pnlPct: number } | null;
  created_at: string;
}

interface SymbolStats {
  totalSignals: number;
  resolved: number;
  wins: number;
  winRate: number;
  avgPnl: number;
  lastDirection: string | null;
  lastConfidence: number | null;
  lastEntry: number | null;
}

async function fetchSymbolStats(symbol: string): Promise<SymbolStats> {
  const fallback: SymbolStats = {
    totalSignals: 0,
    resolved: 0,
    wins: 0,
    winRate: 0,
    avgPnl: 0,
    lastDirection: null,
    lastConfidence: null,
    lastEntry: null,
  };

  if (!process.env.DATABASE_URL) return fallback;

  try {
    const rows = await query<RecentSignalRow>(
      `SELECT pair, direction, confidence, entry_price, tp1, sl,
              outcome_4h, outcome_24h, created_at
       FROM signal_history
       WHERE pair = $1 AND is_simulated = FALSE
         AND COALESCE(gate_blocked, false) = false
       ORDER BY created_at DESC
       LIMIT 50`,
      [symbol],
    );

    if (rows.length === 0) return fallback;

    let resolved = 0;
    let wins = 0;
    let pnlSum = 0;

    for (const r of rows) {
      if (r.outcome_24h && r.outcome_24h.pnlPct !== 0) {
        resolved++;
        pnlSum += r.outcome_24h.pnlPct;
        if (r.outcome_24h.hit) wins++;
      }
    }

    const latest = rows[0];

    return {
      totalSignals: rows.length,
      resolved,
      wins,
      winRate: resolved > 0 ? Math.round((wins / resolved) * 100) : 0,
      avgPnl: resolved > 0 ? +(pnlSum / resolved).toFixed(2) : 0,
      lastDirection: latest.direction,
      lastConfidence: latest.confidence,
      lastEntry: Number(latest.entry_price),
    };
  } catch {
    return fallback;
  }
}

function buildAnalystAnalysis(
  symbol: string,
  timeframe: string,
  stats: SymbolStats,
): AgentAnalysis {
  const hasData = stats.totalSignals > 0;

  const signals: AgentAnalysis['signals'] = [];

  if (hasData) {
    signals.push({
      indicator: 'Win Rate (24h)',
      value: `${stats.winRate}%`,
      interpretation:
        stats.winRate >= 60
          ? 'Strong historical performance'
          : stats.winRate >= 45
            ? 'Average performance'
            : 'Below average — caution advised',
    });
    signals.push({
      indicator: 'Avg P&L',
      value: `${stats.avgPnl}%`,
      interpretation: stats.avgPnl > 0 ? 'Positive expectancy' : 'Negative expectancy',
    });
    signals.push({
      indicator: 'Sample Size',
      value: `${stats.resolved} resolved / ${stats.totalSignals} total`,
      interpretation:
        stats.resolved >= 20
          ? 'Statistically meaningful'
          : 'Limited sample — lower confidence',
    });
    if (stats.lastDirection) {
      signals.push({
        indicator: 'Last Signal',
        value: `${stats.lastDirection} @ ${stats.lastEntry}`,
        interpretation: `Most recent bias: ${stats.lastDirection}`,
      });
    }
  } else {
    signals.push({
      indicator: 'RSI',
      value: '52',
      interpretation: 'Neutral zone — no clear overbought/oversold',
    });
    signals.push({
      indicator: 'MACD',
      value: 'Bullish crossover',
      interpretation: 'Momentum shifting up (mock — no historical data)',
    });
    signals.push({
      indicator: 'EMA 50/200',
      value: 'Converging',
      interpretation: 'Potential golden cross (mock — no historical data)',
    });
  }

  const confidence = hasData
    ? Math.min(90, Math.max(40, stats.winRate + (stats.resolved >= 20 ? 10 : -5)))
    : 55;

  const summary = hasData
    ? `Technical analysis for ${symbol} on ${timeframe} based on ${stats.totalSignals} recent signals. Win rate: ${stats.winRate}% over ${stats.resolved} resolved trades. Avg P&L: ${stats.avgPnl}%. Last bias: ${stats.lastDirection ?? 'N/A'}.`
    : `Technical analysis for ${symbol} on ${timeframe}. No historical signal data available — using default mock indicators.`;

  return {
    role: 'analyst',
    summary,
    confidence,
    signals,
    timestamp: new Date(),
  };
}

function buildRiskAnalysis(
  symbol: string,
  stats: SymbolStats,
): AgentAnalysis {
  const signals: AgentAnalysis['signals'] = [];

  if (stats.resolved > 0) {
    const drawdownEstimate = stats.avgPnl < 0
      ? `${(stats.avgPnl * 3).toFixed(1)}% (3x avg loss)`
      : '-2.0% (estimated from avg winners)';

    signals.push({
      indicator: 'Historical Win Rate',
      value: `${stats.winRate}%`,
      interpretation:
        stats.winRate >= 55
          ? 'Acceptable edge for position sizing'
          : 'Edge uncertain — reduce size',
    });
    signals.push({
      indicator: 'Est. Max Drawdown',
      value: drawdownEstimate,
      interpretation: 'Based on recent resolved outcomes',
    });
    signals.push({
      indicator: 'Position Size',
      value: stats.winRate >= 55 ? '1% risk' : '0.5% risk',
      interpretation:
        stats.winRate >= 55
          ? 'Standard sizing — edge confirmed'
          : 'Half-size — edge not confirmed',
    });
  } else {
    signals.push({
      indicator: 'ATR',
      value: '1.2%',
      interpretation: 'Moderate volatility (mock)',
    });
    signals.push({
      indicator: 'Max Drawdown (30d)',
      value: '-4.2%',
      interpretation: 'Within tolerance (mock)',
    });
    signals.push({
      indicator: 'Position Size',
      value: '0.5% risk',
      interpretation: 'Reduced — no historical data to confirm edge',
    });
  }

  const confidence = stats.resolved >= 10
    ? Math.min(85, stats.winRate)
    : 50;

  return {
    role: 'risk_manager',
    summary: stats.resolved > 0
      ? `Risk assessment for ${symbol}: ${stats.winRate}% win rate over ${stats.resolved} trades. ${stats.winRate >= 55 ? 'Standard' : 'Reduced'} position sizing recommended.`
      : `Risk assessment for ${symbol}: insufficient historical data. Conservative 0.5% position sizing recommended until track record develops.`,
    confidence,
    signals,
    timestamp: new Date(),
  };
}

function buildPMVerdict(
  analystAnalysis: AgentAnalysis,
  riskAnalysis: AgentAnalysis,
  stats: SymbolStats,
): FinalVerdict {
  const avgConfidence = Math.round(
    (analystAnalysis.confidence + riskAnalysis.confidence) / 2,
  );

  // Decision logic based on real data when available
  let action: 'BUY' | 'SELL' | 'HOLD';
  let sizing: string;
  let reasoning: string;

  if (stats.resolved < 5) {
    action = 'HOLD';
    sizing = 'No position';
    reasoning =
      'Insufficient historical data to form conviction. Wait for at least 5 resolved signals before taking a position.';
  } else if (avgConfidence >= 65 && stats.winRate >= 55) {
    action = (stats.lastDirection as 'BUY' | 'SELL') ?? 'BUY';
    sizing = '1% of portfolio';
    reasoning = `${action} signal supported by ${stats.winRate}% win rate and ${avgConfidence}% combined confidence from analyst and risk agents.`;
  } else if (avgConfidence >= 50 && stats.winRate >= 45) {
    action = (stats.lastDirection as 'BUY' | 'SELL') ?? 'BUY';
    sizing = '0.5% of portfolio';
    reasoning = `${action} with reduced size — win rate (${stats.winRate}%) and confidence (${avgConfidence}%) are borderline. Half-position to manage risk.`;
  } else {
    action = 'HOLD';
    sizing = 'No position';
    reasoning = `Insufficient conviction: ${stats.winRate}% win rate with ${avgConfidence}% confidence. Wait for a higher-probability setup.`;
  }

  return {
    action,
    confidence: avgConfidence,
    sizing,
    reasoning,
  };
}

/**
 * Runs the research pipeline: analyst -> risk -> PM.
 * The analyst step queries real signal_history for the symbol to enrich analysis
 * with actual win rates and indicator data.
 * LLM reasoning is still mocked — will be replaced with real LLM calls later.
 */
export async function runResearchPipeline(
  jobId: string,
  symbol: string,
  timeframe: string,
): Promise<void> {
  try {
    // Step 1: Analyst — fetch real data then analyze
    await updateJobStatus(jobId, 'analyst');
    await delay(800);

    const stats = await fetchSymbolStats(symbol);
    const analystResult = buildAnalystAnalysis(symbol, timeframe, stats);

    // Step 2: Risk Manager
    await updateJobStatus(jobId, 'risk', [analystResult]);
    await delay(600);

    const riskResult = buildRiskAnalysis(symbol, stats);

    // Step 3: Portfolio Manager
    const analyses = [analystResult, riskResult];
    await updateJobStatus(jobId, 'pm', analyses);
    await delay(500);

    const verdict = buildPMVerdict(analystResult, riskResult, stats);

    // Complete
    await updateJobStatus(jobId, 'complete', analyses, verdict);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    try {
      await updateJobStatus(jobId, 'failed');
    } catch {
      // Best-effort status update — DB may be unreachable
    }
    throw new Error(`Research pipeline failed for job ${jobId}: ${message}`);
  }
}

/**
 * @deprecated Use runResearchPipeline instead. Kept for backward compatibility.
 */
export const runMockResearch = runResearchPipeline;
