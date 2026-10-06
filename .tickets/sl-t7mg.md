---
id: sl-t7mg
status: closed
deps: [sl-2e4z]
links: []
created: 2026-03-23T09:55:40Z
type: task
priority: 3
assignee: Thorben Louw
tags: [feature-16, lsp, vscode]
---
# LSP Phase 2: navigation (go-to-definition, find-references, completions)

## Acceptance Criteria

Go-to-definition for schema/fragment/transform names. Find-references across workspace. Schema and field name completions. All workspace-aware via CLI integration.


## Notes

**2026-03-23T18:00:00Z**

Cause: Phase 2 required a workspace-level symbol index for cross-file navigation features.
Fix: Implemented 4 new server modules + server wiring + client update:

- `workspace-index.ts` — cross-file symbol table: definitions, references, imports, fields. Eager indexing on startup, incremental re-index on save. Namespace-aware resolution (qualified names, scoped fallback to global).
- `definition.ts` — go-to-definition: schema refs in source/target blocks, fragment spreads, import names, qualified names, block labels. Context detection via CST ancestor walk.
- `references.ts` — find-references: given cursor on any definition or reference, finds all reference locations across workspace. Respects includeDeclaration flag.
- `completion.ts` — context-aware completions: schema names in source/target, fragment/transform names for spreads, field names from source/target schemas in arrows, metadata vocabulary tokens (30), transform functions (28), block names in imports, namespace members.
- `server.ts` — workspace index lifecycle (scan on init, update on change/save/file-watch), capability registration, handler wiring for definition/references/completion.
- `extension.ts` — added file watcher synchronization for .stm files.
- 59 new tests (125 total LSP tests passing), full extension check passing.
