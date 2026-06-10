# ADR-029 — Shared Card-Geometry Contract Between Layout and Renderer

**Status:** Accepted
**Date:** 2026-06-10 (sl-wixe / sl-dw9x, feature 34)

## Context

The mapping visualization computes node positions and edge routes with ELK
*before any DOM exists*: `tooling/satsuma-viz/src/layout/elk-layout.ts`
estimates every card's width and height from constants, hands those boxes to
ELK, and derives edge anchor points (`overviewVisualAnchor`) from the same
numbers. The card components (`sz-schema-card`, `sz-metric-card`,
`sz-fragment-card`) then render real DOM whose dimensions come from CSS —
padding, line-height, and font metrics.

Nothing tied the two sides together. The layout declared
`NAMESPACE_PILL_HEIGHT = 24` privately; the card components independently
rendered `height:24px` filler bars; the overview mapping pill compensated
with an inline `padding-top:24px`. These three copies of "24" drifted: the
renderer drew a filler bar on non-namespaced compact cards that the layout's
`compactHeight()` never counted, the edge SVG layer was mounted at the canvas
padding-box origin while cards sat inside the padding, and the result was the
feature 34 review's headline bug — anchor dots floating in space beside and
above the cards (`features/34-live-editor-ux/edge-attachment-markup.jpg`),
with row spacing distorted by cards overflowing their ELK nodes.

Two alternatives were considered. *Measuring the rendered DOM and re-running
layout* would make rendered and assumed geometry agree by feedback, but costs
a second layout pass on every model change (hostile under live editing, where
the model is rebuilt per debounced keystroke) and makes layout
non-deterministic across font availability. *Tuning the constants until they
matched* is what the codebase implicitly had — and is exactly the drift-prone
arrangement that produced the bug.

## Decision

Card-chrome geometry is a **single-source contract**:
`tooling/satsuma-viz/src/layout/geometry.ts` owns the constants
(`HEADER_HEIGHT`, `NAMESPACE_PILL_HEIGHT`, `META_PILL_ROW_HEIGHT`,
`META_PILL_ROW_GAP`, `METADATA_PILLS_CHROME`), and **both sides import them —
neither may re-declare a value**. The layout sizes ELK nodes and computes
edge anchors from these constants; the card components *pin* the
corresponding chrome to them in CSS (`height: ${HEADER_HEIGHT}px;
box-sizing: border-box` on `.header`, an explicit pinned height on the
namespace pill row and each metadata pill row) rather than letting padding
and font metrics approximate them.

Two corollaries are part of the contract. First, chrome that the layout does
not count must not render: cards without a namespace render *no* top bar at
all (the header owns the card's top rounding) instead of a filler. Second,
everything positioned from layout coordinates — cards, edge SVG layers,
source-block labels — lives inside the same `.card-layer` element so all
layers share one coordinate origin by construction, rather than compensating
for the canvas padding with matching inline offsets.

The contract is enforced by tests on both sides: layout unit tests
(`test/overview-anchors.test.js`, `test/meta-pills-layout.test.js`) pin the
anchor math and node-height deltas to the exported constants, and Playwright
tests (`satsuma-viz-harness/test/edge-anchors.test.ts`) assert that rendered
anchor dots sit on rendered card borders at the rendered header's midpoint.

## Consequences

**Positive:**

- Edge anchors land on cards by construction; a geometry change is made once
  and both sides move together.
- Layout stays a pure, deterministic function of the model — no DOM
  measurement pass, which matters under live editing's per-keystroke rebuilds.
- The DOM-vs-layout agreement is testable at two independent levels (unit
  math, rendered pixels), so drift fails CI instead of shipping.

**Negative:**

- Card chrome heights are fixed, not content-driven: a header or pill row
  cannot grow for wrapped text — overlong content must truncate (tooltips
  carry the full value). Any new card chrome must be designed to a pinned
  height and registered in `geometry.ts` before the layout can account for it.
- Free-flowing dimensions (text width) remain estimates
  (`estimateTextWidth` char-width constants); the contract covers vertical
  chrome geometry and attachment points, not every pixel of card width.
