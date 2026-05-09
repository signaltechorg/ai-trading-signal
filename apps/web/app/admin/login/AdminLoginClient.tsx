'use client';

import { useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BackgroundDecor } from '@/components/background/BackgroundDecor';

// Why: prevents open-redirect — attacker can craft ?redirect=//evil.com or ?redirect=https://evil.com
function isSafeRedirect(target: string | null): boolean {
  if (!target || target.length < 2) return false;
  if (target[0] !== '/') return false;
  if (target[1] === '/' || target[1] === '\\') return false;
  if (/[\r\n\t]/.test(target)) return false;
  return true;
}

export function AdminLoginClient() {
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? 'Login failed');
        return;
      }

      const redirectTarget = searchParams.get('redirect');
      const next = isSafeRedirect(redirectTarget) ? redirectTarget! : '/admin';
      router.push(next);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative isolate min-h-screen overflow-hidden bg-[#0a0a0f] flex items-center justify-center px-4">
      <BackgroundDecor variant="minimal" />
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-white text-2xl font-bold mb-1">TradeClaw Admin</h1>
          <p className="text-gray-500 text-sm">
            Enter your admin secret to continue
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="secret" className="block text-gray-400 text-xs mb-1.5">
              Admin Secret
            </label>
            <input
              id="secret"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Enter ADMIN_SECRET"
              required
              autoFocus
              className="w-full px-3 py-2.5 bg-white/5 border border-gray-800 rounded-lg text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
            />
          </div>

          {error && (
            <p className="text-rose-400 text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !secret}
            className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {loading ? 'Authenticating...' : 'Login'}
          </button>
        </form>

        <p className="text-gray-600 text-xs text-center mt-6">
          Set <code className="text-gray-500">ADMIN_SECRET</code> in your environment to enable admin access.
        </p>
      </div>
    </div>
  );
}
