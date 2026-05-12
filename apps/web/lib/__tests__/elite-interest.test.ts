import {
  validateEliteInterest,
  wtpChoiceToCents,
  type EliteInterestInput,
} from '../elite-interest';

function valid(overrides: Partial<EliteInterestInput> = {}): EliteInterestInput {
  return {
    email: 'trader@example.com',
    wantsLiveTrade: true,
    wantsCopyTrade: true,
    wtpChoice: '99',
    ...overrides,
  };
}

describe('elite-interest — wtpChoiceToCents', () => {
  it('maps each fixed bucket to cents', () => {
    expect(wtpChoiceToCents('49')).toBe(4900);
    expect(wtpChoiceToCents('99')).toBe(9900);
    expect(wtpChoiceToCents('199')).toBe(19900);
    expect(wtpChoiceToCents('499')).toBe(49900);
    expect(wtpChoiceToCents('999_plus')).toBe(99900);
  });

  it('returns null for "other" and null inputs', () => {
    expect(wtpChoiceToCents('other')).toBeNull();
    expect(wtpChoiceToCents(null)).toBeNull();
  });
});

describe('elite-interest — validateEliteInterest', () => {
  it('accepts a fully filled valid input', () => {
    expect(validateEliteInterest(valid())).toEqual({ ok: true });
  });

  it('accepts null wtpChoice (user skipped the survey)', () => {
    expect(validateEliteInterest(valid({ wtpChoice: null }))).toEqual({ ok: true });
  });

  it('rejects missing email', () => {
    const result = validateEliteInterest(valid({ email: '' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/email/i);
  });

  it('rejects malformed email', () => {
    const result = validateEliteInterest(valid({ email: 'not-an-email' }));
    expect(result.ok).toBe(false);
  });

  it('rejects too-long email to prevent DB-truncation attacks', () => {
    const long = 'a'.repeat(260) + '@x.com';
    const result = validateEliteInterest(valid({ email: long }));
    expect(result.ok).toBe(false);
  });

  it('rejects when neither feature checkbox is selected', () => {
    const result = validateEliteInterest(
      valid({ wantsLiveTrade: false, wantsCopyTrade: false }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/select.*at least one/i);
  });

  it('accepts wantsLiveTrade only', () => {
    expect(
      validateEliteInterest(valid({ wantsLiveTrade: true, wantsCopyTrade: false })),
    ).toEqual({ ok: true });
  });

  it('accepts wantsCopyTrade only', () => {
    expect(
      validateEliteInterest(valid({ wantsLiveTrade: false, wantsCopyTrade: true })),
    ).toEqual({ ok: true });
  });

  it('rejects an invalid wtpChoice value', () => {
    const result = validateEliteInterest(
      valid({ wtpChoice: 'bogus' as unknown as EliteInterestInput['wtpChoice'] }),
    );
    expect(result.ok).toBe(false);
  });
});
