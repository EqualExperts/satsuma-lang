---
id: sl-0tgo
status: open
deps: []
links: []
created: 2026-06-11T02:41:30Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-hunt, lsp]
---
# lsp: minor issues batch — stale unsaved content on close, dead hidden-rule checks, codelens overcount

Three small confirmed issues. (1) server.ts:147-152 — closing a modified-but-unsaved document leaves the unsaved content in the workspace index; nothing re-indexes from disk until a watcher event. (2) Dead checks on tree-sitter hidden rule names that never appear as node types: definition.ts:87 ("_source_entry") and completion.ts:69 ("_arrow_transform_body") — intended branches can never trigger. (3) codelens.ts findMappingsUsing counts reference sites deduped by line, not mappings — "used in N mapping(s)" overcounts when one mapping references a schema in both source and target.

## Acceptance Criteria

Close re-indexes from disk; hidden-rule checks replaced with reachable node types (with tests proving the branches fire); codelens counts distinct mappings.

