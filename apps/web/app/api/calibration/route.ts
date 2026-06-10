import { NextResponse } from 'next/server';
import { readHistoryAsync, isCountedResolved } from '@/lib/signal-history';

export const revalidate = 300; // 5-min cache

interface CalibrationBucket {
  label: string;
  confMin: number;
  confMax: number;
  count: number;
  wins: number;
  /** Null when the bucket is empty — the UI must not render a fake point. */
  winRate: number | null;
  midpoint: number;
  calibrationError: number | null;
}

const BUCKETS = [
  { label: '50-59%', confMin: 0.50, confMax: 0.60, midpoint: 0.545 },
  { label: '60-69%', confMin: 0.60, confMax: 0.70, midpoint: 0.645 },
  { label: '70-79%', confMin: 0.70, confMax: 0.80, midpoint: 0.745 },
  { label: '80-89%', confMin: 0.80, confMax: 0.90, midpoint: 0.845 },
  { label: '90-99%', confMin: 0.90, confMax: 1.00, midpoint: 0.945 },
];

/**
 * signal_history stores confidence on the 0-100 scale (e.g. 72, 85 — see
 * PRO_PREMIUM_MIN_CONFIDENCE = 85). Normalize to 0-1 for bucketing and Brier.
 * Before this fix the route compared the raw 0-100 value against 0-1 bucket
 * bounds: every bucket was empty, each fell back to winRate = midpoint, and
 * the reliability chart rendered as perfectly calibrated — fabricated by
 * construction. Defensive: values already <= 1 pass through unchanged.
 */
function normalizeConfidence(raw: number): number {
  return raw > 1 ? raw / 100 : raw;
}

export async function GET() {
  try {
    const history = await readHistoryAsync();
    // Canonical resolved filter: excludes simulated rows, gate-blocked rows,
    // and auto-expired closes — same population as win-rate/equity, so the
    // calibration chart measures the engine, not placeholder artifacts.
    const resolved = history
      .filter(isCountedResolved)
      .map((s) => ({ ...s, confidence: normalizeConfidence(s.confidence) }))
      .filter((s) => s.confidence >= 0.5);

    const buckets: CalibrationBucket[] = BUCKETS.map((b) => {
      const inBucket = resolved.filter(
        (s) => s.confidence >= b.confMin && s.confidence < b.confMax
      );
      const wins = inBucket.filter((s) => s.outcomes['24h']?.hit).length;
      const winRate = inBucket.length > 0 ? wins / inBucket.length : null;
      return {
        label: b.label,
        confMin: b.confMin,
        confMax: b.confMax,
        count: inBucket.length,
        wins,
        winRate,
        midpoint: b.midpoint,
        calibrationError: winRate !== null ? Math.abs(winRate - b.midpoint) : null,
      };
    });

    const totalSignals = resolved.length;
    const totalWins = resolved.filter((s) => s.outcomes['24h']?.hit).length;
    const overallAccuracy = totalSignals > 0 ? totalWins / totalSignals : 0;

    // Brier score: mean((conf - outcome)^2) on the 0-1 scale.
    const brier = totalSignals > 0
      ? resolved.reduce((sum, s) => {
          const outcome = s.outcomes['24h']?.hit ? 1 : 0;
          return sum + Math.pow(s.confidence - outcome, 2);
        }, 0) / totalSignals
      : null;

    // ECE: weighted mean calibration error over non-empty buckets.
    const ece = totalSignals > 0
      ? buckets.reduce(
          (sum, b) => sum + (b.calibrationError !== null ? (b.count / totalSignals) * b.calibrationError : 0),
          0,
        )
      : null;

    return NextResponse.json({
      buckets,
      overallAccuracy,
      totalSignals,
      isSimulated: totalSignals < 20,
      brier,
      ece,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Calibration API error:', err);
    return NextResponse.json({ error: 'Failed to compute calibration' }, { status: 500 });
  }
}
