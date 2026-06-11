---
id: sl-0tgo
status: closed
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


## Notes

**2026-06-11T07:00:02Z**

Cause: (1) onDidClose kept whatever buffer content was last indexed, including unsaved edits the user discarded; (2) definition.ts and completion.ts tested for "_source_entry" / "_arrow_transform_body", hidden grammar rules that inline away and never appear as node types; (3) findMappingsUsing deduped reference sites by uri:line, double-counting mappings that name a schema in both source and target blocks.
Fix: (1) close now re-indexes from disk via reindexFromDisk (removing files with no on-disk presence); (2) dead checks removed/replaced — target detection uses the real direct parent, and empty arrow bodies (parsed as declaration-less nested_arrow) get pipe completions; (3) source/target references now carry their containing mapping's qualified name and findMappingsUsing dedups on it. Tests added for empty-arrow-body completions and source+target single-mapping counting.
