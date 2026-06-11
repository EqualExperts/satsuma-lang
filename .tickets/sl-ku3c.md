---
id: sl-ku3c
status: closed
deps: []
links: [sl-vmqv]
created: 2026-06-11T02:41:29Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, lsp]
---
# lsp: trees cache keyed by raw client URI while index keys are canonical (Windows breakage)

The sl-akz6/gh-274 fix canonicalized the workspace index but not the tree cache. satsuma-lsp/src/server.ts:50 (trees), used at :172, :199, :354-359 keys on the raw client URI. canonicalizeFileUri("file:///c%3A/proj/x.stm") -> file:///c:/proj/x.stm differs from raw, so on Windows: vizFullLineage trees.get(canonicalUri) misses open files, on-save merged diagnostics for sibling files never publish, and trees.has(change.uri) watched-file skip never matches. Invisible on macOS/Linux where URIs round-trip unchanged. Related: sl-vmqv (Windows CI job).

## Acceptance Criteria

trees keyed by canonical URI everywhere; unit test with percent-encoded drive-letter URI; linked Windows CI ticket covers e2e.


## Notes

**2026-06-11T13:14:50Z**

Cause: server.ts trees and validateDiagCache were keyed by the raw client URI while the workspace index canonicalizes keys (sl-akz6) — on Windows the didOpen spelling (file:///c%3A/...) and the canonical spelling (file:///c:/...) addressed different entries, so canonical lookups missed open files.
Fix: new CanonicalUriMap (src/canonical-uri-map.ts) canonicalizes every key on get/set/has/delete; trees and validateDiagCache use it, and runValidate canonicalizes its result URIs. Unit tests cover percent-encoded drive-letter spellings; e2e Windows coverage tracked by linked sl-vmqv.
