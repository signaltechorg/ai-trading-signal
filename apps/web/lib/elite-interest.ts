import { execute, queryOne } from './db-pool';

export type WtpChoice = '49' | '99' | '199' | '499' | '999_plus' | 'other';

export const WTP_CHOICES: readonly WtpChoice[] = [
  '49',
  '99',
  '199',
  '499',
  '999_plus',
  'other',
] as const;

export interface EliteInterestInput {
  email: string;
  wantsLiveTrade: boolean;
  wantsCopyTrade: boolean;
  wtpChoice: WtpChoice | null;
  ipHash?: string | null;
  source?: string | null;
}

export interface EliteInterestRecord {
  id: number;
  email: string;
  wantsLiveTrade: boolean;
  wantsCopyTrade: boolean;
  wtpChoice: WtpChoice | null;
  wtpMonthlyCents: number | null;
  source: string | null;
  createdAt: Date;
  isNew: boolean;
}

const MAX_EMAIL_LEN = 254;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Map the survey's fixed buckets to monetary cents so downstream
 * aggregation can do integer math. 'other' / null preserve the
 * "user declined to anchor a price" signal.
 */
export function wtpChoiceToCents(choice: WtpChoice | null): number | null {
  switch (choice) {
    case '49':
      return 4900;
    case '99':
      return 9900;
    case '199':
      return 19900;
    case '499':
      return 49900;
    case '999_plus':
      return 99900;
    case 'other':
    case null:
      return null;
  }
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: string };

export function validateEliteInterest(input: EliteInterestInput): ValidationResult {
  const email = (input.email ?? '').trim();
  if (!email) return { ok: false, error: 'Email is required' };
  if (email.length > MAX_EMAIL_LEN) return { ok: false, error: 'Email is too long' };
  if (!EMAIL_REGEX.test(email)) return { ok: false, error: 'Email looks malformed' };

  if (!input.wantsLiveTrade && !input.wantsCopyTrade) {
    return { ok: false, error: 'Select at least one feature' };
  }

  if (input.wtpChoice !== null && !WTP_CHOICES.includes(input.wtpChoice)) {
    return { ok: false, error: 'Invalid willingness-to-pay choice' };
  }

  return { ok: true };
}

interface InterestRow {
  id: string;
  email: string;
  wants_live_trade: boolean;
  wants_copy_trade: boolean;
  wtp_choice: WtpChoice | null;
  wtp_monthly_cents: number | null;
  source: string | null;
  created_at: string;
}

/**
 * Upsert by lowercase email — repeat submissions overwrite the prior
 * intent rather than producing duplicate rows. Returns isNew=true on
 * the first insert, false on a subsequent update.
 */
export async function upsertEliteInterest(
  input: EliteInterestInput,
): Promise<EliteInterestRecord> {
  const email = input.email.trim().toLowerCase();
  const wtpCents = wtpChoiceToCents(input.wtpChoice);

  // Use ON CONFLICT to detect new vs update via xmax — xmax=0 means
  // INSERT (new row), nonzero means UPDATE.
  const row = await queryOne<InterestRow & { is_new: boolean }>(
    `INSERT INTO elite_interest
       (email, wants_live_trade, wants_copy_trade, wtp_monthly_cents, wtp_choice, ip_hash, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (LOWER(email)) DO UPDATE SET
       wants_live_trade = EXCLUDED.wants_live_trade,
       wants_copy_trade = EXCLUDED.wants_copy_trade,
       wtp_monthly_cents = EXCLUDED.wtp_monthly_cents,
       wtp_choice = EXCLUDED.wtp_choice,
       source = COALESCE(EXCLUDED.source, elite_interest.source),
       updated_at = NOW()
     RETURNING id, email, wants_live_trade, wants_copy_trade,
               wtp_choice, wtp_monthly_cents, source, created_at,
               (xmax = 0) AS is_new`,
    [
      email,
      input.wantsLiveTrade,
      input.wantsCopyTrade,
      wtpCents,
      input.wtpChoice,
      input.ipHash ?? null,
      input.source ?? null,
    ],
  );

  if (!row) {
    throw new Error('elite_interest upsert returned no row');
  }

  return {
    id: Number(row.id),
    email: row.email,
    wantsLiveTrade: row.wants_live_trade,
    wantsCopyTrade: row.wants_copy_trade,
    wtpChoice: row.wtp_choice,
    wtpMonthlyCents: row.wtp_monthly_cents,
    source: row.source,
    createdAt: new Date(row.created_at),
    isNew: row.is_new,
  };
}

export async function getEliteInterestCount(): Promise<number> {
  try {
    const row = await queryOne<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM elite_interest`,
    );
    return Number(row?.c ?? 0);
  } catch {
    return 0;
  }
}

export async function hashIpForInterest(ip: string | null | undefined): Promise<string | null> {
  if (!ip) return null;
  const salt = process.env.ELITE_IP_HASH_SALT ?? '';
  if (!salt) return null;
  const { createHash } = await import('crypto');
  return createHash('sha256').update(`${salt}|${ip}`).digest('hex');
}

// Re-export execute for tests that mock the DB layer.
export const __test__ = { execute };
