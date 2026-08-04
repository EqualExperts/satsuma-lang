---
id: sl-if0c
status: closed
deps: [sl-k7po]
links: []
created: 2026-08-04T09:54:30Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-unr3
---
# Point README.md, AGENTS.md, and PROJECT-OVERVIEW.md at test-stats.json instead of hardcoding counts

Three living docs hardcode the same kind of numbers and will drift the same way: README.md's Current Status bullet ('a tree-sitter parser (318 corpus tests...)'), AGENTS.md's Repository Layout bullets (satsuma-core '679 tests', satsuma-cli '1031 tests', satsuma-lsp '300 tests', satsuma-viz-model '6 tests', satsuma-viz-backend '182 tests', satsuma-viz '128 tests', satsuma-viz-harness '99 tests' -- leave this one as prose, it's the deliberately-manual Playwright package, not generated -- and vscode-satsuma '34 tests', plus the tree-sitter-satsuma bullet's '318 corpus tests'), and docs/product-owner/PROJECT-OVERVIEW.md's 'Tree-sitter parser (318 corpus tests)' line. Drop the specific numbers from each bullet's prose and add one link to test-stats.json per doc (near the top of README's Current Status section and AGENTS.md's Repository Layout section) rather than restating every number inline. tooling/vscode-satsuma/README.md's '296 tests' code-comment and site/examples.njk's example count were found during research but are out of scope for this ticket (flagged as follow-ups, not fixed here).

## Acceptance Criteria

README.md, AGENTS.md (this repo's CLAUDE.md), and docs/product-owner/PROJECT-OVERVIEW.md contain no hardcoded parser/CLI/LSP/per-package test count and no hardcoded CLI command count; each links to test-stats.json instead. npm run lint:md passes.


## Notes

**2026-08-04T10:42:16Z**

## Notes

**2026-08-04T12:00:00Z**

Cause: README.md, AGENTS.md, and docs/product-owner/PROJECT-OVERVIEW.md each hand-typed the same parser/CLI/per-package test counts, which drifted independently of the real numbers and of each other.
Fix: Removed the hardcoded counts from those three docs' bullets and added one link per doc to the generated test-stats.json (satsuma-viz-harness's manual-Playwright count left untouched, as it is not covered by the generator). (commit immediately after 20e63bb9)
