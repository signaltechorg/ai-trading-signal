'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Activity, Cpu, Plug } from 'lucide-react';

interface Tool {
  id: string;
  name: string;
  category: string;
  description: string | null;
  enabled: boolean;
  config: Record<string, unknown>;
  updatedAt: string;
}

const CATEGORY_META: Record<string, { label: string; icon: typeof Activity }> = {
  indicator: { label: 'Indicators', icon: Activity },
  signal_engine: { label: 'Signal Engines', icon: Cpu },
  connector: { label: 'Connectors', icon: Plug },
};

export function ToolsClient() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/operator/tools');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTools(data.tools ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleToggle(id: string, enabled: boolean) {
    setToggling(id);
    setError(null);
    try {
      const res = await fetch('/api/operator/tools', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTools((prev) => prev.map((t) => (t.id === id ? data.tool : t)));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to toggle');
    } finally {
      setToggling(null);
    }
  }

  const grouped = tools.reduce<Record<string, Tool[]>>((acc, tool) => {
    const cat = tool.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(tool);
    return acc;
  }, {});

  const categories = Object.keys(CATEGORY_META).filter((k) => grouped[k]?.length);

  return (
    <div className="space-y-6">
      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          {tools.length} tools registered
        </p>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {loading && tools.length === 0 ? (
        <div className="py-10 text-center text-sm text-zinc-500">Loading...</div>
      ) : (
        categories.map((cat) => {
          const meta = CATEGORY_META[cat];
          const Icon = meta.icon;
          return (
            <div key={cat}>
              <div className="mb-2 flex items-center gap-2">
                <Icon size={14} className="text-emerald-400" />
                <h2 className="text-sm font-semibold text-white">{meta.label}</h2>
              </div>
              <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
                {grouped[cat].map((tool, i) => (
                  <div
                    key={tool.id}
                    className={`flex items-center justify-between px-4 py-3 ${
                      i > 0 ? 'border-t border-white/[0.04]' : ''
                    }`}
                  >
                    <div>
                      <p className="text-sm font-medium text-white">{tool.name}</p>
                      {tool.description && (
                        <p className="mt-0.5 text-xs text-zinc-500">{tool.description}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleToggle(tool.id, !tool.enabled)}
                      disabled={toggling === tool.id}
                      className={`relative h-6 w-11 rounded-full transition-colors ${
                        tool.enabled ? 'bg-emerald-600' : 'bg-zinc-700'
                      } ${toggling === tool.id ? 'opacity-50' : ''}`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                          tool.enabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
