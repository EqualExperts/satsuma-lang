---
id: bsw-btjl
status: open
deps: []
links: [bsw-0twy, bsw-u11n]
created: 2026-10-06T17:22:07Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-sweep-2026-10, lsp, fmt]
---
# lsp: document formatting runs on trees with parse errors and deletes the erroneous text

`connection.onDocumentFormatting` (tooling/satsuma-lsp/src/server.ts) passes the
cached tree straight to `computeFormatting`, which calls core `format()` with no
parse-error guard. Core `format()` drops ERROR nodes, so formatting a broken
buffer deletes or rewrites the broken text. The CLI already refuses (`fmt`
skips a file with parse errors); the LSP does not.

Found while fixing bsw-0twy, which turned spaced paths into parse errors. With
the current formatter:

- `^. a -> b` inside an `each` formats to `-> b` (the source path is deleted).
- `^. ^.a -> b` formats to `^.a -> b`, which resolves one level lower than the
  author wrote.
- `a. b -> c` formats to `a -> c`.

With format-on-save in VS Code this silently edits the file.

## Acceptance Criteria

- Document formatting returns no edits when the tree has ERROR or MISSING
  nodes (use core `collectParseErrors`, or `tree.rootNode.hasError`).
- An LSP test formats a buffer containing `^. a -> b` and asserts no edits.
- Consider whether the guard belongs in core `format()` itself (a contract that
  every consumer then inherits) rather than in each consumer.
