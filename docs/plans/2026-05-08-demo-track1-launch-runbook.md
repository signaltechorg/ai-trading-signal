# Track 1 — Binance Futures Testnet Demo: Operator Launch Runbook

> Operator-only checklist. ~30 minutes if Railway CLI is already authed.
> Pairs with [2026-05-06-demo-trading-master.md](2026-05-06-demo-trading-master.md) §Day-1.
> Prereq commits: `9e46029` (plan), `842b77a` (gate-zero symbol fix), `81c76a7` (FK type fix), `4c00180`/`d18f191` (kill-switch + advisory lock hardening).

## 0. Pre-flight (do once)

- [ ] Confirm Railway CLI is authed: `railway whoami`
- [ ] Confirm linked to the right project: `railway status` (expect the `web` service)
- [ ] Confirm local branch is `main` and up to date: `git status && git pull`
- [ ] Confirm gate-zero fix is on the deployed SHA: `git log --oneline 842b77a..HEAD -- apps/web/lib/execution/executor.ts` should show no executor edits, OR all later edits are intentional.

## 1. Get Binance testnet credentials (5 min)

Use **futures** testnet — `testnet.binancefuture.com` — NOT spot testnet (`testnet.binance.vision`). They are different sites with non-interchangeable keys.

- [ ] Go to <https://testnet.binancefuture.com>
- [ ] Log in with GitHub or Google
- [ ] Click **"API Key"** in the bottom-right of the trading screen
- [ ] Copy `apiKey` and `apiSecret` to a 1Password note titled `tradeclaw-binance-testnet`
- [ ] On the same page, click **"Get Test USDT"** if balance < 1000 USDT. The executor sizes at `EXEC_RISK_PCT=1`, so 10000 USDT testnet bankroll = $100 risk per trade — comfortable for the 30-day run.

## 2. Apply migration `018_pilot_executions.sql` to Railway (5 min)

The migration is `IF NOT EXISTS`-guarded and includes the FK type fix from `81c76a7`. Safe to re-run.

- [ ] Confirm the file at HEAD: `git show HEAD:apps/web/migrations/018_pilot_executions.sql | head -20`
- [ ] Apply via the repo's runner (which iterates `apps/web/migrations/` against `DATABASE_URL`):

  ```bash
  railway run --service web npm --prefix apps/web run migrate
  ```

  Alternative (direct, if `npm migrate` runs every migration and you want only this one):

  ```bash
  railway run --service web psql "$DATABASE_URL" -f apps/web/migrations/018_pilot_executions.sql
  ```

- [ ] Verify the three tables exist:

  ```sql
  -- railway run --service web psql "$DATABASE_URL"
  \dt executions execution_errors universe_snapshots
  -- expect 3 rows
  SELECT column_name, data_type
    FROM information_schema.columns
   WHERE table_name = 'executions' AND column_name IN ('signal_id','client_order_id');
  -- signal_id MUST be 'text' (not 'uuid'). If 'uuid', the FK type fix didn't land — abort.
  ```

## 3. Set Railway env vars (5 min)

All four are required. Names match what `apps/web/lib/execution/binance-futures.ts` reads.

- [ ] `EXECUTION_MODE=testnet`
- [ ] `BINANCE_BASE_URL=https://testnet.binancefuture.com`
- [ ] `BINANCE_API_KEY=<from §1>`
- [ ] `BINANCE_API_SECRET=<from §1>`

Optional but **recommended** — point market data at mainnet so the universe screen / ATR / EMA50 / ADX(14) see real liquidity, not synthetic testnet candles:

- [ ] `BINANCE_MARKET_DATA_URL=https://fapi.binance.com`

CLI form:

```bash
railway variables --service web \
  --set EXECUTION_MODE=testnet \
  --set BINANCE_BASE_URL=https://testnet.binancefuture.com \
  --set BINANCE_API_KEY=xxxxxxxx \
  --set BINANCE_API_SECRET=xxxxxxxx \
  --set BINANCE_MARKET_DATA_URL=https://fapi.binance.com
```

## 4. Handshake — verify keys before deploy (2 min)

Read-only call against `/fapi/v2/account`. Proves keys are valid + have futures permission, without placing any order.

```bash
railway run --service web npx tsx apps/web/scripts/binance-handshake.ts
```

Expected output:

```
— Binance Futures handshake —
  base_url:         https://testnet.binancefuture.com
  testnet:          true
  execution_mode:   testnet
  api_key_present:  true
  api_sec_present:  true
[1/2] GET /fapi/v1/time …    server_time=...  local_drift_ms=<200ms
[2/2] GET /fapi/v2/account … total_wallet_balance: 10000 USDT (or whatever you topped up)
✓ Handshake successful.
```

