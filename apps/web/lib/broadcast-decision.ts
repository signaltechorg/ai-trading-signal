/**
 * Pro-broadcast gate decision, computed BEFORE persistence (engine-makeover
 * Phase 1). One pipeline run per cron tick decides, per signal: does this row
 * reach the Pro broadcast, and why not if it doesn't. The cron records the
 * decision on the row (migration 048) so the broadcast-filtered subset is
 * measurable — previously the decision was computed after recording and only
 * console-warned.
 *
 * Decision semantics:
 * - winning-cells curation (when active) blocks deterministically.
 * - risk pipeline (circuit breakers → allocator → veto) blocks with a reason.
 * - pipeline OUTAGE falls back to unfiltered broadcast (Pro must not silently
 *   mute) — those rows are marked `recordable: false` and their decision is
 *   NOT persisted: the gate never actually ran, so NULL ("decision not
 *   recorded") is the truthful state even though the row was broadcast.
 */

import { isWinningCell, getWinningCellsMode } from './winning-cells';
import { runRiskPipeline } from './risk-pipeline';
import { fetchRegimeMap, getDominantRegime } from './regime-filter';
import type { BroadcastDecisionFields } from './signal-history';
import type { MarketRegime } from '@tradeclaw/signals';

export interface BroadcastCandidate {
  id: string;
  symbol: string;
  timeframe: string;
  direction: 'BUY' | 'SELL';
  confidence: number;
  entry: number;
  takeProfit1: number;
  stopLoss: number;
}

export interface BroadcastDecision extends BroadcastDecisionFields {
  id: string;
  /** True when a real gate decision ran (winning-cells or risk pipeline). False = pipeline outage fallback: row broadcasts unfiltered and the decision must NOT be persisted. */
  recordable: boolean;
}

export async function computeBroadcastDecisions(
  candidates: BroadcastCandidate[],
): Promise<Map<string, BroadcastDecision>> {
  const decisions = new Map<string, BroadcastDecision>();
  if (candidates.length === 0) return decisions;

  let regimeMap = new Map<string, MarketRegime>();
  try {
    regimeMap = await fetchRegimeMap();
  } catch {
    // Empty map → everything resolves 'neutral', same as the filter layer.
  }
  const dominant = getDominantRegime(regimeMap);
  const regimeOf = (symbol: string): string =>
    regimeMap.get(symbol.toUpperCase()) ?? dominant;

  const winningCellsActive = getWinningCellsMode() === 'active';
  const curated: BroadcastCandidate[] = [];
  for (const c of candidates) {
    if (winningCellsActive && !isWinningCell(c.symbol, c.direction)) {
      decisions.set(c.id, {
        id: c.id,
        regime: regimeOf(c.symbol),
        blocked: true,
        blockReason: 'winning_cells: not in current winning set',
        recordable: true,
      });
    } else {
      curated.push(c);
    }
  }

  if (curated.length === 0) return decisions;

  try {
    const result = await runRiskPipeline(
      curated.map((s) => ({
        id: s.id,
        symbol: s.symbol,
        direction: s.direction,
        confidence: s.confidence,
        entry: s.entry,
        stopLoss: s.stopLoss,
        takeProfit1: s.takeProfit1,
        takeProfit2: null,
        takeProfit3: null,
        timeframe: s.timeframe,
      })),
      regimeMap,
    );
    // report.allocations is pushed one entry per input signal IN INPUT ORDER
    // (risk-pipeline.ts signal loop) but keyed only by symbol — a symbol with
    // both BUY and SELL in the same tick would collide in a symbol-keyed map
    // and persist the wrong positionSizePct. Zip by index instead.
    const allocByIndex = result.report.allocations;
    const allocOf = (id: string): number | undefined => {
      const idx = curated.findIndex((c) => c.id === id);
      return idx >= 0 ? allocByIndex[idx]?.positionSizePct : undefined;
    };
    for (const s of result.approved) {
      decisions.set(s.id, {
        id: s.id,
        regime: regimeOf(s.symbol),
        blocked: false,
        allocationPct: allocOf(s.id),
        recordable: true,
      });
    }
    for (const v of result.vetoed) {
      decisions.set(v.signal.id, {
        id: v.signal.id,
        regime: regimeOf(v.signal.symbol),
        blocked: true,
        blockReason: `${v.vetoedBy}: ${v.reason}`,
        allocationPct: allocOf(v.signal.id),
        recordable: true,
      });
    }
  } catch (err) {
    // Mirror the long-standing broadcast fallback: a transient risk-state
    // outage must not mute the Pro channel. These rows broadcast unfiltered;
    // their gate decision never ran, so they are not recordable.
    console.warn(
      '[broadcast-decision] Risk pipeline failed, falling back to unfiltered broadcast:',
      err instanceof Error ? err.message : String(err),
    );
    for (const c of curated) {
      decisions.set(c.id, {
        id: c.id,
        regime: regimeOf(c.symbol),
        blocked: false,
        recordable: false,
      });
    }
  }

  return decisions;
}
