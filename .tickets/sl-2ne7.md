---
id: sl-2ne7
status: open
deps: []
links: [sl-om1l]
created: 2026-08-05T09:25:33Z
type: task
priority: 3
assignee: Thorben Louw
tags: [bug-hunt, viz, ux]
---
# viz: enum constraint renders as one long unbroken pill; should collapse by default with an expand-over-card affordance

viz-backend/src/viz-model.ts:1527-1528 joins all enum values into a single string (`entry.values.join(" | ")`) and stores it as one constraint entry. sz-schema-card.ts's `_renderField` (~849-853) renders each constraint as one `<span class="badge">`, so an enum with several values becomes one long unbroken pill of text ("enum enterprise | mid_market | smb | individual") instead of something scannable on a field row that's already dense with other tags.

Per user feedback, the fix is not to explode the values into inline wrapping chips (that still consumes a lot of row width/height for a field that's rarely the focus). Instead: the enum badge should render collapsed by default (e.g. `enum (4)` or the badge as today, just not the full value list), with a click/tap expanding it into an overlay that floats OVER the card — not one that pushes the row layout, since the field-row heights are pinned to the geometry constants the ELK layout estimates from (see sz-schema-card.ts:171-177, HEADER_HEIGHT comment, and the `compact-expanded`/`overflow: visible` handling at ~104-108 for the closest existing precedent of "let something paint outside the card without changing its box"). Clicking again (or clicking outside / Escape) collapses it back down. There is no existing popover/overlay component in `tooling/satsuma-viz/src` to reuse — this needs a new small overlay pattern, positioned absolute against the field row, with its own z-index above sibling cards.

This diverges from sl-om1l's "apply the same wrap-as-chips treatment to field-level tags including enum" framing — sl-om1l should be updated to point here for the enum case specifically, rather than assuming enum ends up as inline wrapping chips too.

Screenshot: bug-reports/enum-render-is-ugly.png

## Acceptance Criteria

- Enum constraint renders collapsed by default (compact indicator, not the full pipe-joined value list).
- Clicking/tapping it expands an overlay showing every enum value, individually legible (chips or a simple list), floating over the card rather than reflowing the field row or card layout.
- Clicking the expanded overlay again, clicking outside it, or Escape collapses it back to the default state.
- Doesn't regress the ELK layout's field-row height estimate (the collapsed state's height must match what layout already assumes).
- Covers a multi-value enum fixture in both compact and expanded card states, both themes.

