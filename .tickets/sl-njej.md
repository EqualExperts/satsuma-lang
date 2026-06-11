---
id: sl-njej
status: open
deps: []
links: []
created: 2026-06-11T02:40:29Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [bug-hunt, cli]
---
# cli: field-lineage double-prefixes namespace on NL refs, dropping nl-derived edges

satsuma-cli/src/commands/field-lineage.ts:191-194 — resolveAllNLRefs already returns nlRef.mapping fully qualified (ns::m, core nl-ref.ts:706-731), but field-lineage re-prefixes with nlRef.namespace producing ns::ns::m; index.mappings.get fails and the ref is skipped. arrows.ts:159-165 has a comment (sl-qxn5) warning about exactly this trap; graph-builder.ts:496-498 does it correctly. Repro: namespaced mapping with arrow "derived from @s1.a plus b" -> field-lineage ns::s2.x --upstream omits the nl-derived edge from s1.a; same file without namespace shows it; graph --json shows it even namespaced.

## Acceptance Criteria

field-lineage shows nl-derived edges inside namespaces, matching graph output; regression test with namespaced NL ref lineage.

