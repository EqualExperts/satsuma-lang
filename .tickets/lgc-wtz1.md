---
id: lgc-wtz1
status: open
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

