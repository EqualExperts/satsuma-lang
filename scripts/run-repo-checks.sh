#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

run_step() {
  local label="$1"
  shift
  printf '\n[%s]\n' "$label"
  "$@"
}

# Run commands in parallel, fail if any fail.
run_parallel() {
  local label="$1"
  shift
  printf '\n[%s]\n' "$label"
  local pids=()
  for cmd in "$@"; do
    eval "$cmd" &
    pids+=($!)
  done
  local failed=0
  for pid in "${pids[@]}"; do
    wait "$pid" || failed=1
  done
  if [ "$failed" -ne 0 ]; then
    echo "FAIL: $label" >&2
    exit 1
  fi
}

cd "$ROOT_DIR"

# Every package's test output below is teed into this directory as it runs,
# so the "generate test-stats.json" step at the end can read the real counts
# straight out of a check that already ran — no second test run just to
# source a number for test-stats.json. Removed on exit so a failed hook run
# never leaves a stale log around to be misread by a later invocation.
STATS_LOG_DIR="$(mktemp -d)"
trap 'rm -rf "$STATS_LOG_DIR"' EXIT

# Verify Python lint tools are available before running any checks.
# Install with: pip install yamllint ruff
for tool in yamllint ruff; do
  if ! command -v "$tool" &>/dev/null; then
    echo "ERROR: '$tool' not found. Install it with: pip install $tool" >&2
    exit 1
  fi
done

run_step "repo lint" npm run lint
run_step "release tooling tests" npm run test:release

# Hoisting can satisfy a package's declared range with the wrong version and say
# nothing: npm hoisted katex's commander@8 to the root and left satsuma-cli's
# ^15.0.0 unsatisfied, and the CLI ran anyway because the two APIs happened to
# overlap (feature 42, R2). `npm ls` is the only thing that reports it, so make
# an invalid tree a failed check rather than a silent mis-resolution.
run_step "workspace dependency tree is valid" npm run check:deps

# The scenario generator runs first and alone: core's property suites depend on
# it, so a broken generator would otherwise surface as a wall of unexplained
# property failures rather than as its own named failure.
run_step "scenario generator tests" npm --prefix tooling/satsuma-scenario-gen test

# satsuma-viz joins these (sl-hi0z): CI has always run it via the tooling-modules
# matrix, but the local hook did not, so the viz's edge-completeness properties —
# the ones defending against a mapping that silently renders no lines at all —
# would only have failed after a push.
run_parallel "satsuma-core + satsuma-viz-model + satsuma-viz tests" \
  "npm --prefix tooling/satsuma-core test 2>&1 | tee '$STATS_LOG_DIR/satsuma-core.log'" \
  "npm --prefix tooling/satsuma-viz-model test 2>&1 | tee '$STATS_LOG_DIR/satsuma-viz-model.log'" \
  "npm --prefix tooling/satsuma-viz test 2>&1 | tee '$STATS_LOG_DIR/satsuma-viz.log'"

# `npm --prefix tooling/satsuma-cli test` below already runs test:typecheck via
# npm's implicit pretest hook, but make it an explicit, separately labelled
# step (matching R2/sl-851u) rather than relying on that hook alone (fixes P4).
# `pretest`, not a bare `test:typecheck`, because test:typecheck's tsconfig
# resolves several test files' imports against `dist/` (the built output),
# which only `pretest`'s build steps guarantee are present and current.
run_step "satsuma-cli test:typecheck" npm --prefix tooling/satsuma-cli run pretest
run_step "satsuma-cli tests" bash -c \
  "npm --prefix tooling/satsuma-cli test 2>&1 | tee '$STATS_LOG_DIR/satsuma-cli.log'"

# Cross-consumer parity sweeps (CLI vs viz-backend's model). Runs after the CLI
# step above, since it depends on satsuma-cli's built `dist/testing.js` export.
run_step "integration-tests tests" bash -c \
  "npm --prefix tooling/integration-tests test 2>&1 | tee '$STATS_LOG_DIR/integration-tests.log'"

