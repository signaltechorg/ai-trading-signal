# Demo-Trade hmm-top3 Signals on RoboForex R StocksTrader (REST)

> Plan only. Supersedes Track 2 of [2026-05-06-demo-trading-master.md](2026-05-06-demo-trading-master.md)
> and replaces [2026-05-06-demo-roboforex-mt5.md](2026-05-06-demo-roboforex-mt5.md) for the
> RoboForex execution path. MetaApi is no longer needed.
>
> Goal: 30+ day live-demo validation of the published track record on a
> multi-asset venue, using the R StocksTrader REST API directly.
> Trading portal: <https://stockstrader.roboforex.com/trading?redirectURL=login>

## 1. Why R StocksTrader REST instead of MetaApi/MT5

| Concern | MetaApi/MT5 (original Track 2) | R StocksTrader REST (this plan) |
|---|---|---|
| Bridge | Third-party MetaApi cloud relay | Direct REST to RoboForex |
| Cost | Free (1 acct), $15/mo per extra | Free for the operator key |
| Auth | MetaApi token → MetaApi → MT5 | Bearer token → RoboForex |
| Failure surface | Two-hop (MetaApi outage breaks us) | One-hop |
| Symbol coverage | FX, metals, indices, stock CFDs, crypto CFDs | Same set, plus ETFs, on **one** account |
| Symbol naming | MT5 codes (`#AAPL`, `EURUSD`, `NQ100`) | R StocksTrader codes (`AAPL.US`, `EUR/USD`, `US100`) — **different**, must map separately |
| Order types | `BUY_STOP`/`SELL_STOP` with attached SL/TP | Market + Limit + Stop with attached SL/TP (verify exact param names against operator dashboard) |
| Account info | MetaApi `account-information` | RoboForex account endpoint |
| Idempotency | MetaApi `clientId` | R StocksTrader supports a client-side reference field — name TBD-verify |

**Decision**: pick R StocksTrader REST. Strictly fewer moving parts.

The original MetaApi plan stays on disk as historical context; do not delete
it. It remains the fallback if R StocksTrader's REST proves unsuitable
(e.g. rate limits, missing endpoints).

## 2. R StocksTrader account setup

1. Log in at <https://stockstrader.roboforex.com/trading?redirectURL=login>
   with the existing operator credentials.
2. In the dashboard, locate the **API** / **Developer** tab. Confirm the:
   - **API base URL** (regional — typically `https://stockstrader.roboforex.com/api/...`
     but verify the exact path and version on your dashboard; the docs
     panel in-app is the authoritative source).
   - **Bearer token** (the "API key" the operator already has — confirm it
     has trade permission, not read-only).
   - **Account ID** for the demo account that should receive signals.
3. Verify the account is a **demo** account, not live. The operator must
   tick this explicitly. The bridge has no way to detect mode from the
   token alone.
4. Save `RSTOCKSTRADER_BASE_URL`, `RSTOCKSTRADER_TOKEN`,
   `RSTOCKSTRADER_ACCOUNT_ID` to a 1Password note titled
   `tradeclaw-demo-rstockstrader`.

## 3. Architecture

```
signal_history (Postgres)               R StocksTrader (RoboForex)
        |                                          ^
        v                                          | (direct,
  cron/execute (60s)                               |  Bearer-auth
        |                                          |  HTTPS)
        v                                          |
  executor.ts -> rstockstrader-bridge.ts -- HTTPS -+
```

Single hop. No MetaApi, no MT5 desktop, no Windows VM, no daily reauth.

## 4. Symbol mapping

R StocksTrader uses different symbol codes than MT5 and than TradeClaw's
TwelveData-canonical codes. Confirm exact codes via:

```
GET {RSTOCKSTRADER_BASE_URL}/instruments
Authorization: Bearer {token}
```

Sample mapping (verify each entry against the live `/instruments` response —
this table is a starting point, not an authoritative spec):

