# Feature 30 - Viz Test Suite Expansion

> **Status: PLANNED** (2026-04-07)

## Goal

Expand the standalone viz harness into a high-value browser test suite that catches real regressions in the rendered mapping visualization, not just ready-state or event-plumbing smoke failures.

The primary success criterion is:

**A contributor can run the local Playwright harness and get actionable evidence that overview rendering, mapping detail rendering, field coverage, interactions, filters, complex fixtures, and visual alignment still behave correctly.**

This feature builds on the completed Feature 29 harness. It does not change the renderer architecture. It uses the existing `tooling/satsuma-viz-harness/` package as the browser test host and improves the suite around it.

---

## Problem

The viz harness exists, but the current browser coverage is still shallow for the things most likely to regress:

1. **Several tests validate synthetic events instead of real UI interactions.** Tests dispatch `CustomEvent` objects directly from `<satsuma-viz>`, so they can pass even if real clicks and hovers no longer emit the production event shape.
2. **Detail view coverage proves only that a detail view appears.** It does not assert that the correct source schemas, target schema, arrow rows, transforms, notes, and field-coverage indicators are present.
3. **Layout drift is not checked directly.** The suite has one larger-fixture ready-state test, but it does not assert geometry sanity such as card bounds, node ordering, non-overlap, or mapping nodes sitting between source and target schemas.
4. **Namespace rendering is undercovered.** Namespaced cards and mappings add namespace-pill height and use qualified IDs. They need explicit coverage because those dimensions and selectors differ from non-namespaced cards.
5. **Reports and metrics are undercovered.** The viz renders vanilla schemas, report/model schemas, and metric schemas with different card metadata and dimensions. The suite should cover all three user-visible card families.
6. **Complex mappings are undercovered.** Nested child records, list/flatten blocks, source joins, notes, NL `@ref` highlighting, computed arrows, and multi-source mappings are exactly where visual inspection matters most.
7. **There is no structured screenshot workflow.** Humans need screen grabs for quick review, markup, and feeding visual requirements back to a VLM. Today screenshots are incidental failure artifacts, not curated review outputs.

---

## Design Principles

1. **Assert behaviour, not pixels.** Use selectors, text, event payloads, and geometry sanity checks for automated pass/fail. Use screenshots for human review, not brittle golden image comparison.
2. **Test the production path.** Tests should load real `.stm` fixtures through `@satsuma/viz-backend`, the harness HTTP API, and the real `<satsuma-viz>` component.
3. **Prefer canonical examples, add curated fixtures only when needed.** Existing examples should anchor the suite. Add small purpose-built fixtures only when no canonical file isolates the behaviour.
4. **One invariant per test.** Keep each Playwright case easy to diagnose. A failing test should point at a specific broken contract, not a broad "viz looks wrong" bucket.
5. **Browser tests cover browser-only risk.** Model extraction and graph semantics belong in unit tests. Playwright covers user-visible rendering, interactions, event payloads, layout geometry, and screenshot review artifacts.
6. **Human review is part of the workflow.** The suite should save named screenshots for key states so a reviewer can mark up visual issues and pass them to a VLM with the corresponding fixture and test name.

---

## Scope

### 1. Harness event contract

Fix the harness event recorder so it captures the production event payloads emitted by `@satsuma/viz`, not only `CustomEvent.detail`.

Required event payloads:

- `navigate`: source URI, line, and character
- `field-hover`: schema ID and field name, including `null` on hover leave when asserted
- `field-lineage`: schema ID and field name
- `open-mapping`: mapping identity when emitted through the edge layer or equivalent interaction
- `expand-lineage`: schema ID, if the renderer exposes the interaction in the fixture under test
- `export`: exported SVG metadata, if export is included in the suite

The recorder should preserve a stable JSON shape in `window.__satsumaHarness.events` so Playwright can assert payloads without VS Code APIs.

### 2. Stable test hooks for deep rendered content

Add missing `data-testid` coverage where the current deep shadow DOM makes real interactions awkward or brittle.

Required hooks:

- overview schema cards
- overview mapping nodes/cards
- mapping detail root, header, source column, mapping column, target column
- mapping detail source and target schema cards with distinct prefixes
- mapping detail arrow rows
- mapping detail `each` and `flatten` section rows
- schema-card field rows and lineage buttons, including nested field paths
- field coverage ports/circles, with stable mapped/unmapped state selectors or attributes
- transform text and highlighted `@ref` spans
- notes and note toggles where user-visible
- toolbar filters and actions already in place (`Fit`, namespace filter, file filter, export)