# ADR-022: CLI accepts files, not directories. Check each example entry file.
run_step "satsuma fmt --check examples" bash -c '
  cli=tooling/satsuma-cli/dist/index.js
  fail=0
  for f in examples/*/pipeline.stm \
           examples/filter-flatten-governance/filter-flatten-governance.stm \
           examples/filter-flatten-governance/governance.stm \
           examples/namespaces/namespaces.stm \
           examples/namespaces/ns-platform.stm \
           examples/namespaces/ns-merging.stm \
           examples/metrics-platform/metrics.stm \
           examples/metrics-platform/metric_sources.stm \
           examples/multi-source/multi-source-hub.stm \
           examples/multi-source/multi-source-join.stm \
           examples/multi-source/multi-source-arrows.stm \
           examples/lib/common.stm \
           examples/lib/sfdc_fragments.stm \
           examples/lookups/finance.stm; do
    [ -f "$f" ] && node "$cli" fmt --check "$f" || fail=1
  done
  exit $fail
'

run_step "vscode-satsuma validate" npm --prefix tooling/vscode-satsuma run validate
run_parallel "vscode-satsuma tests + LSP" \
  "npm --prefix tooling/vscode-satsuma test 2>&1 | tee '$STATS_LOG_DIR/vscode-satsuma.log'" \
  "npm --prefix tooling/satsuma-lsp test 2>&1 | tee '$STATS_LOG_DIR/satsuma-lsp.log'"

run_step "generated CST contract is current" \
  npm --prefix tooling/tree-sitter-satsuma run check:cst-symbols
run_step "CST contract generator tests" \
  npm --prefix tooling/tree-sitter-satsuma run test:generator
run_step "tree-sitter generate" npm --prefix tooling/tree-sitter-satsuma run generate
# tree-sitter test --wasm requires the CLI to be compiled with the wasm feature.
# Gracefully skip if unavailable; JS integration tests cover the corpus via the
# WASM parser already built by the previous generate step.
_wasm_test_output="$(cd "$ROOT_DIR/tooling/tree-sitter-satsuma" && tree-sitter test --wasm 2>&1)" || _wasm_test_exit=$?
# Captured as-is, skip message or real "Total parses: N" summary alike — the
# stats generator below knows how to fall back on a skip (see
# resolveCorpusTestCountFromLog in generate-test-stats.mjs).
printf '%s\n' "$_wasm_test_output" >"$STATS_LOG_DIR/tree-sitter-satsuma.log"
if echo "$_wasm_test_output" | grep -q "does not include the wasm feature"; then
  printf '[tree-sitter corpus] SKIP — tree-sitter-cli built without wasm feature (JS tests cover corpus)\n'
elif [ "${_wasm_test_exit:-0}" -ne 0 ]; then
  printf '%s\n' "$_wasm_test_output"
  echo "FAIL: tree-sitter corpus (wasm)" >&2
  exit 1
else
  printf '[tree-sitter corpus (wasm)] OK\n'
  printf '%s\n' "$_wasm_test_output"
fi
run_parallel "Python tests (tree-sitter + excel skill)" \
  "python3 -m pytest '$ROOT_DIR/tooling/tree-sitter-satsuma/scripts/' -v" \
  "python3 -m pytest '$ROOT_DIR/skills/excel-to-satsuma/scripts/test_excel_tool.py' -v"

# Smoke tests call the live satsuma CLI against real fixture files.
# They require satsuma on PATH and the pytest-bdd package.
# Skip gracefully if satsuma is not installed; fail clearly if pytest-bdd is missing.
if command -v satsuma &>/dev/null; then
  if ! python3 -c "import pytest_bdd" 2>/dev/null; then
    echo "ERROR: pytest-bdd not found. Install it with: pip install -r smoke-tests/requirements.txt" >&2
    exit 1
  fi
  run_step "smoke tests (BDD)" \
    python3 -m pytest "$ROOT_DIR/smoke-tests/" -v --tb=short
else
  # Install from the packed tarball, not the package directory: the CLI's runtime
  # dependencies are hoisted to the workspace root, so only the tarball produced
  # by `npm run pack` carries a complete, self-contained closure (feature 42, R2).
  printf '\n[smoke tests] SKIP — satsuma not on PATH. Install it first: npm --prefix tooling/satsuma-cli run pack && npm install -g tooling/satsuma-cli/satsuma-cli.tgz\n'
fi

# Last step, and only reached once every check above has passed: refresh
# test-stats.json from the logs just captured (no second test run) and stage
# it so the regenerated file rides along in the commit being made — the same
# way a formatter's re-staged output would.
run_step "generate test-stats.json" node scripts/generate-test-stats.mjs --from-logs "$STATS_LOG_DIR"
git add test-stats.json