| TradeClaw `pair` | R StocksTrader symbol (likely) | Asset class | Notes |
|---|---|---|---|
| BTCUSD     | BTC/USD     | crypto CFD  | not perp; spread funding |
| ETHUSD     | ETH/USD     | crypto CFD  |                       |
| SOLUSD     | SOL/USD     | crypto CFD  |                       |
| XRPUSD     | XRP/USD     | crypto CFD  |                       |
| DOGEUSD    | DOGE/USD    | crypto CFD  |                       |
| BNBUSD     | n/a         | -           | flag: skip on this leg |
| EURUSD     | EUR/USD     | FX          | direct                |
| GBPUSD     | GBP/USD     | FX          |                       |
| USDJPY     | USD/JPY     | FX          |                       |
| AUDUSD    | AUD/USD     | FX          |                       |
| USDCAD     | USD/CAD     | FX          |                       |
| NZDUSD     | NZD/USD     | FX          |                       |
| USDCHF     | USD/CHF     | FX          |                       |
| XAUUSD     | XAU/USD     | metal       | gold spot, 100 oz contract |
| XAGUSD     | XAG/USD     | metal       | silver spot, 5000 oz contract |
| WTIUSD     | XTI/USD or WTI.OIL | energy CFD | verify code |
| BNOUSD     | BNO.US      | US ETF      | verify; otherwise skip |
| NVDAUSD    | NVDA.US     | US stock    | confirm `.US` suffix syntax |
| TSLAUSD    | TSLA.US     | US stock    |                       |
| AAPLUSD    | AAPL.US     | US stock    |                       |
| MSFTUSD    | MSFT.US     | US stock    |                       |
| GOOGLUSD   | GOOGL.US    | US stock    |                       |
| AMZNUSD    | AMZN.US     | US stock    |                       |
| METAUSD    | META.US     | US stock    |                       |
| SPYUSD     | SPY.US      | US ETF      |                       |
| QQQUSD     | QQQ.US      | US ETF      |                       |

Mapping lives in `apps/web/lib/execution/rstockstrader-symbols.ts` (this
plan ships an interface-only sketch alongside).

Unknown TradeClaw pair → log + skip with `error_code = symbol_not_rstockstrader_eligible`.
Do NOT auto-fall-back to a similar symbol.

## 5. Day-1 action checklist for Zaky

1. Confirm in the R StocksTrader dashboard:
   - The base URL exposed to the operator (verify path and version)
   - That the existing API token has trade-write permission
   - The numeric account ID of the **demo** account to receive signals
2. Set Railway env vars (do NOT commit):
   - `RSTOCKSTRADER_BASE_URL=https://stockstrader.roboforex.com/api/...` (exact path from dashboard)
   - `RSTOCKSTRADER_TOKEN=<bearer>`
   - `RSTOCKSTRADER_ACCOUNT_ID=<numeric id>`
3. Pull `/instruments` once via curl from your laptop (read-only,
   no order placement):
   ```bash
   curl -H "Authorization: Bearer $RSTOCKSTRADER_TOKEN" \
        "$RSTOCKSTRADER_BASE_URL/instruments?limit=500" | jq '.[].symbol' | sort | head -100
   ```
4. Cross-check the §4 mapping table against actual `/instruments` codes.
   File any drift by editing `rstockstrader-symbols.ts`.
5. Place ONE manual 0.01 lot EUR/USD market order via REST to confirm
   write path. Cancel/close it manually in the dashboard.
6. Run an executor dry-run against a single live signal in dev — confirm
   the request payload looks right; do NOT actually post.
7. Flip `EXECUTION_BROKER=r-stockstrader` and `EXECUTION_MODE=demo` on
   Railway. Watch first real signal land and confirm a row in `executions`
   with `broker = 'r-stockstrader'`.

## 6. Sizing for non-crypto leverage

Existing [`sizing.ts`](../../apps/web/lib/execution/sizing.ts) is risk-first
(`riskUsdBudget = equity * riskPct`), asset-class agnostic. Per-broker deltas:

- **ATR**: same `computeATR`, R StocksTrader OHLC is in price units (verify
  via `/candles` or equivalent endpoint).
- **Lot semantics**: R StocksTrader uses `units` (not MT5 lots). Verify the
  exact name in `/instruments[].lot_size` / `min_qty` / `qty_step`. Build
  a `RStocksTraderInstrumentSpec` shape parallel to `SymbolFilters`. Same
  `roundQty` algorithm, different inputs.
- **Notional cap**: crypto CFD on this venue is far lower leverage than
  Binance perps. FX retail is up to 1:30 or 1:200 (operator account
  type-dependent). Cap notional separately:
  - `EXEC_FX_PER_TRADE_NOTIONAL_PCT` — suggest 100 (= equity ceiling)
  - `EXEC_STOCK_PER_TRADE_NOTIONAL_PCT` — suggest 100
  - `EXEC_CRYPTO_CFD_PER_TRADE_NOTIONAL_PCT` — suggest 50 (CFD spreads wide on weekends)
- **Per-unit risk**: read `contractSize` (or equivalent) from instrument
  spec; for FX 1 lot ≈ 100 000 units; for stocks 1 unit = 1 share; for
  XAUUSD 1 lot ≈ 100 oz. Same formula:
  `qty * stopDistance * contractSize` → USD risk.
