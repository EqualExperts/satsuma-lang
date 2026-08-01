---
id: sc-xnxp
status: closed
deps: []
links: [3cdd-yavi]
created: 2026-07-31T13:51:09Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [feature-35, core, coverage]
---
# coverage: element-relative paths inside each/flatten blocks report mapped fields as uncovered

computeMappingCoverage qualified element-relative arrow paths without stripping their leading dot. Inside `each items -> lines { .id -> .item_id }` the grammar parses `.id` as a relative_field_path whose node text includes the dot, so qualify() produced "items..id". addPathAndPrefixes then split that into an empty segment, registering "items." and "items..id" but never "items.id" — the path the declared field actually has. Every nested source and target field inside an each or flatten block therefore reported mapped=false despite an explicit arrow covering it.

This is the spec's canonical syntax (SATSUMA-V2-SPEC.md 4.6 writes `.SKU -> sku`), so the defect hit real workspaces, not an edge case. Discovered while relocating the computation into core for feature 35 (sl-gsxu): shipping `satsuma coverage` on top of it would have reported false spec gaps for exactly the nested fields reviewers ask about.

Pre-existing in tooling/satsuma-lsp/src/coverage.ts, so the VS Code coverage gutter has been marking mapped nested fields as unmapped since each/flatten support landed. Fixing it means sl-gsxu's "gutter behaviour byte-identical before and after" criterion is intentionally not met — the gutter changes, in the correcting direction.

## Acceptance Criteria

pathText() strips a single leading dot as well as backtick quoting, with the rule and its rationale documented at the call site; core coverage tests assert nested each and flatten fields written with .-prefixed relative paths report mapped=true and their unwritten siblings report mapped=false; LSP and vscode suites pass.


## Notes

**2026-07-31T13:53:25Z**

Cause: pathText() in the coverage walker stripped backtick quoting but not the leading dot of a relative_field_path, so qualifying '.id' under 'each items -> lines' produced 'items..id'. addPathAndPrefixes split that on '.', registering 'items.' and 'items..id' but never 'items.id' — the path the declared field carries.
Fix: pathText() now strips one leading dot as well, with the rule and rationale documented at the definition; regression tests in satsuma-core/test/coverage.test.js lock both the each and flatten arms using the spec's .-prefixed syntax (commit 1024955).