### 3. Fixture matrix

The expanded suite must intentionally cover both simple and complex render paths.

Recommended canonical fixtures:

| Fixture | Purpose |
| --- | --- |
| `examples/sfdc-to-snowflake/pipeline.stm` | Non-namespaced vanilla schemas, imported lookup source, one named mapping, file notes, computed arrows, NL `@ref` transforms, map transform |
| `examples/namespaces/ns-platform.stm` | Namespaced schemas and mappings, namespace-qualified source/target refs, namespace filter, extra namespace-pill height |
| `examples/metrics-platform/metrics.stm` | Metrics as schema cards, cross-file lineage mode, file filter across `metrics.stm` and `metric_sources.stm` |
| `examples/reports-and-models/pipeline.stm` | Report/model schemas, report metadata, consumer mappings, report-card height and metadata rendering |
| `examples/filter-flatten-governance/filter-flatten-governance.stm` | Nested child records, list fields, source joins with NL join text, mapping notes, flatten sections, governance metadata, field coverage indicators |
| `examples/sap-po-to-mfcs/pipeline.stm` | Larger real-world layout stability and screenshot review |

If these fixtures do not isolate a required behaviour cleanly, add a small fixture under the harness package, not under canonical `examples/`, unless the example itself is broadly useful documentation.

### 4. Automated Playwright coverage

The suite should include the following groups.

#### Overview rendering

- Non-namespaced overview renders expected schema cards and mapping card for `sfdc-to-snowflake`.
- Namespaced overview renders expected qualified cards and mapping nodes for `ns-platform`.
- Metrics overview renders metric cards and source schema cards in lineage mode for `metrics-platform`.
- Reports overview renders report/model cards for `reports-and-models`.

#### Mapping detail rendering

- Clicking a real overview mapping card opens the expected detail view.
- Detail view for `opportunity ingestion` shows source schemas, target schema, expected arrow rows, computed arrows, map transform, NL transform text, and highlighted `@ref` spans.
- Detail view for a namespaced mapping shows the namespace label and qualified source/target names.
- Detail view for `completed orders` shows multiple source schemas, join text from the source block, mapping notes, nested field paths, and expected field coverage.
- Detail view for `order line facts` shows the `flatten` section, nested child source fields, and target rows such as `line_number`, `sku`, `quantity`, and `line_total`.

#### Field coverage and highlighting

- Mapped fields render mapped coverage circles/ports; unmapped fields render unmapped circles/ports.
- Hovering a real arrow row highlights the corresponding source and target field rows.
- Hovering a real source field highlights the arrow row and target field for that mapping.
- Hovering a real target field highlights upstream source fields for a multi-source mapping.
- Nested child fields use stable field-path identity rather than only the leaf field name.

#### Interaction events

- Clicking a real schema header or field row records a `navigate` event with non-empty URI and numeric position.
- Clicking a real field lineage button records a `field-lineage` event with schema ID and field name.
- Hovering a real field row records `field-hover` with schema ID and field name.
- Clicking an arrow row records a navigation event for that arrow's source location.
- Clicking export records an `export` event and verifies the SVG payload is non-empty, if export remains supported in the harness.

#### Compact card expansion (overview)

Compact schema cards in overview mode are click-to-expand: clicking the card header reveals the schema's fields inline without leaving the overview. This makes the harness useful for presenting schema structure to colleagues — previously clicking a compact card did nothing visible in the harness (though it still dispatches `SzNavigateEvent` for VS Code).

- A compact card shows no field rows on initial load.
- Clicking the header expands the fields list; clicking again collapses it.
- Expanding a compact card grows the canvas height so fields are never clipped by the viewport boundary. The canvas height is re-measured from actual positioned-card DOM bounds after each toggle.
- Expanding a compact card still dispatches a `navigate` event so VS Code integration continues to work.

Implementation: `_compactExpanded` state in `sz-schema-card`; `_overviewCanvasHeight` reactive state in `satsuma-viz` updated on `sz-compact-toggled` event via DOM measurement in `_onCompactToggled()`.

#### Filters and lineage mode

- Namespace filter narrows `ns-platform` to one namespace and hides cards from the others.
- File filter in `metrics-platform` lineage mode narrows to `metrics.stm`, then to `metric_sources.stm`, then back to all files.
- Single-file mode vs lineage mode produces a visible model difference for an import-reaching fixture.

#### Geometry sanity

For at least one non-namespaced fixture, one namespaced fixture, one metrics/report fixture, and one complex fixture:

