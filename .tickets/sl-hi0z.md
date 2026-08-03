---
id: sl-hi0z
status: closed
deps: [sl-dqyu]
links: [lgc-3f13, lgc-wtz1, lgc-4bxl, lgc-fu7o]
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


## Notes

**2026-08-03T22:27:32Z**

Cause: Nothing asserted that an emitted edge endpoint names a declared field, and
every resolver in the chain fails closed by skipping — so an invented endpoint and
a dropped edge were both invisible in the command that produced them.

Fix: Nine properties over generated workspaces, in
satsuma-cli/test/generated-edge-invariants.test.ts (endpoint existence; the
emitted set equals the declared set in both directions; container-block
completeness; every endpoint backed by a node, under --namespace too; namespace
filtering is a subset; invariance under reordering declarations and under
splitting across more files) and satsuma-viz/test/generated-edge-completeness.test.js
(the layout draws every declared arrow, with the three permitted omissions —
nl-derived, container headers, computed — enumerated rather than shrugged at).
satsuma-viz now also runs in the local pre-commit hook; CI already ran it.

Both mutation checks the ticket asks for were run and confirmed: removing the
nsFilter node backfill fails the endpoint-has-a-node property naming the
namespace, and reverting elk-layout's container-relative qualification fails the
container property with actual: [] — the original 3cdd-yavi symptom of no lines
at all. Acceptance test 6 is not runnable as written (qualifyField has no guard to
revert); its executable form is the todo property that fails today on r0-7w76's
shape.

Two further real bugs found, raised and linked rather than fixed here, per this
ticket's own instruction: lgc-4bxl (P1 — the viz draws a computed, sourceless
arrow as a line from a same-named source field, or drops it entirely) and lgc-fu7o
(P1 — the viz draws only the first source of a multi-source arrow while the hover
path highlights on all of them, so hovering the second source lights up a line to
the first source's card). Both have their property written and marked todo, so
fixing them is a one-line test change. (commit immediately after d86a2413)
