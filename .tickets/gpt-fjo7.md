---
id: gpt-fjo7
status: open
deps: []
links: []
created: 2026-08-06T18:45:19Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [lsp, rename, nl-ref]
---
# lsp: rename leaves NL @ref mentions of the renamed schema dangling

Renaming a schema through the LSP rewrites its declaration, its `source`/`target` list entries, its spreads, its imports and its qualified arrow paths — but not the `@ref` mentions of it inside NL transform bodies. The result still parses, so nothing in the editor objects, but the workspace is broken: `satsuma validate` reports `unresolved-nl-ref` on it.

Minimal reproduction, found by Feature 46 R4's rename round-trip property (gpt-8izj) over `nlRefWorkspaceArbitrary`:

    schema s0 { field_0 STRING  field_1 STRING }
    schema s1 { field_0 STRING  field_1 STRING }
    mapping m0 {
      source { s0 }
      target { s1 }
      field_0 -> field_0 { "Normalise. Derived from @s0.field_1." }
    }

Rename `s0` to `renamed_s0` from its declaration. Everything is rewritten except the transform body, which still reads `@s0.field_1`. The CLI then reports:

    entry.stm:14:49 warning [unresolved-nl-ref] NL reference `s0.field_1` in mapping 'm0' does not resolve to any known identifier

The mechanism: `computeRename` collects edits from `findReferences(index, resolveReferenceKey(...))`, and the workspace index files an NL `@ref` under the **field path** it names (`s0.field_1`, context `nl`), not under the schema `s0`. So a query for the schema's references never sees it. The same is true of `where-used` and of find-references, but there the consequence is a missing answer; here it is a corrupted workspace.

Note the editor does not even show the damage afterwards, because the LSP reports no `unresolved-nl-ref` at all — that is its own ticket.

## Acceptance Criteria

Renaming a schema rewrites the schema segment of every NL @ref that names one of its fields, in every file. The round-trip property in tooling/satsuma-lsp/test/generated-rename-roundtrip.test.js stops excluding entities an NL @ref mentions, and the pinned test recording today's behaviour is removed. Renaming a schema whose fields no @ref mentions is unaffected. Decide explicitly whether a @ref naming a *field* that is itself renamed is in scope, or a separate ticket.

