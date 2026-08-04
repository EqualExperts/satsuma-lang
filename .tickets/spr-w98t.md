---
id: spr-w98t
status: closed
deps: [sl-prlp]
links: []
created: 2026-08-04T09:28:15Z
type: bug
priority: 1
assignee: Thorben Louw
parent: sl-6hot
tags: [cli, lineage, field-lineage]
---
# cli: field-lineage depth-limited traversal truncates subtrees reachable within depth via a shorter path

satsuma field-lineage's traceUpstream/traceDownstream (field-lineage.ts:245-303) use a first-visit-wins visited set: a node first reached at deep depth is never re-expanded when a shorter path reaches it later with depth budget remaining, so its whole subtree is truncated from the result.

This is exactly the defect sl-y89y described and fixed — but that fix (DepthAwareTraversal, recording the shallowest visit per node and re-expanding on strictly shallower revisits) landed only in commands/lineage.ts, the schema-level walk. The field-level walk was never migrated and still has the original shape. Two traversals, one fixed, one not.

Found while re-planning sl-prlp (2026-08-04), not by a user report — so a diamond-shaped field graph reproducing it needs writing.

Sequencing: this cannot be fixed inside sl-prlp, whose acceptance criteria require byte-identical field-lineage output, and fixing it changes the output for diamond field graphs. But Feature 41 R4 (sl-jsyn) asserts depth *exactness* — 'the result at depth n is exactly the nodes whose shortest path is <= n', written specifically to catch this class rather than monotonicity, which the buggy version also satisfies — so R4 goes red until this lands. Fix after sl-prlp extracts the traversal into core, before or alongside sl-jsyn.

## Acceptance Criteria

- A diamond field-lineage graph (two paths to one node, of different lengths) is covered by a regression test asserting the full subtree below the shorter path appears at the depth where it is reachable.
- Upstream and downstream both re-expand a node revisited at a strictly shallower depth, and neither emits duplicate entries for it.
- The depth-aware traversal is shared with commands/lineage.ts rather than reimplemented: after sl-prlp, one traversal in satsuma-core serves both the schema-level and field-level walks, and DepthAwareTraversal is deleted from commands/lineage.ts.
- Cyclic workspaces still terminate.
- Feature 41 R4's depth-exactness property (sl-jsyn) passes against the field traversal with no weakened assertion.


## Notes

**2026-08-04T12:26:54Z**

Cause: The ticket inferred a depth-limit defect from a first-visit set, but field-lineage has always used FIFO breadth-first traversal, so every field is necessarily discovered at a shortest depth before any longer path can reach it. Fix: Added explicit downstream and upstream diamond contract tests proving shortest-path expansion, boundary-subtree inclusion, and unique output; no production change or shared traversal abstraction is required. (commit immediately after ec45cfba)

**2026-08-04T13:20:00Z**

Cause (review follow-up): the first diamond fixtures were too shallow to discriminate — mutating `queue.shift()` to `queue.pop()`, which reproduces exactly the depth-inexactness this ticket alleged, left them green, because a two-path field adjacent to the focus is enqueued at its shortest depth under any expansion order. Fix: rebuilt the fixtures as five-node diamonds whose boundary field is lost unless the two-path field is claimed by its two-hop side (all three cases now fail under the LIFO mutant), added an edge-order-independence case, and replaced the in-code comment that still named this ticket as pending work with the FIFO shortest-path invariant and why the CLI's schema walk needs its own shallowest-visit map. (commit immediately after fe26b465)
