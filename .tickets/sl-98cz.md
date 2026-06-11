---
id: sl-98cz
status: open
deps: []
links: []
created: 2026-06-10T23:21:30Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [bug-hunt, core, nl-ref]
---
# core: false unresolved-nl-ref for bare field refs in namespaced mappings

extractMappings (satsuma-core/src/extract.ts:425-427) namespace-qualifies mapping targets (crm::tgt) but leaves sources unqualified (customers). The workspace index keys schemas qualified (crm::customers). resolveRef (satsuma-core/src/nl-ref.ts:351-374, 400-407) calls lookup.getSchema with the raw source string and never tries mappingContext.namespace qualification, so source schemas are never found. Repro: namespace crm { schema customers + schema tgt + mapping with arrow "copy @account_id then @id" } -> unresolved-nl-ref for account_id (source side) while @id (target side) resolves. Asymmetric false positive on every namespaced mapping using bare @field refs.

## Acceptance Criteria

Bare and dotted @refs against source schemas resolve inside namespaces; test with namespaced mapping using bare field refs on both source and target side.

