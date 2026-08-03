---
id: lgc-3f13
status: open
deps: []
links: [sl-dqyu, sl-hi0z]
created: 2026-08-03T22:08:38Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [graph, lineage, namespaces, validate, feature-41]
---
# A namespaced mapping targeting a global schema invents 'ns::name' throughout graph, lineage and validate

extract.ts qualifies a mapping's TARGET refs with the enclosing namespace but deliberately leaves its SOURCE refs authored (extract.ts:490-497, the asymmetry recorded under sl-98cz). Unqualified names resolve in the current namespace and then the global namespace (namespaces PRD: 'Resolution: current namespace -> global namespace -> error'), so pre-qualifying the target destroys the information the resolver needs: the CLI's resolveScopedEntityRef sees 'ns_a::s1', treats a ref containing '::' as fully qualified, finds nothing, and its '?? ref' fallback keeps the invented key.

Minimal repro:

  schema s1 { field_0 STRING }

  namespace ns_a {
    schema s0 { field_0 STRING }
    mapping m0 {
      source { s0 }
      target { s1 }
      field_0 -> field_0
    }
  }

Four wrong answers from that one file:

1. validate:   warning [undefined-ref] Mapping 'ns_a::m0' references undefined target 'ns_a::s1'
2. graph --json schema_edges: ns_a::m0 -> ns_a::s1, an endpoint with NO node entry (nodes are ns_a::m0, ns_a::s0, s1)
3. graph --json edges: ns_a::s0.field_0 -> ns_a::s1.field_0 — an invented field endpoint on a schema that does not exist
4. lineage --from ns_a::s0 reports the data flowing into a schema 'ns_a::s1' that is nowhere declared

The source side is correct in the same file, which is what hid this: 'source { global_src }' inside a namespace resolves to the global schema. Only targets are affected, and only when the mapping is namespaced and the target is global.

This is the schema-level twin of r0-7w76: an endpoint emitted for a name nothing declares. Found by Feature 41 R2's 'every generated workspace validates clean' gate (sl-dqyu) the first time the generator produced a namespaced mapping with a file-scope target. The generator now avoids the shape and records why, referencing this ticket, so R3's properties are not red for a defect they did not cause.

## Acceptance Criteria

The repro above validates clean and reports the global 's1' as the target in graph nodes, graph schema_edges, graph edges and lineage. Targets are resolved the same way sources are — against the index, honouring current-namespace-then-global — rather than pre-qualified during extraction. ExtractedMapping's contract states which spelling targets carry, and every consumer of mapping.targets is checked against the change (graph-builder, field-lineage, lineage, schema-graph, viz-backend, LSP). Feature 41's generator drops its avoidance of the shape and the namespaced chain arbitrary generates it again.

