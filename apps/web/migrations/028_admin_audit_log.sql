-- Append-only audit trail for money-impacting admin actions.
--
-- Background: before this migration, admin write paths (Pro tier grants,
-- revokes, social-queue approvals/rejections/copy edits) left no record.
-- This was flagged as gap M2 in docs/audits/2026-05-09-admin-and-dashboard-audit.md.
--
-- Callers:
--   apps/web/app/admin/pro-grants/actions.ts  → writes pro_grant, pro_revoke
--   apps/web/app/api/admin/social-queue/route.ts → writes social_approve,
--     social_reject, social_update_copy
--
-- Apply on Railway with:
--   psql "$DATABASE_URL" -f apps/web/migrations/028_admin_audit_log.sql

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor       VARCHAR(255) NOT NULL,
  via         VARCHAR(16)  NOT NULL,
  action      VARCHAR(64)  NOT NULL,
  target      TEXT         NULL,
  payload     JSONB        NULL,
  at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_at
  ON admin_audit_log (at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor_at
  ON admin_audit_log (actor, at DESC);
