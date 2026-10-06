---
id: bsw-18k1
status: open
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-sweep-2026-10, lsp, namespaces, nl-ref]
---
# lsp: find-references from a namespaced field misses an unqualified @schema.field NL ref in the same namespace

qualKeys in `tooling/satsuma-lsp/src/references.ts:55-66` builds `ns::s1.the id`, but an `` @s1.`the id` `` NL ref inside the namespace is indexed as `s1.the id`. References find the arrow and a top-level `` @ns::s1.`the id` ``, but not the unqualified ref inside the namespace.

## Acceptance Criteria

- References include namespace-local unqualified @refs; test added.
