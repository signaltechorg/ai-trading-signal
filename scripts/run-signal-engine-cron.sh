#!/usr/bin/env bash
set -o pipefail
# Resolve pending signal outcomes via the TypeScript signal-history module.
# Run hourly via cron for self-hosted instances:
#   0 * * * * /path/to/ai-trading-signal/scripts/run-signal-engine-cron.sh

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/scripts/signal-errors.log"
STATE="$ROOT/scripts/.signal-engine-failure-count"
TMP=$(mktemp)

cd "$ROOT" || exit 1

if npm run resolve:outcomes >"$TMP" 2>&1; then
  printf "0" > "$STATE"
  TZ=Asia/Kuala_Lumpur date +"%Y-%m-%dT%H:%M:%S%z" > "$ROOT/scripts/.signal-engine-last-success"
  rm -f "$TMP"
  exit 0
fi

status=$?
count=$(cat "$STATE" 2>/dev/null || printf "0")
case "$count" in
  ''|*[!0-9]*) count=0 ;;
esac
count=$((count + 1))
printf "%s" "$count" > "$STATE"
ts=$(TZ=Asia/Kuala_Lumpur date +"%Y-%m-%dT%H:%M:%S%z")
{
  printf "[%s] FAIL #%s — resolve:outcomes exited %s\n" "$ts" "$count" "$status"
  cat "$TMP"
  printf "\n"
} >> "$LOG"
cat "$TMP"
rm -f "$TMP"
exit "$status"
