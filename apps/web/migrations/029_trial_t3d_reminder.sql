-- T-3d trial reminder support.
--
-- Background: the existing T-1d email (migration 023) lands when the
-- trial is already over from a cancel-decision standpoint — Stripe Smart
-- Retries don't run on trial conversions, and most users who want to
-- cancel a trial decide 2-3 days before the charge, not 24 hours before.
--
-- To anchor the cancel decision to concrete dollars instead of a generic
-- countdown, /api/cron/trial-reminders gains a T-3d sweep that emails:
--   "If you'd taken our top 3 Pro signals at 1% sizing during your trial,
--    you'd be up $X. Card hits in 3 days."
--
-- - trial_reminder_t3d_sent_at: Set by /api/cron/trial-reminders when the
--                               T-3d email lands. Separate column from
--                               trial_reminder_sent_at so the T-1d email
--                               still ships independently — both can fire
--                               for the same subscription across the trial.
--
-- Column is nullable. No backfill — existing trialing subs simply skip
-- the T-3d window since the cron predicates on the new column being NULL.
--
-- Apply on Railway with:
--   psql "$DATABASE_URL" -f apps/web/migrations/029_trial_t3d_reminder.sql

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS trial_reminder_t3d_sent_at TIMESTAMP WITH TIME ZONE NULL;

-- Cron query path mirrors idx_subscriptions_trialing_due — partial index
-- keeps it small (only trialing rows that haven't been T-3d emailed yet).
CREATE INDEX IF NOT EXISTS idx_subscriptions_trialing_t3d_due
  ON subscriptions (trial_end)
  WHERE status = 'trialing' AND trial_reminder_t3d_sent_at IS NULL;
