import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Gauge,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { requireAdmin } from '../../../lib/admin-gate';
import {
  loadGatedSignals,
  loadRecentSignals,
  loadTodayCounts,
  type GatedSignalRow,
  type RecentSignalRow,
  type TodayCounts,
} from '../../../lib/ops-dashboard';

export const metadata: Metadata = {
  title: 'Ops Dashboard | TradeClaw Admin',
  description: 'Signal engine observability.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(t)) return iso;
  const diffSec = Math.round((Date.now() - t) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  return `${Math.round(diffSec / 86400)}d ago`;
}

function formatConfidence(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : value;
}

function StatCard({
  label,
  value,
  icon: Icon,
  hint,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">{label}</p>
        <Icon size={16} className="text-zinc-500" />
      </div>
      <p className="mt-2 text-2xl font-bold text-white">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}

function DirectionPill({ direction }: { direction: 'BUY' | 'SELL' }) {
  const cls =
    direction === 'BUY'
      ? 'bg-emerald-500/15 text-emerald-400'
      : 'bg-red-500/15 text-red-400';
  return (
    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${cls}`}>
      {direction}
    </span>
  );
}

function OutcomePill({
  outcome,
  label,
}: {
  outcome: { hit?: boolean; pnlPct?: number } | null;
  label: string;
}) {
  if (!outcome) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-zinc-800/60 px-2 py-0.5 text-[10px] text-zinc-400">
        <Clock size={10} />
        {label}: pending
      </span>
    );
  }
  const pnl = typeof outcome.pnlPct === 'number' ? `${outcome.pnlPct.toFixed(2)}%` : '—';
  if (outcome.hit === true) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
        <CheckCircle2 size={10} />
        {label} hit · {pnl}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-400">
      <XCircle size={10} />
      {label} miss · {pnl}
    </span>
  );
}

function TodayPanel({ today }: { today: TodayCounts }) {
  const winRate =
    today.wins24h + today.losses24h > 0
      ? ((today.wins24h / (today.wins24h + today.losses24h)) * 100).toFixed(0) + '%'
      : '—';
  const lastRunAge = formatRelativeTime(today.lastRunStartedAt);
  return (
    <section>
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        <Activity size={14} className="text-emerald-400" />
        Today (last 24h)
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Signals" value={today.signals24h} icon={Activity} />
        <StatCard
          label="Gate-blocked"
          value={today.gateBlocked24h}
          icon={ShieldAlert}
          hint="suppressed by full-risk gate"
        />
        <StatCard
          label="24h win rate"
          value={winRate}
          icon={Gauge}
          hint={`${today.wins24h}W / ${today.losses24h}L · ${today.pending24h} pending`}
        />
        <StatCard
          label="Last cron run"
          value={lastRunAge}
          icon={Clock}
          hint={
            today.lastRunTriggerSource
              ? `source: ${today.lastRunTriggerSource}`
              : 'no signal_run_log rows yet'
          }
        />
      </div>
      {today.lastRunStartedAt && (
        <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-xs text-zinc-400">
          Last run wrote {today.lastRunTotalSignals ?? 0} signals (
          {today.lastRunVerifiedSignals ?? 0} verified ·{' '}
          <span className="text-emerald-400">{today.lastRunWinCount ?? 0}W</span> /{' '}
          <span className="text-red-400">{today.lastRunLossCount ?? 0}L</span> ·{' '}
          {today.lastRunPendingCount ?? 0} pending) at{' '}
          <span className="font-mono">{today.lastRunStartedAt.slice(0, 19).replace('T', ' ')}</span>
          {today.lastRunFinishedAt && (
            <>
              {' '}
              · finished{' '}
              <span className="font-mono">
                {today.lastRunFinishedAt.slice(0, 19).replace('T', ' ')}
              </span>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function GatedPanel({ rows }: { rows: GatedSignalRow[] }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        <ShieldAlert size={14} className="text-amber-400" />
        Gated signals — last 30 by recency
      </div>
      <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Pair</th>
              <th className="px-4 py-2.5 font-medium">Dir</th>
              <th className="px-4 py-2.5 font-medium">Conf</th>
              <th className="px-4 py-2.5 font-medium">Gate reason</th>
              <th className="px-4 py-2.5 font-medium">Strategy</th>
              <th className="px-4 py-2.5 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-zinc-500" colSpan={6}>
                  No gate-blocked signals on record.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-white/[0.04]">
                <td className="px-4 py-2.5 font-mono text-xs text-white">{r.pair}</td>
                <td className="px-4 py-2.5">
                  <DirectionPill direction={r.direction} />
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-zinc-300">
                  {formatConfidence(r.confidence)}
                </td>
                <td className="px-4 py-2.5 text-xs text-zinc-300">
                  {r.gate_reason ?? <span className="text-zinc-600">—</span>}
                </td>
                <td className="px-4 py-2.5 text-xs text-zinc-500">
                  {r.strategy_id ?? <span className="text-zinc-700">—</span>}
                </td>
                <td className="px-4 py-2.5 text-xs text-zinc-500">
                  {formatRelativeTime(r.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RecentPanel({ rows }: { rows: RecentSignalRow[] }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        <Activity size={14} className="text-emerald-400" />
        Recent signals — last 30
      </div>
      <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Pair</th>
              <th className="px-4 py-2.5 font-medium">Dir</th>
              <th className="px-4 py-2.5 font-medium">Conf</th>
              <th className="px-4 py-2.5 font-medium">Entry</th>
              <th className="px-4 py-2.5 font-medium">Outcomes</th>
              <th className="px-4 py-2.5 font-medium">Strategy</th>
              <th className="px-4 py-2.5 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-zinc-500" colSpan={7}>
                  No signals yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-white/[0.04]">
                <td className="px-4 py-2.5 font-mono text-xs text-white">{r.pair}</td>
                <td className="px-4 py-2.5">
                  <DirectionPill direction={r.direction} />
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-zinc-300">
                  {formatConfidence(r.confidence)}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-zinc-300">{r.entry_price}</td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    <OutcomePill outcome={r.outcome_4h} label="4h" />
                    <OutcomePill outcome={r.outcome_24h} label="24h" />
                    {r.gate_blocked && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                        <ShieldAlert size={10} />
                        gated
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-xs text-zinc-500">
                  {r.strategy_id ?? <span className="text-zinc-700">—</span>}
                </td>
                <td className="px-4 py-2.5 text-xs text-zinc-500">
                  {formatRelativeTime(r.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function AdminOpsPage() {
  const grant = await requireAdmin();
  const [today, gated, recent] = await Promise.all([
    loadTodayCounts(),
    loadGatedSignals(30),
    loadRecentSignals(30),
  ]);
  const generatedAt = new Date().toISOString();

  return (
    <main className="min-h-screen bg-[#050505] px-4 py-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Gauge size={20} className="text-emerald-400" />
              <h1 className="text-2xl font-bold text-white">Ops Dashboard</h1>
            </div>
            <p className="mt-1 text-sm text-zinc-400">
              Signed in as{' '}
              <span className="font-mono text-emerald-400">
                {grant.email ?? 'tc_admin (secret)'}
              </span>
              {' · '}
              <span className="font-mono text-zinc-500">{generatedAt}</span>
            </p>
          </div>
          <Link
            href="/admin"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/5"
          >
            <ArrowLeft size={12} />
            Admin home
          </Link>
        </div>

        <div className="mt-8 space-y-8">
          <TodayPanel today={today} />
          <GatedPanel rows={gated} />
          <RecentPanel rows={recent} />
        </div>
      </div>
    </main>
  );
}
