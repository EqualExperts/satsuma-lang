#!/usr/bin/env bash
# watch-and-test.sh — test runner triggered by a sentinel file.
#
# Usage: ./watch-and-test.sh &
#
# When .run-tests is created (e.g. by `touch .run-tests`), this script:
#   1. Kills any stale server on ports 3333 (dev server) and 3334 (static
#      playground file server)
#   2. Runs `npm test`, whose pretest hook rebuilds the harness and viz bundles
#   3. Writes build and Playwright output to .playwright-results.txt
#   4. Removes .run-tests so the trigger is reset
#
# Claude touches .run-tests to request a test run; results appear in
# .playwright-results.txt for Claude to read.

TRIGGER=".run-tests"
RESULTS=".playwright-results.txt"
DIR="$(cd "$(dirname "$0")" && pwd)"

# Preserve npm's failure status across tee so a failed pretest build is reported
# as a failed sentinel run rather than looking like a successful stale-bundle run.
set -o pipefail

echo "[watch-and-test] watching for $TRIGGER in $DIR"

while true; do
  if [ -f "$DIR/$TRIGGER" ]; then
    echo "[watch-and-test] trigger detected — running tests"
    rm -f "$DIR/$TRIGGER"
    kill "$(lsof -ti:3333)" 2>/dev/null || true
    kill "$(lsof -ti:3334)" 2>/dev/null || true
    sleep 1
    cd "$DIR"
    if npm test -- --timeout=60000 2>&1 | tee "$RESULTS"; then
      echo "[watch-and-test] run passed" | tee -a "$RESULTS"
    else
      STATUS=$?
      echo "[watch-and-test] run failed with exit code $STATUS" | tee -a "$RESULTS"
    fi
    echo "[watch-and-test] done — results in $RESULTS"
  fi
  sleep 1
done
