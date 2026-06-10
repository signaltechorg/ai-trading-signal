# Experiment Registry

Append-only ledger of research backtests (engine-makeover Phase 2). Every run
of `scripts/research/run-backtest-cli.ts` appends one line and writes its full
JSON next to this file. The JSON's `spec` + `results` are deterministic for a
given candle store state — re-running a spec overwrites its file.

Read this before testing a hypothesis: if the spec was already run, the answer
is here.

## Runs
- 2026-06-10 `BTCUSD-H1-2024-06-10-2026-06-09-live-crypto-classic_regime-aware_hmm-top3_vwap-ema-bb_full-risk-f4.json` — BTCUSD H1 2024-06-10→2026-06-09, live-atr14x2.5-tp2R, costs=crypto, 17497 bars: classic -11.1%/33%wr · regime-aware 0.6%/50%wr · hmm-top3 -0.2%/33%wr (window-capped) · vwap-ema-bb -0.8%/17%wr · full-risk -0.3%/33%wr (window-capped)
- 2026-06-10 `BTCUSD-H1-2024-06-10-2026-06-09-legacy-zero-classic_regime-aware_hmm-top3_vwap-ema-bb_full-risk-f4.json` — BTCUSD H1 2024-06-10→2026-06-09, legacy-fixed-2-1, costs=zero, 17497 bars: classic -4.3%/32%wr · regime-aware 1.3%/62%wr · hmm-top3 0.4%/67%wr (window-capped) · vwap-ema-bb -0.3%/17%wr · full-risk 0.3%/67%wr (window-capped)