If you see `✗ Handshake failed:`:
- `code -2014 / -2015` → key is invalid or wrong site (spot key on futures URL, or vice versa)
- `code -1021` → clock drift > 1s on the Railway runner (rare; retry once)
- `ECONNREFUSED` → typo in `BINANCE_BASE_URL`

## 5. Deploy (5 min)

```bash
railway up --detach --service web
```

Per workspace `CLAUDE.md`, GitHub auto-deploy is OFF for this project. The `--detach` flag returns immediately; tail logs separately if you want them.

Watch deploy logs:

```bash
railway logs --service web --deployment
```

Wait for `Ready` (Next.js) and confirm no startup errors mentioning `BINANCE_*` or `pilot_executions`.

## 6. Watch for first executions (24h)

The `hmm-top3` cron runs every minute. Expect 1-3 sized signals per day after gating.

### 6a. Live tail (what's happening right now)

```bash
railway logs --service web --tail | grep -E "executor|execution_errors|signal_history"
```

### 6b. Periodic SQL pulls

```sql
-- railway run --service web psql "$DATABASE_URL"

-- Trades placed in last 24h
SELECT created_at, symbol, side, qty, entry_price, stop_price, tp1_price,
       leverage, notional_usd, risk_usd, status, client_order_id
  FROM executions
 ORDER BY created_at DESC
 LIMIT 20;

-- Why other signals were skipped
SELECT created_at, signal_id, stage, error_code, error_msg
  FROM execution_errors
 WHERE created_at > NOW() - INTERVAL '24 hours'
 ORDER BY created_at DESC
 LIMIT 50;

-- Aggregate by reason (most common skip)
SELECT error_code, COUNT(*) AS n
  FROM execution_errors
 WHERE created_at > NOW() - INTERVAL '24 hours'
 GROUP BY error_code
 ORDER BY n DESC;
```

## 7. Failure modes — first-24h triage

| Symptom | Likely cause | Fix |
|---|---|---|
| `executions` empty AND `execution_errors` empty | Cron not firing OR `EXECUTION_MODE` not set | Confirm `currentMode()` in startup logs; check `BINANCE_API_KEY` env actually persisted (`railway variables --service web`) |
| `error_code = symbol_not_in_exchange_info` | Gate-zero fix `842b77a` not on deployed SHA | `git log --oneline -- apps/web/lib/execution/executor.ts` and re-deploy |
| `error_code = symbol_not_binance_eligible` | Expected — non-crypto pairs (FX/metals/equities). Track 2 territory, not Track 1 | No action |
| `error_code = disabled` | `EXECUTION_MODE` is unset or `disabled` | Set `EXECUTION_MODE=testnet` and redeploy |
| `error_code = kill_switch_*` | Daily/weekly loss rail tripped | Expected safety; reset by waiting a day or clearing the rail (check `risk-rails.ts`) |
| Handshake passed but order rejected `-2019` | Insufficient testnet margin | Top up testnet USDT |
| `error_code = symbol_not_eligible_today` | Universe screen excluded the symbol on `vol_24h_usd` / `ef_ratio` | Expected; check `universe_snapshots` |

## 8. Acceptance — what "Track 1 is running" means

All of:
- [ ] Handshake §4 passes
- [ ] At least one row in `executions` with `status IN ('filled','partially_filled','closed')` within 48h of deploy
- [ ] Error rate (errors / total signals processed) < 30% in `execution_errors`
- [ ] No `kill_switch_*` triggers in first 7 days unless realized DD legitimately hit the rail
- [ ] Daily 09:00 MYT digest (Telegram via `EXEC_TELEGRAM_CHAT_ID`) shows non-empty open positions OR closed PnL

After 7 days of clean fills, hand to Phase 2 (reconciliation cron — separate ticket).

## 9. Rollback (if something goes wrong)

Single-toggle kill:

```bash
railway variables --service web --set EXECUTION_MODE=disabled
```

This short-circuits every WRITE in `binance-futures.ts` to a logged dry-run. Reads still flow. Keys stay where they are. No redeploy needed (env change triggers Railway rolling restart).

Full rollback (if migration corrupted):

```sql
-- Only if §2 verification showed wrong types AND fresh data is OK to lose
DROP TABLE IF EXISTS execution_errors;
DROP TABLE IF EXISTS executions;
DROP TABLE IF EXISTS universe_snapshots;
-- Then re-run the migration with a corrected SQL file
```

## 10. What this runbook does NOT cover

- Track 2 (RoboForex / R StocksTrader) — separate runbook once API surface confirmed
- Track 3 (IBKR Paper) — local IB Gateway setup, defer until Track 1 is green
- Reconciliation SQL report — drop-in addition once `executions` has ≥10 closed rows
- Multi-tenant (Phase 2) — `user_id` is nullable in this migration on purpose

## Update log

- 2026-05-08: Initial runbook. Companion to master plan §Day-1 checklist.
