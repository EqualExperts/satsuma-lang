---
id: sl-gsxu
status: open
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

