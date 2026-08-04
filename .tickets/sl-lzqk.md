---
id: sl-lzqk
status: open
deps: [sl-k7po]
links: []
created: 2026-08-04T09:54:30Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-unr3
---
# Wire test-stats.json generation into the pre-commit hook

scripts/run-repo-checks.sh already runs every package's tests once per commit. Tee the output of each relevant step (satsuma-core/viz-model/viz parallel block, satsuma-cli, vscode-satsuma+lsp parallel block, tree-sitter wasm corpus block which already captures its output in a shell variable) into per-package log files under a scratch dir, in addition to the existing terminal output -- 'cmd 2>&1 | tee $LOG_DIR/name.log', relying on the script's existing 'set -euo pipefail' so tee doesn't mask failures. As the final step (only after every check has passed), run 'node scripts/generate-test-stats.mjs --from-logs $LOG_DIR' and 'git add test-stats.json' so the regenerated file rides along in the commit that's about to be created, matching how a formatter's re-staged output would work in a pre-commit hook. Do not change what run-repo-checks.sh tests or its pass/fail semantics -- only add log capture and the final generation+stage step.

## Acceptance Criteria

Committing a change on a machine with the hook installed regenerates test-stats.json (if any count actually changed) and includes it in the same commit automatically, with no user action needed. Re-running the hook with no code changes produces a byte-identical test-stats.json (no spurious diff/re-stage). Measured wall-clock time of the hook does not meaningfully increase (log capture via tee, no test suite is run twice).

