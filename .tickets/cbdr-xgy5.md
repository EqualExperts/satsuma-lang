---
id: cbdr-xgy5
status: closed
deps: []
links: [cbdr-joay]
created: 2026-08-03T16:11:14Z
type: task
priority: 1
assignee: Thorben Louw
parent: gcsc-qka8
tags: [feature-39, r6, cli, ci]
---
# cli: fix stale test typecheck and make it a real build gate

Feature 39 R6. satsuma-cli already has a test:typecheck script (tsc --project tsconfig.test.json) wired into its own npm pretest, but it currently fails: test/field-positions.test.ts passes a SyntaxNode from the CLI's own stale local dist/types ambient declaration to a core API expecting core's generated SatsumaCstType-narrowed SyntaxNode, so the two structurally-identical-looking types are not assignable. CI's satsuma-cli job runs npm run pretest so it already gate-checks this once fixed, but scripts/run-repo-checks.sh (the local pre-commit path) does not invoke it explicitly today.

## Design

Fix the stale fixtures in test/field-positions.test.ts (and any other test file hitting the same SyntaxNode mismatch) so they use core's exported node types instead of a locally re-declared/stale shape. Add an explicit npm run test:typecheck step for satsuma-cli to scripts/run-repo-checks.sh so it is a real local gate independent of npm's implicit pretest wiring. Document, near the CLI's test:typecheck script and in the relevant testing doc, which packages currently have a type-checked test suite (core, LSP, viz-backend, CLI) versus which are only baseline-linted, so the distinction between type-aware-linted and merely type-checked is not implied where untrue. Do not widen the test tsconfig module target (e.g. to support import.meta.dirname) as part of this fix -- that is an explicit tooling ticket if ever needed.

## Acceptance Criteria

tsc --project tooling/satsuma-cli/tsconfig.test.json passes with no errors; scripts/run-repo-checks.sh invokes the CLI test typecheck and it passes; a reintroduced stale/mismatched SyntaxNode usage in a CLI test file fails scripts/run-repo-checks.sh locally; documentation states plainly which packages' test sources are typechecked and which are only baseline-linted, without claiming type-aware lint coverage for test files that lack it; full satsuma-cli suite (npm test) and npm audit pass; the ticket receives a timestamped cause/fix note before closure.


## Notes

**2026-08-03T16:32:17Z**

Cause: satsuma-cli's own `prebuild` script built `@satsuma/core` but not `@satsuma/viz-backend`, a devDependency only `test/coverage-viz-parity.test.ts` imports (added when Feature 38's coverage-via-core work landed). `npm run test:typecheck` (and the full `pretest`/`npm test` chain) therefore failed with "Cannot find module '@satsuma/viz-backend/workspace-index'" whenever satsuma-cli was built/tested in isolation, without a prior monorepo-wide install. It was invisible in CI because the shared `install` job happens to build viz-backend first and cache it before the `satsuma-cli` job runs.
Fix: added a `build:viz-backend` script and included it in `prebuild`; added a regression test (test/prebuild-wiring.test.ts) that fails if a future test-only cross-package import isn't named in `prebuild`; added an explicit `satsuma-cli test:typecheck` step to `scripts/run-repo-checks.sh` (via `npm run pretest`, since test:typecheck's tsconfig resolves several test files' imports against `dist/`); documented typechecked-vs-baseline-linted test sources per package in ARCHITECTURE.md's Test Strategy table. CI's satsuma-cli job already ran `npm run pretest` explicitly (sl-851u), so no CI change was needed there. (commit immediately after c93b1130)
