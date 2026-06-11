---
id: sl-h5cx
status: closed
deps: []
links: []
created: 2026-06-11T02:40:50Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, cli]
---
# cli: lineage --to text output collapses to the target when upstream contains a cycle

satsuma-cli/src/commands/lineage.ts:222-265 printUpstreamFlat picks roots as nodes with no incoming edges; in a cycle every node has incoming edges, so roots = [target] and text mode prints only the target (exit 0) — all upstream info silently lost. Repro: mutual imports with m_ab: s_a->s_b and m_ba: s_b->s_a; lineage --to s_a prints only ::s_a while --json correctly returns 4 nodes/4 edges.

## Acceptance Criteria

Text mode renders upstream paths in cyclic graphs (cycle-break or SCC handling); cyclic two-file regression test comparing text vs json node coverage.


## Notes

**2026-06-11T23:10:00Z**

Cause: printUpstreamFlat found path roots as nodes with no incoming edges and walked forward; in a cyclic upstream graph no node qualifies, so text mode printed only the target while --json reported the full DAG.
Fix: paths are now discovered by climbing reverse edges from the target, ending at a true source or where a cycle closes onto the current path; regression test pins text output covering every JSON node on the cyclic fixture (commit b79a454)
