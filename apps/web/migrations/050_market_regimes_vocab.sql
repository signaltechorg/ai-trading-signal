-- 050: market_regimes structural vocabulary (engine-makeover Phase 3, plan D1).
--
-- Swaps the 5-state drift vocabulary CHECK from 004_hmm_regime.sql
-- (crash/bear/neutral/bull/euphoria) for the canonical structural one:
-- trend / volatile / range. This unblocks the Phase 3 regime writer — the
-- old constraint would reject every row it tries to INSERT.
--
-- The DELETE below is belt-and-braces, not a data migration: the table has
-- never had a writer (verified — zero INSERTs repo-wide), so it is empty in
-- every environment and the DELETE removes nothing in practice. It exists so
-- the new CHECK can always attach, even on a database someone hand-populated.
--
-- Idempotent and self-contained (the runner applies each file in its own
-- transaction): re-running drops and re-adds the same constraint. The inline
-- CHECK from 004 was auto-named by Postgres (conventionally
-- market_regimes_regime_check) — discovered defensively below rather than
-- trusting the name, same pattern as the healing block in 004.

DO $$
DECLARE
  con TEXT;
BEGIN
  IF to_regclass('market_regimes') IS NULL THEN
    RETURN; -- table not created yet; 004 creates it (sorts before this file)
  END IF;

  DELETE FROM market_regimes WHERE regime NOT IN ('trend', 'volatile', 'range');

  -- Drop every CHECK constraint that references the regime column, whatever
  -- Postgres happened to auto-name it (also covers re-runs of this file).
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'market_regimes'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%regime%'
  LOOP
    EXECUTE format('ALTER TABLE market_regimes DROP CONSTRAINT IF EXISTS %I', con);
  END LOOP;

  ALTER TABLE market_regimes
    ADD CONSTRAINT market_regimes_regime_check
    CHECK (regime IN ('trend', 'volatile', 'range'));
END
$$;
