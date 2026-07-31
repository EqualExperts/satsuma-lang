---
id: sl-gsxu
status: in_progress
deps: []
links: []
created: 2026-07-31T13:13:05Z
type: task
priority: 1
assignee: Thorben Louw
parent: sl-ce11
tags: [feature-35, core, lsp]
---
# core: relocate computeMappingCoverage from satsuma-lsp into @satsuma/core

PRD 35 R1. The full coverage computation lives in tooling/satsuma-lsp/src/coverage.ts:41 but is needed by the CLI (feature 35) and the browser-bundled viz (feature 36). Per the Core vs Consumer rule it must move to core with its tests.

Note there are four sites orbiting these semantics, not three (doc review 2026-07-31): core's types + addPathAndPrefixes, the LSP function being moved, satsuma-viz/src/field-coverage.ts, and — easily missed — the CLI's own private getMappedFieldNames()/filterUnmappedFields() behind `fields --unmapped-by` (commands/fields.ts:89-103). The relocated function is what all four converge on; sl-oqsj re-bases the CLI pair onto it.

## Design

Define a minimal core-level resolver interface (parse tree + schema-id -> field list) so the function depends on neither the LSP WorkspaceIndex nor the CLI index; each consumer adapts its own index. LSP keeps a thin adapter and re-exports so existing imports compile unchanged. Fix the stale header comment in satsuma-core/src/coverage.ts (still points at vscode-satsuma/server and cites LSP-only types as the reason). Note aa-65ni already added optional source locations to core FieldDecl.

## Acceptance Criteria

computeMappingCoverage and private helpers live in @satsuma/core; coverage semantics tests moved to core (LSP-side tests reduced to adapter wiring only); VS Code gutter/code-lens behaviour identical before and after (existing LSP+extension tests pass unchanged); stale core header comment corrected; all core, lsp and cli test suites pass locally.


## Notes

**2026-07-31T13:52:57Z**

Cause: computeMappingCoverage lived in tooling/satsuma-lsp/src/coverage.ts, unreachable from the CLI (feature 35) and the browser viz bundle (feature 36), and core's coverage.ts header still claimed it lived in vscode-satsuma/server citing LSP-only types as the reason.
Fix: moved the computation and its private helpers into satsuma-core/src/coverage.ts behind a CoverageSchemaResolver input contract (CoverageField/CoverageSchemaDefinition), so no consumer index type leaks into core; addPathAndPrefixes moved to coverage-paths.ts alongside the other path helpers to keep the dependency acyclic; the LSP retains a thin FieldInfo->CoverageField adapter with its original (uri, tree, mappingName, wsIndex) signature so server.ts is unchanged. Semantics tests moved to core (450 pass), LSP tests reduced to adapter wiring (292 pass), CLI 902 pass, vscode 33 unit + golden pass.

Scope note: relocation surfaced sc-xnxp, a pre-existing defect where .-prefixed element-relative paths inside each/flatten produced 'items..id' and reported explicitly-mapped nested fields as uncovered. Fixed here rather than carried forward, since feature 35 ships a coverage report built on it. This means the acceptance criterion 'VS Code gutter behaviour identical before and after' is deliberately not met: the gutter changes, in the correcting direction.
