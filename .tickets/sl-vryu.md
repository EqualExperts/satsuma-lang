---
id: sl-vryu
status: open
deps: []
links: []
created: 2026-06-11T02:43:01Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, grammar]
---
# grammar: type/metadata boundary purely whitespace-determined — UUID(pk) silently absorbs constraints

type_expr is a single token name(...) (grammar.js:322-328). "customer_id UUID(pk)" (no space) -> type_expr UUID(pk), clean parse, the pk constraint silently absorbed into the type text — no metadata_block node. "amount DECIMAL (12,2)" (space) -> type DECIMAL then (12,2) parsed as metadata_block with ERROR-wrapped number_literals. Spec 3.2 only says metadata is the parens after the type; both spellings are plausible and the no-space case produces a misleading clean tree.

## Acceptance Criteria

Either parenthesized type args and metadata are structurally distinguished, or known constraint tokens inside type parens are flagged; corpus tests for both spellings; spec clarified.

