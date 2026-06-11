---
id: sl-ogd5
status: open
deps: []
links: []
created: 2026-06-11T02:41:30Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-hunt, lsp]
---
# lsp: position-based handlers fail at end-of-identifier cursor

definition.ts:22, hover.ts:22, references.ts:22, completion.ts:25, rename.ts:25/62, action-context.ts:21 all call descendantForPosition with the raw LSP position; tree-sitter ranges are half-open so a cursor immediately after the last character of an identifier resolves to the following node. Proven: go-to-definition works mid-word, returns null at word end. Standard LSP servers retry at character-1; this one does not.

## Acceptance Criteria

All position handlers resolve the identifier when the cursor sits at its end; shared position-adjust helper with tests.

