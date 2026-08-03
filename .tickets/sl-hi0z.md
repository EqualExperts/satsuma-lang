---
id: sl-hi0z
status: open
deps: [sl-dqyu]
links: []
created: 2026-08-03T16:23:59Z
type: task
priority: 1
assignee: Thorben Louw
parent: sl-8f2p
tags: [feature-41, testing, graph]
---
# graph+viz: structural edge invariants over generated workspaces

No consumer checks that an edge endpoint names a declared field, and every resolver in the chain fails closed by skipping — so a dropped edge is indistinguishable from no edge. qualifyField ends with an unconditional `${schemas[0]}.${field}` (canonical-ref.ts:75) and invents mart::species_fact.species_fact for a container header naming the schema root (r0-7w76). elk-layout.ts:754 skips any arrow whose ports do not resolve, which once made every nested-iteration mapping draw no lines at all with no test failing (3cdd-yavi, sl-l7u0).

## Design

Properties over generated workspaces, aimed at the CLI's graph assembly, the portable traversal and the VizModel plus its layout: every emitted endpoint is in scenarioDeclaredFieldPaths; every edge in scenarioFieldEdges is emitted exactly once and every emitted edge is in scenarioFieldEdges (both directions — dropped and invented); an edge may be omitted only where a named, commented exception applies and the property enumerates the permitted exceptions, so legitimate skips stay legal; every edge endpoint is backed by a node including under --namespace (promotes sl-p895's backfill block at graph-builder.ts:196-249 to a stated invariant); graph --namespace edges are a subset of the unfiltered edges; the edge SET is invariant under permuting declaration order and under splitting the same declarations across more files. The viz-side property runs in satsuma-viz's node suite — layout.test.js and dom-shim.js already make ELK layout reachable without a browser, so no harness work is needed. This ticket does not change lineage or graph semantics and does not decide r0-7w76; if a property fails on current behaviour, record it against the owning bug ticket.

## Acceptance Criteria

Reverting qualifyField's guard makes the endpoint-existence property fail and the counterexample names the invented field. Restoring an unconditional continue in elk-layout.ts's port resolution makes the arrow-to-edge completeness property fail. Removing the nsFilter node backfill in graph-builder.ts makes the endpoint-has-a-node property fail. Reordering declarations does not change the emitted edge set. Every property carries a purpose comment naming the invariant or defect class it defends, and failures report seed, path and shrunk Satsuma source.

