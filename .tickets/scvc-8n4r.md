---
id: scvc-8n4r
status: closed
deps: []
links: []
created: 2026-08-05T15:11:02Z
type: bug
priority: 2
assignee: Thorben Louw
parent: sl-3de8
tags: [feature-36, viz]
---
# viz: chain view renders no visual connector between hop cards

sz-chain-view.ts lays hop cards out with plain flexbox (gap only) — there is no line, arrow, or other visual element joining one card to the next. PRD 36's design section calls for hops 'connected by edges labelled with the mapping name and a classification badge'; today the mapping name and badge render as text inside each card, but nothing visually joins the cards into a chain. Found by the user testing the field chain view live via examples/namespaces/namespaces.stm and examples/namespaces/ns-merging.stm (sl-nswc's fixture) after the harness's field-lineage click path was wired up.

## Acceptance Criteria

A visible connector (line/arrow) renders between each adjacent rail segment (upstream columns, the focus card, downstream columns) indicating flow direction; classification/mapping-name information already on each hop card is unchanged; unit tests updated for the new structure; a Playwright spec in the 'Field chain view' describe block proves the connector actually paints in a real browser (unit tests alone cannot observe this, per AGENTS.md's visual-contract rule).


## Notes

**2026-08-05T15:23:46Z**

Cause: sz-chain-view.ts laid out hop cards with plain flexbox gap only — nothing (line, arrow, or otherwise) visually joined one card to the next, so the rail read as a loose row of cards rather than a chain, despite PRD 36 calling for hops 'connected by edges'. Found by the user testing the field chain view live via the harness dev preview after the harness's field-lineage click path was wired up (sl-nswc).
Fix: added a decorative flow-arrow connector (.chain-connector, an aria-hidden span styled with a CSS line + triangular head) between every adjacent pair of rail segments — upstream columns, the focus card, and downstream columns — reusing the namespace-fan chip's existing border colour token so no new design token was needed. render() now builds an explicit ordered list of segments (RailSegment[]) and interleaves a connector between each pair rather than relying on flex gap alone. Added a unit test proving the connector set and its ordering, and a new Playwright spec in the harness's 'Field chain view' describe block proving a connector is actually painted in the visual gap between the two cards it joins (bounding-box comparison) — a property no unit test can observe, per AGENTS.md's visual-contract rule. Also added examples/multi-hop-lineage/pipeline.stm, a deliberately artificial 7-schema/6-hop chain with varying record nesting, as a demo fixture for showing the chain view's multi-hop rendering (not used by the new test, which reuses the existing ns-merging.stm fixture already wired up in the harness). Full run-repo-checks.sh green; harness Playwright suite 115/115 green after a rerun ruled out an unrelated pre-existing flake in view-persistence.test.ts. (commit immediately after 7f7bfc95)
