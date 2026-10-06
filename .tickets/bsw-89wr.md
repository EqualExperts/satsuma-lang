---
id: bsw-89wr
status: open
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-sweep-2026-10, lsp]
---
# lsp: go-to-definition, references and hover return nothing on relative .field arrow paths

`extractPathFieldName` (`tooling/satsuma-lsp/src/definition.ts:523-551`) takes `".x".split(".")[0]`, which is `""`, so `tryContext` returns null. A sweep over `examples/` found 77 of 77 `relative_field_path` sites return null, e.g. `examples/top-level-dotted-each/pipeline.stm:26` `.party_role`. The escape comment added in caf9dd77 says the leading dot "is already ignored"; it is not. Related: `` ^.^.`tr ref` `` returns null because the backtick segment keeps its backticks. Pre-existing.

## Acceptance Criteria

- Definition, references and hover resolve relative paths inside each/flatten to the container field, including backtick segments; the corrected comment matches the code.
- Test over at least one example file asserting non-null definition on every relative path site.
