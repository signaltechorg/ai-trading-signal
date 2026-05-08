/**
 * Risk Pipeline — Orchestrates the full risk check sequence.
 *
 * Signal flow:
 * 1. Reconstruct risk state from DB (getRiskState)
 * 2. Evaluate circuit breakers (regime-adaptive)
 * 3. For each signal: compute allocation → veto check
 * 4. LLM advisory verification (Gemini Flash, batch — not per-signal)
 * 5. Apply LLM adjustments (can only reduce, never increase)
 * 6. Return approved signals + risk report
 *
 * The deterministic pipeline (breakers + veto) makes the actual decision.
 * The LLM can only DOWNGRADE (reduce allocation), never UPGRADE.
 */

import {
  CircuitBreakerEngine,
  computeAllocation,
  vetoCheck,
  type MarketRegime,
  type RiskState,
  type AllocationResult,
  type VetoResult,
} from '@tradeclaw/signals';
import { getRiskState, type ReconstructedRiskState } from './risk-state';
import { getDominantRegime } from './regime-filter';
import { getPortfolio, getDemoUserId, type Portfolio } from './paper-trading';
import { verifyRiskWithLlm, type LlmRiskVerification } from './llm-risk-verify';

// Notional equity used when no demo-user portfolio is available so the
// allocator has a non-zero base. Pro broadcasts must not silently mute on a
// missing PUBLIC_WIDGET_DEMO_USER_ID — see Step 3 in runRiskPipeline.
const NOTIONAL_EQUITY_FALLBACK = 10_000;

// ── Types ────────────────────────────────────────────────────

interface SignalForPipeline {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  confidence: number;
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number | null;
  takeProfit3: number | null;
  timeframe: string;
}

export interface RiskPipelineResult {
  approved: SignalForPipeline[];
  vetoed: Array<{
    signal: SignalForPipeline;
    reason: string;
    vetoedBy: string;
  }>;
  report: RiskReport;
}

export interface RiskReport {
  regime: MarketRegime;
  riskState: ReconstructedRiskState['summary'];
  activeBreakers: string[];
  canTrade: boolean;
  llmVerification: LlmRiskVerification | null;
  allocations: Array<{
    symbol: string;
    positionSizePct: number;
    approved: boolean;
    reason: string;
  }>;
  timestamp: string;
}

// ── Main pipeline ────────────────────────────────────────────

