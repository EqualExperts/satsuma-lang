---
id: sl-ogd5
status: closed
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


## Notes

**2026-06-11T06:24:47Z**

Cause: all seven position-based handlers (definition, hover, references, completion, rename x2, action-context) passed the raw LSP position to descendantForPosition; tree-sitter ranges are half-open, so a cursor immediately after an identifier's last character resolved to the following node and every feature failed at word end.
Fix: added nodeAtPosition to satsuma-lsp parser-utils — returns the node at the raw position when it is a word token, otherwise retries one column left and prefers a word token there (whitespace-separated and punctuation cursors unaffected). All seven call sites now resolve through it. Unit tests pin the resolver's boundary behaviour; definition and hover gain end-of-identifier regression cases.
