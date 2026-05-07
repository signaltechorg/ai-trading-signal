-- User profile fields captured from OAuth providers.
--
-- The users.name column already exists (migration 001_monetization.sql) and
-- is reused for display name. This migration adds:
--
--   * avatar_url     — profile image URL from Google's `picture` field or
--                      GitHub's `avatar_url` field. Captured at sign-in and
--                      refreshed on every successful OAuth callback.
--   * auth_provider  — 'google' | 'github'. Recorded once on first sign-in
--                      so we can render the correct provider chip in the UI
--                      and never overwrite it (avoids confusing flips when a
--                      user later signs in via a different provider that
--                      resolves to the same email).
--
-- All additions are nullable; no backfill is required. Existing rows keep
-- working — the navbar falls back to a User icon + email when fields are null.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url    TEXT NULL,
  ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(16) NULL
    CHECK (auth_provider IS NULL OR auth_provider IN ('google', 'github', 'email'));
