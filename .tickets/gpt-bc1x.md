---
id: gpt-bc1x
status: open
deps: []
links: []
created: 2026-08-06T15:21:32Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [lsp, rename]
---
# lsp: rename from a downstream file leaves upstream imports naming the old symbol

Every references/definition/rename request goes through `scopeIndex(uri)` = `createScopedIndex(wsIndex, getImportReachableUris(uri, wsIndex))` (tooling/satsuma-lsp/src/server.ts:536-538, applied on the rename path at :347-359). Import reachability points one way: from an importing file to what it imports. So a rename driven from a DECLARATION in a downstream file cannot see the upstream files that import that declaration, and their `import { name }` and `target { name }` occurrences are left untouched.

Measured while building Feature 46 R3 (gpt-21jp): over a three-file generated chain, find-references from `schema s1`'s declaration in part1.stm returns 1 of its 3 declared usage sites once the scoping is applied — the `target { s1 }` and `import { s1 }` in entry.stm are both dropped. Renaming from that position therefore produces a workspace that no longer validates: the upstream import names a schema nothing declares.

The scoping itself is deliberate — sl-rw3e exists because the unscoped folder-wide index reported false duplicates between unrelated entry-point files (ADR-022). The question this ticket asks is whether RENAME can use the same scope as diagnostics. A rename is inherently a whole-workspace edit, so the reachability direction that is right for 'which duplicates should I report' looks wrong for 'which occurrences must I rewrite'.

The scoped behaviour is now pinned as a falsifiable property in tooling/satsuma-lsp/test/generated-reference-duality.test.js (the import-scope case over multiFileWorkspaceArbitrary), so a fix will turn that pin red — which is the point.

## Acceptance Criteria

Decide and document whether rename uses import-reachable scope or the whole folder, and why the answer may differ from the diagnostics scope ADR-022 fixed. If it becomes whole-folder for rename, ADR-022's reasoning is revisited explicitly rather than by omission. R4's rename round-trip property (gpt-8izj) states which index it asks and holds against the real server's behaviour, not against a wider index the server never uses.

