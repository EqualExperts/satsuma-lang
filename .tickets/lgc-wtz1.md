---
id: lgc-wtz1
status: closed
deps: []
links: [sl-hi0z]
created: 2026-08-03T22:03:32Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [graph, json, feature-41]
---
# graph --json mixes canonical and index-key entity ids across sibling arrays

graph --json spells the same entity two ways in one payload. nodes[].id and schema_edges[].from/to use the index-key form (file-scope: 'raw'; namespaced: 'warehouse::staged'), while edges[] uses the canonical form ('::raw.field_0', and under --schema-only '::raw'). For a namespaced entity the two agree; for a file-scope one they do not, so a consumer joining edges to nodes silently finds no node for any file-scope schema.

Reproduce (kitchen-sink workspace from @satsuma/scenario-gen):
  satsuma graph --json --schema-only entry.stm
  nodes:        ['raw', 'warehouse::staged', 'revenue_metric', ...]
  edges:        [('::raw','warehouse::staged'), ('warehouse::staged','::revenue_metric')]
  schema_edges: [('raw','warehouse::stage_raw','source'), ...]

Cause: buildSchemaEdges pushes raw index keys, while aggregateFieldEdgesToSchemaLevel derives its endpoints from already-canonicalised field paths (edge.from.split('.')[0], graph-builder.ts:622) and so inherits the '::' prefix.

Found while writing Feature 41 R3's 'every edge endpoint is backed by a node' property (sl-hi0z), which has to normalise both forms before it can assert the invariant. The property is written against the invariant that matters and references this ticket; this ticket owns the representational fix.

## Acceptance Criteria

One spelling per entity across nodes[], edges[] and schema_edges[] in every graph --json mode, --schema-only included. Whichever form is chosen is stated in the graph command's JSON documentation and SATSUMA-CLI.md. Feature 41's endpoint-has-a-node property drops its normalisation shim. Existing graph tests updated for the chosen form; no other command's output changes.


## Notes

**2026-08-03T22:18:24Z**

A second instance, found while writing R3's properties (sl-hi0z): the
inconsistency is cross-command as well as intra-payload.

`graph --json` `edges[].mapping` is the index-key form; `field-lineage --json`
`via_mapping` is the canonical form (`canonicalKey(...)`, field-lineage.ts:165).
For the *same* mapping in the *same* workspace:

  graph:         "mapping": "load_metric"
  field-lineage: "via_mapping": "::load_metric"

So a consumer correlating the two commands cannot join them for any file-scope
mapping — the exact join that makes `graph` and `field-lineage` usable together.
Namespaced mappings agree (`warehouse::stage_raw` both sides), which is why this
survived.

Whichever spelling the fix chooses must therefore be applied across commands, not
just within `graph --json`. Feature 41's R3 properties normalise mapping keys with
a documented shim that references this ticket; the R5 parity sweep (sl-kwet) will
need the same shim until this is fixed.

**2026-08-04T16:54:12Z**

**2026-08-04T17:54:12Z**

Cause: buildSchemaEdges used index-key form; aggregateFieldEdgesToSchemaLevel
and field-lineage --json used canonical form; node IDs also used index-key form.
Result: JSON consumers couldn't reliably join edges to nodes for file-scope
entities, and graph --json didn't match field-lineage --json mapping spelling.

Fix: canonicalKey() applied throughout buildWorkspaceGraph:
- All node IDs converted to canonical form (nodes array)
- buildSchemaEdges endpoints converted to canonical form (schema_edges array)
- aggregateFieldEdgesToSchemaLevel mapping and endpoint IDs converted
- Field edge mappings converted to canonical form (edges array)
- Also applies to node sources/targets and schema sources

Tests updated to expect canonical form everywhere. Documentation updated in
SATSUMA-CLI.md to document the canonical form contract.

Feature 41 R3 endpoint-has-a-node property can now drop its normalisation shim.

(commit 08fba821)
