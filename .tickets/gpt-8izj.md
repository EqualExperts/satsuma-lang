---
id: gpt-8izj
status: open
deps: [gpt-21jp]
links: []
created: 2026-08-06T13:44:45Z
type: task
priority: 1
assignee: Thorben Louw
parent: gpt-uazn
tags: [feature-46, testing, lsp]
---
# lsp: rename round-trip over generated workspaces (R4)

Rename is the one LSP feature that writes. It is currently proved by fixtures only, and a rename that misses a cross-file edit corrupts a workspace silently — the result still parses.

## Design

For every entity in a generated workspace, rename it to a name the workspace does not use, apply the WorkspaceEdit, reparse, and assert: the workspace still validates clean; the declared edge set is identical modulo the rename; no occurrence of the old name survives; no occurrence of an unrelated entity's name changed. The fresh-name choice belongs to the property, not to the arbitrary — renaming onto an existing name is a legitimate collision the editor may reject, and is a separate case rather than part of the round-trip. Reuses R3's adapter.

## Acceptance Criteria

Mutation check: dropping the cross-file edits from the rename WorkspaceEdit makes the round-trip fail with either a surviving old-name occurrence or a broken edge. Run and recorded in the closing note. The collision case is either covered by its own assertion or explicitly deferred with a reason.