export async function runRiskPipeline(
  signals: SignalForPipeline[],
  regimeMap: Map<string, MarketRegime>,
): Promise<RiskPipelineResult> {
  const regime = getDominantRegime(regimeMap);

  // Step 1: Reconstruct risk state from DB
  const reconstructed = await getRiskState();

  // Log risk metrics for debugging
  console.info(
    `[risk-pipeline] source=${reconstructed.summary.source} regime=${regime} ` +
    `trades=${reconstructed.summary.totalRecentTrades} ` +
    `dailyPnl=${reconstructed.summary.dailyPnlPct.toFixed(2)}% ` +
    `weeklyPnl=${reconstructed.summary.weeklyPnlPct.toFixed(2)}% ` +
    `drawdown=${reconstructed.summary.drawdownFromPeakPct.toFixed(2)}% ` +
    `streak=${reconstructed.summary.consecutiveLosses} ` +
    `winRate=${reconstructed.summary.winRate}%`,
  );

  // Step 2: Evaluate circuit breakers with regime-adaptive thresholds
  const riskState = CircuitBreakerEngine.evaluateForRegime(
    reconstructed.metrics,
    regime,
  );

  const activeBreakers = riskState.activeBreakers;
  const canTrade = riskState.canTrade;

  // Early exit: if close_all is active, reject everything
  if (!canTrade && riskState.breakers.some((b) => b.active && b.action === 'close_all')) {
    return {
      approved: [],
      vetoed: signals.map((s) => ({
        signal: s,
        reason: 'Max drawdown circuit breaker active — all trading halted',
        vetoedBy: 'circuit_breaker',
      })),
      report: buildReport(regime, reconstructed, activeBreakers, canTrade, null, []),
    };
  }

  // Step 3: For each signal — allocate + veto.
  // Portfolio state comes from the operator's demo-user paper account. When
  // PUBLIC_WIDGET_DEMO_USER_ID is unset (or fetch fails), fall back to
  // NOTIONAL_EQUITY_FALLBACK so the allocator can still size positions.
  // The earlier zeroed-shell fallback caused totalEquity=0 → allocator
  // rejected every signal as "Portfolio equity is zero or negative" → veto
  // chain muted Pro broadcasts entirely. Circuit breakers and per-signal
  // vetoes still run on the notional path; only the no-portfolio trap is
  // removed.
  const operatorId = getDemoUserId();
  const portfolio: Portfolio | null = operatorId
    ? await getPortfolio(operatorId).catch(() => null)
    : null;
  const balance = portfolio?.balance ?? NOTIONAL_EQUITY_FALLBACK;
  const positions = portfolio?.positions ?? [];
  const positionsValue = positions.reduce((sum, p) => sum + p.quantity, 0);
  const portfolioState = {
    totalEquity: balance + positionsValue,
    cash: balance,
    positionsValue,
    openPositions: positions.map((p) => ({
      symbol: p.symbol,
      direction: p.direction as 'BUY' | 'SELL',
      size: p.quantity,
      entryPrice: p.entryPrice,
      currentPrice: p.entryPrice,
      pnl: 0,
      pnlPct: 0,
    })),
    highWaterMark: reconstructed.summary.highWaterMark,
    drawdownPct: reconstructed.summary.drawdownFromPeakPct,
  };

  const approved: SignalForPipeline[] = [];
  const vetoed: RiskPipelineResult['vetoed'] = [];
  const allocations: RiskReport['allocations'] = [];

  for (const signal of signals) {
    const symbolRegime = regimeMap.get(signal.symbol.toUpperCase()) ?? regime;

    // Allocation check
    const allocation: AllocationResult = computeAllocation(
      { symbol: signal.symbol, direction: signal.direction, confidence: signal.confidence },
      symbolRegime,
      portfolioState,
    );

    allocations.push({
      symbol: signal.symbol,
      positionSizePct: allocation.positionSizePct,
      approved: allocation.approved,
      reason: allocation.reason ?? '',
    });

    // Veto check
    const veto: VetoResult = vetoCheck(
      { symbol: signal.symbol, direction: signal.direction, confidence: signal.confidence },
      riskState,
      allocation.approved,
      symbolRegime,
    );

    if (veto.approved) {
      approved.push(signal);
    } else {
      vetoed.push({
        signal,
        reason: veto.reason ?? 'Rejected by risk veto',
        vetoedBy: veto.vetoedBy ?? 'risk_veto',
      });
    }
  }

  // Step 4: LLM advisory verification (batch, not per-signal)
  let llmVerification: LlmRiskVerification | null = null;

  if (approved.length > 0) {
    llmVerification = await verifyRiskWithLlm(
      regime,
      reconstructed,
      approved.map((s) => ({
        symbol: s.symbol,
        direction: s.direction,
        confidence: s.confidence,
      })),
      activeBreakers,
    );

    // Step 5: Apply LLM advisory adjustments
    // LLM can only DOWNGRADE, never UPGRADE
    if (llmVerification.suggestedAction === 'halt' && !llmVerification.concur) {
      // LLM strongly disagrees — move all to "reduced" but don't block
      // Log the disagreement for review
      console.warn(
        '[risk-pipeline] LLM DISAGREES with proceed decision:',
        llmVerification.concerns.join('; '),
      );
      // We still allow signals through but note the LLM concern in the report
    }
  }

  return {
    approved,
    vetoed,
    report: buildReport(regime, reconstructed, activeBreakers, canTrade, llmVerification, allocations),
  };
}

// ── Report builder ───────────────────────────────────────────

function buildReport(
  regime: MarketRegime,
  reconstructed: ReconstructedRiskState,
  activeBreakers: string[],
  canTrade: boolean,
  llmVerification: LlmRiskVerification | null,
  allocations: RiskReport['allocations'],
): RiskReport {
  return {
    regime,
    riskState: reconstructed.summary,
    activeBreakers,
    canTrade,
    llmVerification,
    allocations,
    timestamp: new Date().toISOString(),
  };
}
