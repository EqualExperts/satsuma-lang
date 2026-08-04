---
id: sl-jsyn
status: closed
deps: [sl-dqyu, sl-prlp, spr-w98t]
links: []
created: 2026-08-03T16:23:59Z
type: task
priority: 1
assignee: Thorben Louw
parent: sl-8f2p
tags: [feature-41, testing, lineage]
---
# lineage: reachability properties with the generated scenario as oracle

Traversal correctness is asserted on chosen graphs today (37 graph, 17 field-lineage and 11 lineage tests, each a remembered case). Depth limits, cycles, diamonds and multi-branch upstreams interact, and all three known defects are combinations: lineage --to returned one upstream chain instead of every declared branch (sg-pufq), a plain visited-set silently truncated subtrees under a depth limit (sl-y89y), and NL backtick refs manufactured phantom source edges (cbh-y5og). Unlike coverage, lineage needs no independent oracle: reachability over the scenario's own arrow set IS the expected answer.

## Design

Aim every property at the single portable traversal extracted by sl-prlp, not at the CLI-internal function. Properties: upstream(X) at depth d is exactly the ancestors of X within d hops of scenarioFieldEdges (sg-pufq); downstream(X) at depth d is exactly the descendants within d hops; duality Y in downstream(X) iff X in upstream(Y) (asymmetric edge construction between the two walks); depth EXACTNESS — the result at depth n is exactly the nodes whose shortest path is <= n, which is sl-y89y stated as a property, chosen over monotonicity because the buggy version satisfied monotonicity too; a generated cyclic workspace terminates and reports no duplicate entries; schema-level lineage equals the projection of field-level edges onto owning schemas, tying lineage to graph --schema-only.

## Acceptance Criteria

Replacing lineage.ts's shallowest-depth bookkeeping with a plain visited-set makes the depth-exactness property fail and does NOT make a monotonicity-only property fail, demonstrating why exactness is the property worth having. Restricting the upstream walk to a single predecessor makes the ancestor-set property fail with a generated diamond. A generated cyclic workspace completes within the depth limit and reports each field once. Every property carries a purpose comment naming its invariant or defect class.


## Notes

**2026-08-04T14:36:07Z**

Cause: R4 needed reachability properties aimed at core's traceFieldLineage using
the generated scenario as oracle, per spr-w98t's finding that the traversal
itself needed no fix, just proof at the property level across generated
multi-mapping chains/diamonds/cycles rather than hand-picked fixtures.

Fix: Added fieldEdgesFor() to test/support/generated-workspace.ts and a new
test/field-lineage-reachability.test.ts with 6 properties (upstream/downstream
depth-exactness vs scenarioAncestorsWithin/DescendantsWithin, sg-pufq's
diamond-branch completeness plus a single-predecessor mutant demonstration,
downstream/upstream duality, cyclic-workspace termination with no duplicate
entries, and schema-level lineage as the projection of field edges tying it to
graph --schema-only). All 6 pass; full CLI suite (1058 tests) green. (commit
immediately after 8ca5d5fc)
