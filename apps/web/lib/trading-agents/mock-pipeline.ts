import type { AgentAnalysis, FinalVerdict } from './types';
import { updateJobStatus } from './research-jobs';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mockAnalystAnalysis(symbol: string, timeframe: string): AgentAnalysis {
  return {
    role: 'analyst',
    summary: `Technical analysis for ${symbol} on ${timeframe}. RSI neutral, MACD showing slight bullish divergence. EMA 50/200 golden cross forming.`,
    confidence: 72,
    signals: [
      { indicator: 'RSI', value: '52', interpretation: 'Neutral zone' },
      { indicator: 'MACD', value: 'Bullish crossover', interpretation: 'Momentum shifting up' },
      { indicator: 'EMA 50/200', value: 'Converging', interpretation: 'Potential golden cross' },
    ],
    timestamp: new Date(),
  };
}

function mockRiskAnalysis(symbol: string): AgentAnalysis {
  return {
    role: 'risk_manager',
    summary: `Risk assessment for ${symbol}: moderate volatility, acceptable drawdown profile. Position sizing recommended at 1% max risk.`,
    confidence: 68,
    signals: [
      { indicator: 'ATR', value: '1.2%', interpretation: 'Moderate volatility' },
      { indicator: 'Max Drawdown (30d)', value: '-4.2%', interpretation: 'Within tolerance' },
      { indicator: 'Correlation', value: '0.3 to portfolio', interpretation: 'Low correlation, good diversifier' },
    ],
    timestamp: new Date(),
  };
}

function mockPMVerdict(): FinalVerdict {
  const actions = ['BUY', 'SELL', 'HOLD'] as const;
  const action = actions[Math.floor(Math.random() * 3)];
  return {
    action,
    confidence: 65,
    sizing: '1% of portfolio',
    reasoning:
      action === 'HOLD'
        ? 'Insufficient conviction from analyst signals. Wait for clearer setup.'
        : `${action} signal confirmed by analyst momentum shift and acceptable risk profile.`,
  };
}

/**
 * Runs a mock research pipeline simulating analyst -> risk -> PM flow.
 * Each step updates the job status in the database.
 * This is a placeholder; real implementation will call Python agents or LLM.
 */
export async function runMockResearch(
  jobId: string,
  symbol: string,
  timeframe: string,
): Promise<void> {
  try {
    // Step 1: Analyst
    await updateJobStatus(jobId, 'analyst');
    await delay(1000);
    const analystResult = mockAnalystAnalysis(symbol, timeframe);

    // Step 2: Risk Manager
    await updateJobStatus(jobId, 'risk', [analystResult]);
    await delay(1000);
    const riskResult = mockRiskAnalysis(symbol);

    // Step 3: Portfolio Manager
    const analyses = [analystResult, riskResult];
    await updateJobStatus(jobId, 'pm', analyses);
    await delay(1000);
    const verdict = mockPMVerdict();

    // Complete
    await updateJobStatus(jobId, 'complete', analyses, verdict);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await updateJobStatus(jobId, 'failed').catch(() => {});
    // Re-throw so callers can observe failure if needed
    throw new Error(`Research pipeline failed for job ${jobId}: ${message}`);
  }
}
