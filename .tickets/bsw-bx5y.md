---
id: bsw-bx5y
status: open
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-sweep-2026-10, lsp, semantic-tokens]
---
# lsp: overlapping semantic tokens on every dotted or relative path

`highlights.scm` captures `(src_path) @variable` and `(tgt_path) @variable` (lines 94-95) as well as the inner identifiers, and the dedupe in `tooling/satsuma-lsp/src/semantic-tokens.ts:146-156` drops only identical spans. Across 16 example files there are 194 overlaps, e.g. `ADDRESS.STREET` yields `[col 2, len 14]` and `[col 2, len 7]`. The server never checks the client's `overlappingTokenSupport`, and VS Code does not declare it.

## Acceptance Criteria

- semanticTokens/full emits no overlapping tokens for any example file (test asserts it).