- **Equity source**: `RSTOCKSTRADER_ACCOUNT_ID` → `account-information`
  endpoint → `equity` (verify field name).
- **Per-trade risk stays 1%**: same `EXEC_RISK_PCT=1`.

## 7. Order construction differences vs Binance Futures

| Concern | Binance Futures | R StocksTrader REST |
|---|---|---|
| Entry type | `MARKET` or `LIMIT` | Prefer stop-entry above/below trigger to limit slippage on illiquid CFDs (verify exact type name) |
| Stop loss | Separate `STOP_MARKET` reduceOnly order | Attached to position at order placement (single REST call) |
| Take profit | Separate `TAKE_PROFIT_MARKET` order | Attached to position at order placement |
| Idempotency | `clientOrderId` | Client-reference field — verify exact name in API tab |
| Symbol rules | `exchangeInfo.LOT_SIZE` etc. | `/instruments/{symbol}` — verify shape |
| Stops level / min stop distance | n/a | Likely enforced; verify and reject locally before posting |
| Time in force | `GTC`/`IOC`/`FOK` | TBD-verify |

Instrument spec fetch (per symbol, cache 1h):
```
GET {RSTOCKSTRADER_BASE_URL}/instruments/{symbol}
Authorization: Bearer {token}
```

## 8. Cost & friction

- **API cost**: zero. Operator already holds the key.
- **Account cost**: zero on demo. Live deployment is a different account
  type (R StocksTrader Pro or similar) — out of scope here.
- **Latency**: cron cadence is 60s; Railway us-east → RoboForex
  (typically EU-routed) round-trip ~150-400 ms. Total fill latency under
  2s for stop-entry. Fine for H1 timeframe; marginal for M5; out of scope.
- **Rate limits**: TBD-verify. Most broker REST APIs are 10-60 req/sec
  per token. Bridge implementation MUST include a token-bucket limiter
  per-token before going live.
- **Weekend gap**: FX/equities closed Sat-Sun; crypto CFDs continue with
  wider spread. Existing weekend gating in `tracked-signals.ts` handles
  this — confirm no double-filter.

## 9. Sketch — `apps/web/lib/execution/rstockstrader-bridge.ts` (interface only)

The interface lives in code under that path, not duplicated here. See the
companion file shipped in this PR. Mirrors the shape of the proposed
MetaApi bridge so `executor.ts` can dispatch by `EXECUTION_BROKER`
without branching the executor body.

## 10. Acceptance criteria (day 30)

Pass conditions, all required:
- Realized R per trade ≥ +0.20R (vs published +0.32R)
- Win rate ≥ 42% (vs published 46%)
- Max drawdown ≤ 35%
- ≥ 60 sized trades placed (sanity check vs hmm-top3 historical cadence)
- < 3 broker-rejected errors not caught by the sizing module
- Equity curve correlation with `signal_history.outcome_24h`-derived paper
  curve ≥ 0.85 (Pearson)

Reconciliation cron compares each closed `executions.realized_pnl` to
`signal_history.outcome_24h.pnlPct` for the matching signal — same SQL as
master plan §Reconciliation, no per-broker variant needed (the
`executions.broker` column already discriminates).

## 11. Out of scope

- Auto-deploy this bridge to per-user paying customers (Phase 3 proper,
  gated on this demo passing).
- Multi-account R StocksTrader (one demo account is enough).
- Position-manager port (chandelier trail) — Phase 3.
- Encryption-at-rest for user RoboForex credentials — Phase 3.
- M5 timeframe support — out of scope for the 30-day demo.

## 12. References

- Master plan: `docs/plans/2026-05-06-demo-trading-master.md`
- Superseded MetaApi plan: `docs/plans/2026-05-06-demo-roboforex-mt5.md`
- Pilot plan: `docs/plans/2026-05-01-tradeclaw-pilot-binance-futures.md`
  (sections "Module layout" and "Phase 3")
- Sizing: `apps/web/lib/execution/sizing.ts`
- Existing broker client surface: `apps/web/lib/execution/binance-futures.ts`
- Signal table: `apps/web/migrations/003_signal_history.sql`
- Executions table: `apps/web/migrations/018_pilot_executions.sql`
  (`broker` is `VARCHAR(32)` — no schema change needed for r-stockstrader)
- R StocksTrader portal: <https://stockstrader.roboforex.com/trading?redirectURL=login>
- R StocksTrader API docs: in-dashboard "API" tab is authoritative.

## Update log

- 2026-05-08: Initial draft. Replaces MetaApi route per operator decision
  (existing R StocksTrader API key removes the MetaApi dependency).
