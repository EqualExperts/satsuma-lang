---
id: bsw-gfbl
status: open
deps: []
links: [bsw-r1wl]
created: 2026-10-06T20:07:50Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-sweep-2026-10, lsp, cli, imports]
---
# validate/lsp: no diagnostic when an import names a symbol the target file no longer declares

With `a.stm` containing `import { x } from "b.stm"`, renaming `schema x` to `y` in b.stm leaves a.stm's import naming a symbol b.stm does not declare. Nothing reports it, in the CLI or the editor. bsw-r1wl made the LSP refresh a.stm's diagnostics when b.stm changes, so the gap is now the missing rule, not a stale result.

## Acceptance Criteria

- An import naming a symbol the imported file does not declare is reported (likely `undefined-ref` or a dedicated rule), by both `satsuma validate` and the LSP, with the same message.
- Tests for a renamed symbol and a symbol that never existed; the LSP test edits b.stm and checks a.stm's diagnostics update.
