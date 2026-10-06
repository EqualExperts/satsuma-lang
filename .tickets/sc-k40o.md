---
id: sc-k40o
status: closed
deps: []
links: []
created: 2026-03-26T06:21:31Z
type: task
priority: 2
assignee: Thorben Louw
tags: [docs, conventions, feature-22]
---
# Validate docs/ convention guides satsuma examples

Extract all ```stm code blocks from docs/ convention guides (json, edi, cobol-copybook, governance, merge-strategy, reports-and-models, data-modelling, and all format-specific conventions), validate each with the CLI, and update to use current v2 syntax. Covers ~30 code blocks across ~17 files.

## Acceptance Criteria

- All ```stm blocks in docs/ convention guides extracted and validated with satsuma validate
- Blocks updated to use @ref syntax where appropriate
- Blocks use backtick-only labels (no single quotes)
- Zero parse errors across all blocks
- Convention guide narrative updated if syntax examples changed


## Notes

**2026-03-26T07:18:54Z**

Split into child tasks: sl-num7 (merge-strategy single quotes → backticks), sl-kood (schema format snippets), sl-m5yl (remove stale tree-sitter-ambiguities.md). Governance and data-modelling blocks are clean (warnings only from illustrative import snippets, acceptable). Reports-and-models blocks validated clean.

**2026-03-26T09:15:00Z**

Extended scope to cover ALL docs/ including tutorials (initially missed). Full audit found 31 failing blocks across 21 files. Fixed all — 98 total code blocks (77 stm + 21 satsuma) across docs/ now validate with zero errors. Tutorial fixes included: single quotes → backticks, `record name {}` → `name record {}`, `list name {}` → `name list_of record {}`, `[]` array syntax → `each`/`flatten` blocks, and partial snippets tagged as `satsuma` instead of `stm`.
