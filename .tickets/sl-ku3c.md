---
id: sl-ku3c
status: open
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

