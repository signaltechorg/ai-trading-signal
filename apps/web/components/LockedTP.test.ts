import { buildLockedTPFallbackHref } from './LockedTP';

describe('buildLockedTPFallbackHref', () => {
  test('routes logged-out users back to pricing with resume checkout hints', () => {
    expect(buildLockedTPFallbackHref(2, 'signal-card')).toBe(
      '/pricing?resume=checkout&interval=monthly&from=tp2-signal-card',
    );
  });

  test('keeps the analytics tag stable for TP3 without a source tag', () => {
    expect(buildLockedTPFallbackHref(3)).toBe(
      '/pricing?resume=checkout&interval=monthly&from=tp3',
    );
  });
});
