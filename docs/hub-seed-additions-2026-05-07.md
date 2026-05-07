# Market Data Hub — Seed Additions Request (2026-05-07)

**Request from:** TradeClaw consumer side (already wired & deployed)
**Hub repo:** `tg-trading-apps/packages/market-data-hub`
**Hub seed file:** `src/index.ts`
**Hub adapter:** `src/lib/twelvedata.ts` (new symbols all flow TD-only — RoboForex
doesn't expose stocks beyond the existing 7, and these are not CFD instruments)

## Why this list

Audit of the live `/api/quotes` response on 2026-05-07 found 79 symbols served.
TradeClaw's marketing/dashboard surface needs ~25 additions for category
completeness: foundational FX context indicators, semiconductors cluster,
financials, commodities completeness, Asia-Pac index gap.

All consumer-side mappings are **already deployed** in `apps/web/lib/hooks/
use-hero-prices.ts` and `apps/web/app/lib/data-providers/market-data-hub.ts`.
They currently return `null → "—"` until the hub seed serves the symbols.
After the hub adds them, no consumer code change is needed — they auto-resolve.

## Rate-limit budget

- TD Grow plan: 377 req/min shared
- Current TD usage (post-PR #43): ~120 req/min
- This request adds 25 TD-only symbols
- At 60s refresh: +25/min → ~145/min (39% of cap)
- At 30s refresh: +50/min → ~170/min (45% of cap)
- At 15s refresh: +100/min → ~220/min (58% of cap)

All scenarios stay safely under the 377/min cap.

## Symbols to add (Twelve Data identifiers)

### CRITICAL — foundational indicators (priority 1)

| Hub symbol | TD identifier | Asset type | Why |
|---|---|---|---|
| `DXY` | `DXY` | Forex index | US Dollar Index — foundational FX context every trader watches |
| `VIX` | `VIX` | Volatility index | Risk-on/risk-off proxy; used in HMM regime classification |

### HIGH — semiconductors (priority 2)

| Hub symbol | TD identifier | Asset type | Why |
|---|---|---|---|
| `AMD` | `AMD` | US stock (NASDAQ) | Top semi name, retail-heavy |
| `MU` | `MU` | US stock (NASDAQ) | Memory leader, earnings catalyst |
| `AVGO` | `AVGO` | US stock (NASDAQ) | AI infrastructure proxy |
| `INTC` | `INTC` | US stock (NASDAQ) | Legacy semi, high volume |
| `TSM` | `TSM` | US stock (NYSE ADR) | Foundry leader |
| `QCOM` | `QCOM` | US stock (NASDAQ) | Mobile/automotive semi |

### HIGH — commodities completeness (priority 2)

| Hub symbol | TD identifier | Asset type | Why |
|---|---|---|---|
| `NG/USD` | `NG=F` or `NG/USD` | Commodity (natural gas) | Forex traders cross-trade vs WTI/Brent |
| `HG/USD` | `HG=F` or `XCU/USD` | Commodity (copper) | Industrial-cycle bellwether |
| `XPT/USD` | `XPT/USD` | Metals (platinum) | Metals completeness with XAU/XAG |
| `XPD/USD` | `XPD/USD` | Metals (palladium) | Metals completeness |

### MEDIUM — financials (priority 3)

| Hub symbol | TD identifier | Asset type | Why |
|---|---|---|---|
| `JPM` | `JPM` | US stock (NYSE) | Banking sector — Fed-cycle catalyst |
| `GS` | `GS` | US stock (NYSE) | Investment banking |
| `BAC` | `BAC` | US stock (NYSE) | Retail banking, high volume |

### MEDIUM — consumer / crypto-correlated (priority 3)

| Hub symbol | TD identifier | Asset type | Why |
|---|---|---|---|
| `NFLX` | `NFLX` | US stock (NASDAQ) | Earnings-cycle volume |
| `DIS` | `DIS` | US stock (NYSE) | Consumer/media |
| `COIN` | `COIN` | US stock (NASDAQ) | Coinbase — proxy for crypto correlation |

### MEDIUM — geographic index gaps (priority 3)

| Hub symbol | TD identifier | Asset type | Why |
|---|---|---|---|
| `HSI` | `HSI` | Index | Hang Seng — Asia-Pac coverage gap (UK100/GER40 covered but no HK) |
| `RUT2000` | `RUT` or `IWM` | Index | Russell 2000 — US small-cap exposure |

## Total addition

**21 symbols** added to the seed. All TD-only (no RoboForex equivalent).

## Consumer-side verification (after hub deploys)

Run from any networked host:

```bash
curl -s https://market-data-hub.up.railway.app/api/quotes \
  | grep -oE '"symbol":"[^"]+"' | sort -u | wc -l
# Should be 79 + 21 = 100 symbols
```

Then on TradeClaw side (after `MARKET_DATA_HUB_URL` env propagates to Vercel):

```bash
curl -s https://tradeclaw.win/api/prices \
  | grep -oE '"(DXY|VIX|AMD|MU|JPM|HSI|RUT2000)":\{[^}]+\}'
# Should print 7 lines, all with `"source":"market-data-hub"`
```

## Out of scope (logged as future asks)

- **CSI 300, Nifty 50** — China/India index coverage. Twelve Data has partial
  but quality varies; revisit when retail demand surfaces.
- **Soft commodities** (Coffee, Wheat, Corn, Sugar) — niche audience for now.
- **More single-stock requests** (TSMC ADR variants, individual European
  blue-chips, Japanese Topix names) — defer until US stock cluster is shipped
  and we see which categories generate the most consumer-side queries.

## Roll-out checklist

- [ ] Add symbols to `src/index.ts` seed (additive, won't touch existing rows)
- [ ] Add per-symbol asset_type tag (`stock` / `forex` / `index` / `metal` /
      `commodity`) so health endpoint surfaces lane distribution
- [ ] Verify TD lane counter doesn't exceed 250/min after 1h soak
- [ ] Smoke test: `curl /api/quotes` and confirm 100 symbols, no 5xx errors
      from any new symbol's TD upstream
- [ ] Tag release with hub PR number, link back to this spec
