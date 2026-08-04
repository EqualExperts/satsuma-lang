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

# The "generate test-stats.json" step at the end reads each package's test
# output out of a check that already ran, rather than running the suites a
# second time just to source a number. Turborepo captures that output itself,
# one file per task at tooling/<package>/.turbo/turbo-<task>.log, and replays it
# on a cache hit — so this directory is filled by copying those logs in under
# the names the generator expects (see collect_turbo_test_logs below) instead of
# by teeing every step as it runs. Removed on exit so a failed hook run never
# leaves a stale log around to be misread by a later invocation.
STATS_LOG_DIR="$(mktemp -d)"
trap 'rm -rf "$STATS_LOG_DIR"' EXIT

# scripts/generate-test-stats.mjs --from-logs expects <dir>/<package>.log, keyed
# on the package's directory name under tooling/. Turborepo's own per-task log
# is already exactly the output the generator parses, so this just renames.
# A missing log is not an error: the generator keeps the previously committed
# count for any package this run did not exercise, which is the correct answer
# for the packages test:all deliberately excludes.
collect_turbo_test_logs() {
  for log in "$ROOT_DIR"/tooling/*/.turbo/turbo-test.log; do
    [ -f "$log" ] || continue
    local package_dir
    package_dir="$(basename "$(dirname "$(dirname "$log")")")"
    cp -f "$log" "$STATS_LOG_DIR/$package_dir.log"
  done
}

# Verify Python lint tools are available before running any checks.
# Install with: pip install yamllint ruff
for tool in yamllint ruff; do
  if ! command -v "$tool" &>/dev/null; then
    echo "ERROR: '$tool' not found. Install it with: pip install $tool" >&2
    exit 1
  fi
done

run_step "repo lint" npx turbo run lint

# Every *.test.mjs under scripts/, which since R4 includes the suite asserting
# the workspace dependency graph Turborepo derives its build order from.
run_step "root script tests" npm run test:scripts

# Hoisting can satisfy a package's declared range with the wrong version and say
# nothing: npm hoisted katex's commander@8 to the root and left satsuma-cli's
# ^15.0.0 unsatisfied, and the CLI ran anyway because the two APIs happened to
# overlap (feature 42, R2). `npm ls` is the only thing that reports it, so make
# an invalid tree a failed check rather than a silent mis-resolution.
run_step "workspace dependency tree is valid" npm run check:deps

# Ahead of the build, and it has to stay ahead of it. This check regenerates
# satsuma-core's src/generated/cst-types.ts to a temporary path and compares it
# against the tracked copy — but `turbo run build` below runs the grammar's
# `generate`, which rewrites that tracked copy in place. Run after the build, the
# check compares a freshly written file against itself and can never fail.
run_step "generated CST contract is current" \
  npm --prefix tooling/tree-sitter-satsuma run check:cst-symbols

# One ordered build of the whole workspace, and the reason every step below can
# assume built output without rebuilding it. Before R4 each package's `prebuild`
# and `pretest` hooks rebuilt their siblings by hand, so this script inherited
# the build order implicitly — and paid for it repeatedly, since three packages
# each rebuilt @satsuma/core. Turborepo derives the order from the manifests and
# skips anything whose inputs are unchanged.
run_step "workspace build" npm run build:all

# The scenario generator runs first and alone: core's property suites depend on
# it, so a broken generator would otherwise surface as a wall of unexplained
# property failures rather than as its own named failure. It is in the sweep
# below too, where it will be a cache hit costing nothing.
run_step "scenario generator tests" npx turbo run test --filter=@satsuma/scenario-gen

# Every package's `test` and `test:typecheck`, in dependency order, in parallel,
# skipping any package whose inputs have not changed. This replaces six separate
# invocations that between them hand-managed the ordering (integration-tests
# after the CLI, because it imports the CLI's built dist/testing.js), the
# parallelism (two run_parallel groups), and the typecheck steps that npm's
# implicit `pretest` hook would otherwise have decided for us.
run_step "workspace tests" npm run test:all
collect_turbo_test_logs

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

# Not a turbo task: `validate` only re-parses this package's own manifest and
# TextMate grammar as JSON, needs nothing built, and reads nothing a content
# hash would help with. The extension's and the LSP's test suites both ran in
# the workspace sweep above.
run_step "vscode-satsuma validate" npm --prefix tooling/vscode-satsuma run validate

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
