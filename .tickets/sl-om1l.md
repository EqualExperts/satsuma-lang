---
id: sl-om1l
status: open
deps: []
links: [sl-2ne7]
created: 2026-08-05T09:27:16Z
type: task
priority: 3
assignee: Thorben Louw
tags: [bug-hunt, viz, ux, css]
---
# viz: source/target cards get too wide when a field carries many meta/constraint tags — neither card-level pills nor field-level badges wrap

Two related unbounded-width rows both blow out card width, because the detail view sizes cards to content (`max-content`, cited in sl-dw9x):

1. **Card-level** `.metadata-pills` (sz-schema-card.ts:353-366) is `display:flex; flex-direction:column`, deliberately stacking one pill per row — sl-dw9x already fixed the specific failure mode this caused (a `nowrap` flex ROW let a long namespace URI blow out the card's intrinsic width) by switching to one-per-line stacking.
2. **Field-level** `.badges` (sz-schema-card.ts:283-288, inside `.field-row` at 215-221) is `display:flex; gap:3px; flex-shrink:0` — no `flex-wrap`, and `flex-shrink:0` explicitly stops the badges from compressing. `.field-row` is a single fixed-height row (`height: var(--sz-field-height)`). So a field with several constraint/metadata tags (e.g. `email`: encrypt, pii, classification RESTRICTED, encrypt AES-256-GCM, mask partial_email, retention 3y — 6 tags) forces the whole row, and therefore the whole card, wider to fit them all on one line. This is the same shape of bug sl-dw9x fixed for the card-level row, just never applied to field rows.

Per user feedback: switch the card-level pills to a wrapping flex row (`flex-wrap: wrap`) instead of a column stack — wrapping keeps every row within the container's width (unlike the old `nowrap` row sl-dw9x fixed), so it should give the same compact-width guarantee while looking less sparse than one-pill-per-line. And give field-level `.badges` `flex-wrap: wrap` too, so a heavily-tagged field spills onto a second line under the field name/type instead of widening the card.

**Layout dependency to check for the field-level fix specifically:** `layout/elk-layout.ts` uses a single fixed `FIELD_HEIGHT = 28` constant to estimate every schema card's height and to place edge-anchor Y coordinates (`PORT_Y_OFFSET = FIELD_HEIGHT / 2`, and `countFields(...) * FIELD_HEIGHT` in several places). A field row that wraps onto two lines is taller than `FIELD_HEIGHT`, so the height estimate and edge anchors need to account for that — the same kind of geometry-constant dependency sl-dw9x had to update `estimateCompactSchemaWidth` for for the card-level fix.

Enum is explicitly OUT of scope here — after review it got a different, bespoke design: sl-2ne7 collapses the enum tag by default and expands it into an overlay over the card on click, rather than becoming an inline wrapping chip. Don't fold enum into this ticket's wrap fix; sl-2ne7 owns it.

Screenshot: bug-reports/source-card-should-wrap-meta-tags.png

## Acceptance Criteria

- Card-level metadata pills wrap onto multiple lines instead of stacking one-per-line. A single overlong pill value (e.g. a long namespace URI) still end-truncates and never widens the card beyond its field rows' needs (sl-dw9x's guarantee, re-verified).
- Field-level tag rows (constraint + metadata badges, excluding enum which sl-2ne7 owns) wrap onto additional lines under the field name/type instead of widening the card, for a field with many tags (e.g. a fixture matching the `email` field: 6+ tags).
- ELK layout height estimate and edge-anchor Y positions are updated to account for multi-line field rows; single-tag/no-tag fields keep today's height and anchor position unchanged.
- Visual/Playwright test in both themes: one covering the card-level pill wrap (matching sl-dw9x's original coverage), one covering a heavily-tagged field wrapping without widening the card.

