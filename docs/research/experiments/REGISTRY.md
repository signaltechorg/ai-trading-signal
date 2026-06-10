# Experiment Registry

Append-only ledger of research backtests (engine-makeover Phase 2). Every run
of `scripts/research/run-backtest-cli.ts` appends one line and writes its full
JSON next to this file. The JSON's `spec` + `results` are deterministic for a
given candle store state — re-running a spec overwrites its file.

Read this before testing a hypothesis: if the spec was already run, the answer
is here.

## Runs