- all positioned cards have positive width and height
- no positioned card has `NaN`, `Infinity`, or missing coordinates
- mapping nodes are horizontally between visible source and target schema cards in overview
- major cards in small fixtures do not overlap
- all cards fit within the rendered canvas bounds
- namespace-card geometry accounts for namespace-pill height rather than clipping the card header or fields
- detail-view columns are ordered source -> mapping -> target
- long names and notes do not overflow their parent card bounds in the tested viewport

### 5. Screenshot artifacts for human and VLM review

Add a deterministic screenshot workflow that runs as part of the local harness test process or as a separate Playwright project/script.

Required review shots:

- `sfdc-overview-single.png`
- `sfdc-detail-opportunity-ingestion.png`
- `namespaces-overview-lineage.png`
- `namespaces-detail-namespaced-mapping.png`
- `metrics-overview-lineage-all-files.png`
- `metrics-overview-file-filter-sources.png`
- `reports-overview.png`
- `filter-flatten-detail-completed-orders.png`
- `filter-flatten-detail-order-line-facts.png`
- `sap-po-layout-stability.png`

Each screenshot run should also write a small manifest, for example `screenshots/manifest.json`, containing:

- screenshot file name
- fixture path
- view mode (`single` or `lineage`)
- UI state (`overview`, `detail`, selected mapping, filter state)
- viewport size
- timestamp
- test name or script step name

The screenshots are not golden baselines. They are review artifacts. They should be easy to attach to a PR, annotate manually, or feed to a VLM with the manifest as visual context.

### 6. Documentation and workflow

Update the harness docs so contributors know:

- Playwright still runs through the sentinel watcher on local developer machines
- screenshot artifacts are intentionally produced for human review
- screenshots are not pixel-equality baselines
- how to find the screenshot output directory and manifest
- which fixtures are intentionally covered by the suite and why

---

## Non-Goals

- Pixel-perfect visual regression testing in CI.
- Replacing unit tests for `@satsuma/viz-backend` or `@satsuma/viz` layout helpers.
- Full browser matrix testing. Firefox-only remains acceptable unless the harness environment becomes more reliable across Chromium/WebKit.
- Running Playwright in GitHub Actions. This remains a local developer-machine workflow unless a later feature changes the browser environment story.
- Visual editing, drag-to-map, or authoring changes.

---

## Acceptance Criteria

1. The harness event recorder captures production `@satsuma/viz` event payloads for real UI interactions.
2. Synthetic event tests are removed or demoted to harness-recorder unit coverage; the main Playwright suite uses real clicks and hovers wherever practical.
3. Stable test hooks exist for mapping detail source/target cards, arrow rows, nested fields, field lineage buttons, coverage circles/ports, transform text, and section rows.
4. Playwright coverage includes both non-namespaced and namespaced fixtures, explicitly covering the namespace-pill card height path.
5. Playwright coverage includes vanilla schemas/mappings, metrics, report/model schemas, and a complex nested mapping with source joins and notes.
6. Automated assertions cover field coverage circles/ports and at least two real hover/highlight paths.
7. Automated assertions include geometry sanity checks for overview and detail views, without relying on full-image pixel comparison.
8. The local screenshot workflow emits named PNG artifacts and a manifest describing fixture, state, viewport, and test step.
9. README or package-level documentation explains how to run the expanded suite and where to find screenshot artifacts.
10. Relevant local checks pass:
    - `npm --prefix tooling/satsuma-viz run test`
    - `npm --prefix tooling/satsuma-viz-backend run test`
    - `npm --prefix tooling/satsuma-viz-harness run build`
    - Playwright via the existing sentinel watcher workflow
11. Compact card expansion in overview mode is covered by Playwright tests: initial collapsed state, expand on click, collapse on second click, canvas height grows after expansion, `navigate` event fires on expand.

---

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Deep shadow DOM makes real interactions brittle | Tests regress into synthetic event checks | Add targeted stable `data-testid` prefixes and small automation helpers that traverse shadow roots deliberately |
| ELK layout coordinates vary slightly | Geometry tests become flaky | Assert relative order, positive dimensions, and non-overlap tolerances rather than exact coordinates |
| Screenshot artifacts are mistaken for golden baselines | Review workflow becomes noisy | Document that screenshots are human-review artifacts and keep pass/fail logic in semantic assertions |
| The suite becomes too slow for local use | Contributors stop running it | Keep the main suite focused, put screenshot capture in a separate tagged project or script if needed |
| Canonical examples change | UI tests fail for legitimate fixture edits | Make assertions behaviour-oriented and update the fixture matrix when canonical examples evolve |
