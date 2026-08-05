---
id: sl-jhdh
status: open
deps: []
links: []
created: 2026-08-05T09:26:05Z
type: bug
priority: 4
assignee: Thorben Louw
tags: [bug-hunt, viz, coverage, deferred]
---
# viz: coverage fill bar proportion looks wrong on namespaced nodes (deferred — accepted as-is for now)

In the overview graph, the namespaced node colony_survey ("survey" namespace) shows "6/7" and an "85%" badge, but the green/orange coverage-fill split painted in the header (`.coverage-fill`, sz-schema-card.ts:128-134, width driven by the `--sz-coverage-percent` custom property set at ~line 1080 from `coverage.totals.pct`) does not look like it is filling to the stated percentage. Compare against a non-namespaced card at a similar percentage (customer_360, 93%, bug-reports/only-click-in-arrow-expands-contracts.png), where the fill visually tracks the badge closely.

**Confirmed root cause (per user):** `.coverage-fill` is scoped to `.header` only — its `inset: 0 auto 0 0` fills the header box, not the namespace-pill row rendered above it (`_renderNamespacePill()`, ~658-667; see sl-yedr for the same "namespace row sits outside what the header's own styling accounts for" shape of bug). So for a namespaced card, the percentage shading covers only the header portion of the card, not the full card height including the namespace strip — which is why the fill reads as visually "off" relative to the badge, even though the underlying `coverage.totals.pct` figure is correct.

**Decision:** accepted/deferred for now — the user reviewed this root cause and said it may be OK as-is. Not scheduled for work; revisit if it comes up again or if sl-yedr's fix touches the same header/namespace-row boundary.

Screenshot: bug-reports/namespace-blocks-coverage-render.png

## Acceptance Criteria

Deferred — no acceptance criteria to implement against right now. If picked back up: decide whether the coverage-fill should extend to cover the namespace-pill row too, then add a regression test comparing rendered fill width/height to coverage.totals.pct for a namespaced fixture.

