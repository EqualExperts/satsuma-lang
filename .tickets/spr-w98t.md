---
id: spr-w98t
status: open
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

