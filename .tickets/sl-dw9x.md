---
id: sl-dw9x
status: open
deps: [sl-wixe]
links: []
created: 2026-06-10T07:19:37Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-ubbp
tags: [viz, layout]
---
# Stack schema-card meta pills vertically; width follows fields (R7)

Long metadata values (namespace URIs) lay out as a nowrap flex row (.metadata-pills, sz-schema-card.ts:246-264) and the detail view lets cards grow to content width (sz-mapping-detail.ts:66-67), so the pill row sets card width and leaves huge white space below. Stack pills one per row with wrapping/middle-truncation + title tooltip. Update elk-layout estimate*Width to match so R2's flush-edge guarantee holds. See PRD P7/R7.

## Acceptance Criteria

A pill never widens a card beyond its field rows' needs; applies in detail view and expanded overview cards; layout width estimation updated in step; visual/Playwright test on a fixture with multiple long namespace metadata values in both themes.

