---
id: sl-dknl
status: closed
deps: []
links: []
created: 2026-06-04T09:51:36Z
type: chore
priority: 2
assignee: Thorben Louw
tags: [viz, follow-up]
---
# viz: clean up compact-card-expansion follow-ups

Follow-ups from review of `feat/compact-card-expansion` (commit ff366cf, merged to main). The feature ships a real improvement, but several details in the implementation set a poor example for a teaching codebase and one test relies on a fixed wait. Bundling the cleanups here rather than blocking the original work.

Files involved:
- tooling/satsuma-viz/src/components/sz-schema-card.ts
- tooling/satsuma-viz/src/satsuma-viz.ts
- tooling/satsuma-viz-harness/test/harness.test.ts

## Design

**1. Replace imperative style mutation with a reflected attribute.**

`sz-schema-card.ts:711` does `this.style.overflow = this._compactExpanded ? "visible" : ""` to defeat its own `:host { overflow: hidden }` rule. This is a layering violation that a reader of the codebase will mimic.

Fix: add a reflected attribute (e.g. `@property({ reflect: true, attribute: 'data-compact-expanded', type: Boolean })`) or mirror the existing `_collapsed` chevron pattern, and express the overflow override in CSS:

```css
:host([data-compact-expanded]) { overflow: visible; }
```

Remove the inline style assignment.

**2. Drop the full-DOM scan on every toggle.**

`_onCompactToggled` in `satsuma-viz.ts:1157` queries `canvas.querySelectorAll('.positioned-card')` and re-measures every card. The card that toggled already knows its own height — include it in the event detail:

```ts
this.dispatchEvent(new CustomEvent('sz-compact-toggled', {
  detail: { schemaId: this.schema.id, expanded: this._compactExpanded },
  bubbles: true,
  composed: true,
}));
```

The parent can then read the source element's bounds directly off the event target (`event.composedPath()[0]`), or use the detail to look up the relevant card. Avoid the O(N) sweep.

**3. Decide whether the canvas shrinks on collapse.**

Currently `maxBottom` is seeded with `_overviewLayout.height`, so the canvas only grows. If the user expands one card and collapses it, the canvas stays at the expanded height. Either:
- Document this is deliberate (a one-line code comment explaining the asymmetry), or
- Re-derive the canvas height from currently-expanded cards on every toggle, so collapse shrinks too.

Pick one and make the choice visible in the code.

**4. Re-layout interaction.**

When filters or dataset reloads trigger a new layout, `_overviewCanvasHeight` resets to `overview.height` but each card's `_compactExpanded` state persists. The expanded card will be clipped again until the user toggles it. Either reset card state on re-layout, or re-run the measurement after layout settles. Add a test for: expand → change filter → assert canvas still fits the expanded card (or assert card collapsed on layout change, whichever path is taken).

**5. Replace `waitForTimeout(200)` in the canvas-growth test.**

`harness.test.ts`: 'expanding a compact card grows the overview canvas height' uses a fixed wait. Replace with:

```ts
await expect.poll(async () => canvas.evaluate((el) => el.getBoundingClientRect().height))
  .toBeGreaterThan(heightBefore);
```

Same idiom as the `navigate` event test in the same describe block.

**6. (Optional, not blocking) Click semantics.**

Today a single click on the compact header both toggles fields and dispatches `navigate`. Fine in the harness, invisible in VS Code. If we want clean semantics, bind toggle to the chevron and `navigate` to the title. Worth raising with the user; do not change without agreement.

## Acceptance Criteria

- `sz-schema-card` no longer mutates `this.style.overflow` imperatively; overflow override is driven by CSS keyed off a reflected attribute or state-bound class.
- `sz-compact-toggled` carries a `CustomEvent` detail (`{ schemaId, expanded }`) and the parent stops scanning the full DOM on every toggle.
- Canvas-height behaviour on collapse is either symmetric (shrinks back) or documented in code as deliberately asymmetric.
- Re-layout interaction is verified by a test: expand a compact card, trigger a layout change (filter or dataset reload), and assert the expanded card is not clipped (or that card state is reset on layout, depending on the chosen approach).
- The `canvas height grows` Playwright test no longer uses `page.waitForTimeout`; it polls on the canvas bounding rect.
- Tests (`npm --prefix tooling/satsuma-viz run test`, viz-harness Playwright via the sentinel workflow) pass locally.


## Notes

**2026-06-09T21:15:24Z**

Pre-existing bug found during Feature 32: commit ff366cf added the compact-card-expansion Playwright tests referencing fixture contracts/buy-to-om-order.stm but never committed the fixture. Since harness.test.ts resolves all fixtures in a shared beforeAll, the missing file made the ENTIRE firefox harness suite (40 tests) throw and not-run on main. Fixed by authoring the intended canonical example examples/contracts/buy-to-om-order.stm (buy_order → om_order, validates clean). All 40 firefox tests now execute and pass.

**2026-06-10T01:15:00+01:00**

Cause: Review follow-ups from the compact-card-expansion feature (ff366cf): imperative style mutation, full-DOM measurement sweep, ratcheting canvas height, unverified re-layout interaction, and a fixed-wait test.
Fix: All acceptance criteria were delivered by le-a1vp (commit e06975f), which made expansion layout-driven: reflected compact-expanded attribute + :host CSS replaces style.overflow; sz-compact-toggled is a CustomEvent { schemaId, expanded } with no DOM sweep; canvas height is layout-derived and symmetric; expanded state persists across re-layouts with geometry covered by node + Playwright tests; waitForTimeout replaced with expect.poll. Item 6 (separate chevron/title click semantics) was explicitly optional and remains a product decision.
