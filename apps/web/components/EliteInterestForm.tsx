'use client';

import { useState } from 'react';

type WtpChoice = '49' | '99' | '199' | '499' | '999_plus' | 'other';

interface WtpOption {
  value: WtpChoice;
  label: string;
}

const WTP_OPTIONS: WtpOption[] = [
  { value: '49', label: '$49/mo' },
  { value: '99', label: '$99/mo' },
  { value: '199', label: '$199/mo' },
  { value: '499', label: '$499/mo' },
  { value: '999_plus', label: '$999+/mo' },
  { value: 'other', label: 'Not sure yet' },
];

export interface EliteInterestFormProps {
  source?: string;
}

export function EliteInterestForm({ source = 'pricing' }: EliteInterestFormProps) {
  const [email, setEmail] = useState('');
  const [wantsLiveTrade, setWantsLiveTrade] = useState(true);
  const [wantsCopyTrade, setWantsCopyTrade] = useState(true);
  const [wtpChoice, setWtpChoice] = useState<WtpChoice | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/elite/interest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          wantsLiveTrade,
          wantsCopyTrade,
          wtpChoice,
          source,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      if (!res.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Submission failed');
      }
      setSuccessMessage(payload.message ?? "You're on the list.");
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (successMessage) {
    return (
      <div
        role="status"
        data-testid="elite-interest-success"
        className="rounded-lg border border-emerald-500/40 bg-emerald-500/[0.08] p-4 text-center text-sm text-emerald-200"
      >
        {successMessage}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="elite-interest-form"
      className="flex flex-col gap-4"
    >
      <div>
        <label htmlFor="elite-email" className="mb-1 block text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
          Email
        </label>
        <input
          id="elite-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--text-secondary)] focus:border-emerald-500 focus:outline-none"
        />
      </div>

      <fieldset>
        <legend className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
          Most interested in
        </legend>
        <div className="flex flex-col gap-2">
          <label className="flex items-start gap-2 text-sm text-[var(--foreground)]">
            <input
              type="checkbox"
              checked={wantsCopyTrade}
              onChange={(e) => setWantsCopyTrade(e.target.checked)}
              className="mt-1 accent-emerald-500"
            />
            <span>
              <span className="font-semibold text-emerald-400">Copy trade</span> — your account mirrors our Pro signals automatically
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-[var(--foreground)]">
            <input
              type="checkbox"
              checked={wantsLiveTrade}
              onChange={(e) => setWantsLiveTrade(e.target.checked)}
              className="mt-1 accent-emerald-500"
            />
            <span>
              Connect to live trade — Pro signals pushed straight to your broker
            </span>
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
          What would you pay per month?
        </legend>
        <div className="grid grid-cols-3 gap-2">
          {WTP_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setWtpChoice(opt.value)}
              aria-pressed={wtpChoice === opt.value}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                wtpChoice === opt.value
                  ? 'border-emerald-500 bg-emerald-500/[0.12] text-emerald-200'
                  : 'border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] hover:border-[var(--glass-border-accent)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={submitting || (!wantsLiveTrade && !wantsCopyTrade)}
        data-testid="elite-interest-submit"
        className="rounded-lg bg-emerald-500 py-2.5 text-sm font-semibold text-black transition-all hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Sending…' : 'Get on the Elite list'}
      </button>

      {error && (
        <p role="alert" className="text-center text-xs text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}
