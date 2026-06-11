---
id: sl-1don
status: open
deps: []
links: []
created: 2026-06-10T23:21:30Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, core, validate]
---
# core: namespaced note blocks get bogus nl-ref-not-in-source warnings

satsuma-core/src/validate.ts:413 — isNoteContext tests mappingKey.startsWith("note:") but mappingKey is namespace-qualified first (crm::note:schema:foo), so the check fails for any note inside a namespace. The item is then treated as a mapping context and resolvable schema refs trigger the source-membership check against an undefined mapping. Repro: schema note { "derived from @other" } inside namespace crm -> spurious nl-ref-not-in-source naming mapping crm::note:schema:foo (also leaks the internal scope prefix into the user-facing message). Same note at global scope: no diagnostics. Fix point: test item.mapping, not mappingKey.

## Acceptance Criteria

Note-block refs inside namespaces produce no source-membership warnings; internal note: scope keys never appear in user-facing messages; namespaced + global note tests.

