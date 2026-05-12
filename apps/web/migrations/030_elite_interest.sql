-- Elite-tier interest capture + willingness-to-pay (WTP) survey.
--
-- Background: Elite is the third tier above Pro. Its two pillars per the
-- product roadmap are (a) connect-to-live-trade — pushing Pro signals
-- into the user's broker — and (b) copy-trade, framed as the moat. Both
-- features are non-trivial to ship, so the pricing page surfaces an Elite
-- "Coming Soon" card with a waitlist + WTP form to gauge demand and price
-- point before any Stripe products exist.
--
-- Columns:
-- - email:               normalized lowercase, primary identity. UNIQUE so
--                        a repeat submission is treated as an update of
--                        intent rather than two rows.
-- - wants_live_trade,
--   wants_copy_trade:    feature interest checkboxes from the form.
-- - wtp_monthly_cents:   willingness-to-pay survey answer, stored as cents
--                        so currency-free integer math works. NULL when
--                        the user picked "other" / declined to answer.
-- - wtp_choice:          the raw survey selection ('49', '99', '199',
--                        '499', '999_plus', 'other'). Kept alongside cents
--                        so re-analysis later doesn't lose the bucket.
-- - ip_hash:             SHA-256 of the client IP + secret salt, used for
--                        rate-limit dedup without storing raw IPs.
-- - source:              free-text "where did this submission come from"
--                        (e.g. 'pricing', 'dashboard-banner'); helps
--                        attribution.
--
-- Apply on Railway:
--   psql "$DATABASE_URL" -f apps/web/migrations/030_elite_interest.sql
--
-- Idempotent (CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS elite_interest (
  id                  BIGSERIAL PRIMARY KEY,
  email               TEXT NOT NULL,
  wants_live_trade    BOOLEAN NOT NULL DEFAULT FALSE,
  wants_copy_trade    BOOLEAN NOT NULL DEFAULT FALSE,
  wtp_monthly_cents   INTEGER NULL,
  wtp_choice          TEXT NULL,
  ip_hash             TEXT NULL,
  source              TEXT NULL,
  created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_elite_interest_email
  ON elite_interest (LOWER(email));

CREATE INDEX IF NOT EXISTS idx_elite_interest_created_at
  ON elite_interest (created_at DESC);
