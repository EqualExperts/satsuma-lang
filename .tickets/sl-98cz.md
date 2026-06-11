---
id: sl-98cz
status: closed
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


## Notes

**2026-06-11T08:58:55Z**

Cause: extractMappings records source names exactly as authored (bare inside namespaces) while the workspace index keys schemas qualified, and core resolveRef looked context schemas up raw — so bare/dotted @field refs against namespaced source schemas never resolved at the core level. The shipped CLI and viz paths were masked by consumer-side patches (index-builder resolveScopedEntityRef, viz-model resolveMappingRef), but the core API contract remained a trap for any consumer that did not pre-qualify.
Fix: added contextSchemaKey() in core nl-ref.ts — context schema names without "::" are tried namespace-qualified first (when that key exists in the lookup), falling back to the raw name for global schemas — and applied it at the dotted-field and bare-identifier lookup sites; resolvedTo names report the qualified key. Documented the extraction-time source/target qualification asymmetry at the extractMappings site. Tests pin the ticket repro (bare and dotted refs, source and target side) and the global-schema fallback.
