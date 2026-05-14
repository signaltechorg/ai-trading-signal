-- TradeClaw Pilot — close-time exit price snapshot.
-- Plan: docs/plans/2026-05-01-tradeclaw-pilot-binance-futures.md
--
-- Adds executions.exit_price: mark price observed at the moment the position
-- manager detects liveQty == 0 on Binance. This is a SNAPSHOT, not the
-- authoritative fill price.
--
-- Why not the actual fill avg price?
--   The accurate value is the VWAP of closing fills via /fapi/v1/userTrades.
--   That endpoint takes another signed call per close and isn't needed for
--   Phase 1 dashboards — mark-at-detection is within a few bps and is good
--   enough for entry-vs-exit analytics during the 30-day soak.
--
-- Cash-settled P&L lives in executions.realized_pnl (separately populated,
-- currently lazy — see position-manager.ts Phase 1.5 note).

ALTER TABLE executions
  ADD COLUMN IF NOT EXISTS exit_price NUMERIC(24,12);
