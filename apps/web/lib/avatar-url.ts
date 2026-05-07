/**
 * Allowlist for OAuth-provided avatar URLs.
 *
 * Only Google's `lh*.googleusercontent.com` and GitHub's
 * `avatars.githubusercontent.com` host avatars on https. Anything else
 * coming back from the IdP — a redirect, a custom-domain CDN, a
 * hand-rolled URL — gets dropped to null at signin time so the navbar
 * never hot-links an attacker-controlled domain. Cheaper than tightening
 * the application-wide CSP for one feature.
 */
const ALLOWED_AVATAR_HOSTS = [
  'lh3.googleusercontent.com',
  'lh4.googleusercontent.com',
  'lh5.googleusercontent.com',
  'lh6.googleusercontent.com',
  'avatars.githubusercontent.com',
];

export function safeAvatarUrl(input: unknown): string | null {
  if (typeof input !== 'string' || !input) return null;
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (!ALLOWED_AVATAR_HOSTS.includes(parsed.hostname)) return null;
  return parsed.toString();
}
