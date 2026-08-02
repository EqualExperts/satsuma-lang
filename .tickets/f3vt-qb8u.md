---
id: f3vt-qb8u
status: open
deps: []
links: []
created: 2026-04-09T19:38:04Z
type: task
priority: 3
assignee: Thorben Louw
parent: sl-0jva
tags: [viz, routing-quality, feature-30-followup]
---
# viz overview: dense lineage layouts route edges through unrelated mapping cards

## Original framing was wrong

This ticket was originally filed as a high-priority anchoring bug —
"overview edges do not anchor cleanly to schema card boundaries in dense
lineage layouts" — based on visual inspection of the screenshot review
artifacts produced by sl-mm7v. After investigation that diagnosis was
**incorrect**. A new automated regression assertion (added in
`tooling/satsuma-viz-harness/test/harness.test.ts` under "Geometry sanity
— overview layout invariants") now proves that overview edge endpoints
**do** anchor on the source card right edge and the target card left
edge for the canonical sfdc fixture, within a 6px tolerance. The
assertion passes against the unmodified renderer.

What looked like "arrows missing the cards" in
`metrics-overview-lineage-all-files.png` is actually a **routing-quality
issue**, not an anchoring bug.

## Real root cause

`computeOverviewLayout` in
`tooling/satsuma-viz/src/layout/elk-layout.ts:895-904` deliberately
discards ELK's routed bend points and replaces them with a 4-point
horizontal-vertical-horizontal "clean route":

```ts
const cleanPoints = [
  src,                    // source card right edge
  { x: midX, y: src.y },  // horizontal exit
  { x: midX, y: tgt.y },  // vertical climb at midX
  tgt,                    // horizontal entry into target card left edge
];
```

In sparse fixtures (sfdc, namespaces) the mapping cards sit in clean
columns, so `midX` falls in the empty gap between source-column-right
and target-column-left and the vertical segment lives in clear space.

In dense lineage fixtures (`metrics-platform`, `reports-and-models`)
ELK staggers mapping pipeline cards at varying x positions inside what
*looks* like a column. So the `midX` of one edge can land directly on
the x position of an unrelated mapping card. The vertical segment then
draws straight through that other card. To a reader skimming the
screenshot it looks like an arrow that "doesn't meet" the intended
card.

This is not a regression — the simple 4-point router has always done
this. It only became visible because Feature 30 introduced the dense
metrics and reports fixtures and the screenshot review workflow that
makes these layouts easy to inspect.

## Out of scope for Feature 30

Feature 30's design principle is "assert behaviour, not pixels" and its
acceptance criteria explicitly limit geometry checks to dimensions,
ordering, and non-overlap. Routing quality in dense layouts is a
separate concern.

This ticket is being kept open at P3 as a tracked routing-quality
follow-up and is **not** blocking sl-zowz or sl-0jva.

## Possible approaches (when this is picked up)

1. **Use ELK's routed bend points** instead of replacing them with the
   4-point reroute. ELK does its own collision avoidance with
   `elk.spacing.edgeNode` (currently `"20"`). Cost: ELK routes are
   sometimes wigglier than the clean 4-point version, so the visual
   tradeoff needs comparison shots.
2. **Bump midX off occupied x positions.** After computing midX, check
   whether any other overview node's x range covers it; if so, shift
   midX to the nearest free band. Cost: extra layout pass; may produce
   asymmetric routes.
3. **Route per-edge with a per-edge offset** based on the edge's
   index in a layer, so the vertical segments fan out instead of
   stacking. Cost: changes the visual character of every overview.

Approach (1) is the cheapest experiment — flip the renderer to use
ELK's `points` array (the fallback branch at
`elk-layout.ts:914-920` already covers it) and capture before/after
screenshots for the metrics and reports fixtures.

## Acceptance criteria

- [ ] Pick a routing approach with the user, with before/after
      screenshots from `metrics-overview-lineage-all-files.png` and
      `reports-overview.png`.
- [ ] Verify all existing geometry sanity tests still pass and the new
      edge-anchoring assertion still passes.
- [ ] sfdc and namespaces shots remain visually clean.

## Notes

**2026-04-09T19:50:00Z**

Cause: Original "anchoring" diagnosis was wrong. Investigation showed edge endpoints DO anchor correctly (proven by the new "sfdc overview edge endpoints anchor to source card right edge and target card left edge" assertion in harness.test.ts, which passes against unmodified code). The visible defect in dense lineage screenshots is the simple 4-point reroute in computeOverviewLayout drawing vertical segments through unrelated mapping cards when ELK staggers them.
Fix: Reframed this ticket from a P1 anchoring bug to a P3 routing-quality follow-up; not blocking sl-zowz or sl-0jva. The new automated edge-anchoring assertion lands as part of sl-zowz's verification work so any future regression of the kind originally suspected is caught by the suite, not the screenshot review.

## Links

- Originally filed during sl-zowz verification.
- Screenshot workflow that surfaced the visual issue: sl-mm7v.
- Parent epic: sl-0jva.

**2026-08-02T15:44:02Z**

Feature 30 archived to archive/features/30-viz-test-suite-expansion/ on 2026-08-02. This ticket stays open: it is a renderer defect the expanded suite surfaced, not outstanding Feature 30 scope, and its tags already say so (feature-30-followup, not feature-30). Parent sl-0jva retained as provenance even though that epic is closed. Still needs the user's edge-routing strategy decision before implementation.
