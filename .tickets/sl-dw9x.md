---
id: sl-dw9x
status: closed
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


## Notes

**2026-06-10T08:25:34Z**

Cause: .metadata-pills was a nowrap flex row and detail-view cards size to max-content, so a long namespace URI set the card intrinsic width (huge dead white space below).
Fix: pills stack one per row, excluded from intrinsic width via contain: inline-size, end-truncating with full text in a title tooltip; row heights pinned to new shared geometry constants (META_PILL_ROW_HEIGHT/GAP, METADATA_PILLS_CHROME) used by preambleHeight; pill width contributions removed from estimateCompactSchemaWidth and the full-card estimate. 2 layout unit tests + 2 Playwright tests (stacking/tooltips; live-edit-lengthened URI truncates while card width stays fixed). Verified 95/95 watcher run.
