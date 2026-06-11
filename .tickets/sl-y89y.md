---
id: sl-y89y
status: open
deps: []
links: []
created: 2026-06-11T02:40:29Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, cli]
---
# cli: lineage depth-limited traversal truncates nodes reachable within depth via shorter path

satsuma-cli/src/commands/lineage.ts:145-164 buildDownstream (and buildUpstream :196-210) add nodes to a global visitedNodes at first visit; a node first reached at deep depth is never re-expanded when reached later at shallower depth, so its subtree is truncated despite remaining depth budget. Repro: edges s0->s1, s1->s2, s2->s3, s0->s2; lineage --from s0 --depth 2 omits s3 even though s0->s2->s3 is exactly 2 hops; --depth 3 shows it.

## Acceptance Criteria

Depth-limited traversal expands nodes again when revisited at shallower depth (or tracks min-depth); diamond-graph regression test.

