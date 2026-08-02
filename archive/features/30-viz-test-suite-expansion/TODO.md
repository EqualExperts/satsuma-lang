# Feature 30 TODO

PRD: [PRD.md](./PRD.md)

This TODO breaks Feature 30 into implementation tasks that should be mirrored in
`tk` tickets when picked up. Each task should include `.tickets/` changes in the
commit that implements it.

## Task Breakdown

Epic: `sl-0jva` - Feature 30: viz test suite expansion

### 1. Audit current harness coverage and selector gaps (`sl-0ssj`)

Document the current `tooling/satsuma-viz-harness/test/harness.test.ts`
coverage and the renderer selectors needed to replace synthetic event tests
with real interactions.

Scope:

- list each current Playwright test and whether it asserts real UI behaviour,
  synthetic event plumbing, ready state, or layout smoke coverage
- identify missing selectors in `tooling/satsuma-viz/src/` for mapping detail
  source/target cards, nested field rows, coverage circles/ports, transforms,
  `each`/`flatten` rows, and notes
- identify which canonical fixture should own each new behaviour case
- decide whether any small harness-only fixtures are needed

Acceptance criteria:

- audit notes are added to the implementing ticket or to a short docs note in
  the feature folder
- every planned Playwright test maps to a fixture and a user-visible invariant
- no synthetic-only event test remains as the recommended implementation path

PRD reference:

- Problem
- Scope / Stable test hooks for deep rendered content
- Scope / Fixture matrix

### 2. Fix the harness event recorder contract (`sl-tzx6`)

Update the harness recorder so `window.__satsumaHarness.events` captures real
production event payloads emitted by `@satsuma/viz`.

Scope:

- normalize `navigate` events from `SzNavigateEvent.location`
- normalize `field-hover` events from `SzFieldHoverEvent.schemaId` and
  `SzFieldHoverEvent.fieldName`
- normalize `field-lineage` events from `SzFieldLineageEvent.schemaId` and
  `SzFieldLineageEvent.fieldName`
- normalize `open-mapping`, `expand-lineage`, and `export` event payloads as
  needed
- preserve compatibility with `CustomEvent.detail` only where it is genuinely
  still used
- add focused tests for the normalization helper if the logic is factored out

Acceptance criteria:

- a real click on a schema/field records a non-empty `navigate` event
- a real field-lineage button click records schema ID and field name
- existing harness event log consumers still read a stable JSON object shape

PRD reference:

- Scope / Harness event contract
- Acceptance Criteria 1 and 2

### 3. Add renderer test hooks for mapping detail and field coverage (`sl-eikr`)

Add stable selectors and attributes needed for high-value Playwright assertions
without relying on brittle deep shadow DOM queries.

Scope:

- give mapping detail source and target schema cards distinct `testIdPrefix`
  values
- add stable test IDs for mapping detail source, mapping, and target columns
- add stable test IDs for `each` and `flatten` section rows
- expose field coverage state through a selector or attribute on the port/circle
  element (`mapped` vs `unmapped`)
- ensure nested field rows include enough identity to distinguish dotted paths
  such as `customer.email` from another `email`
- add test IDs for transform text and highlighted `@ref` spans if current
  selectors are not sufficient

Acceptance criteria:

- Playwright can locate a specific source field, target field, coverage
  indicator, arrow row, and transform in mapping detail without manual event
  dispatch
- selector names are stable and based on normalized schema/field/mapping IDs
- package-local `@satsuma/viz` tests are updated where selector rendering is
  already covered

PRD reference:

- Scope / Stable test hooks for deep rendered content
- Scope / Field coverage and highlighting

### 4. Replace synthetic event tests with real interaction tests (`sl-j4pw`)

Rewrite the event-oriented harness tests to interact with the actual UI.

Scope:

- click a real schema header or field row and assert a `navigate` event payload
- click a real field lineage button and assert a `field-lineage` event payload
- hover a real field row and assert `field-hover`
- click a real arrow row and assert a navigation event
- keep only a small recorder-level unit test for synthetic/custom event
  compatibility if needed

Acceptance criteria:

- the main Playwright suite no longer passes purely by dispatching synthetic
  `CustomEvent` objects from `<satsuma-viz>`
- real UI interaction failures produce actionable Playwright assertions
- every new `test()` block opens with a purpose comment per repo test standards

PRD reference:

- Scope / Automated Playwright coverage / Interaction events
- Acceptance Criteria 1 and 2

### 5. Expand overview coverage across fixture families (`sl-3c2w`)

Add overview tests for non-namespaced, namespaced, metrics, reports, and larger
fixtures.

Scope:

- `sfdc-to-snowflake/pipeline.stm`: assert vanilla schema and mapping overview
  content in single-file mode
- `namespaces/ns-platform.stm`: assert namespaced cards and mapping nodes render
  with qualified IDs and namespace labels
- `metrics-platform/metrics.stm`: assert metric cards and imported source cards
  render in lineage mode
- `reports-and-models/pipeline.stm`: assert report/model card metadata is visible
- `sap-po-to-mfcs/pipeline.stm`: assert larger overview reaches ready state and
  passes geometry sanity checks

Acceptance criteria:

- overview tests cover both namespace and non-namespace card height paths
- metrics and reports are explicitly asserted, not only incidentally loaded
- larger fixture test checks more than `data-ready-state="ready"`

PRD reference:

- Scope / Fixture matrix
- Scope / Automated Playwright coverage / Overview rendering

### 6. Add mapping detail coverage for canonical mappings (`sl-ny3r`)

Add detail-view assertions for representative mappings.

Scope:

- `opportunity ingestion` in `sfdc-to-snowflake/pipeline.stm`:
  - expected source schemas and target schema
  - expected arrow rows (`amount_usd`, `arr_value`, `pipeline_stage`,
    `is_closed`, `ingested_at`)
  - computed arrows and map transform
  - transform text and highlighted `@ref` spans
- one namespaced mapping in `namespaces/ns-platform.stm`:
  - namespace label
  - qualified source and target names
  - detail column ordering
- `completed orders` in `filter-flatten-governance.stm`:
  - multiple sources
  - source join text
  - mapping note
  - nested child fields
  - governance/PII indicators where visible
- `order line facts` in `filter-flatten-governance.stm`:
  - `flatten` section row
  - nested source child fields
  - target rows `line_number`, `sku`, `quantity`, and `line_total`

Acceptance criteria:

- detail tests verify content inside the detail view, not only that the detail
  root is visible
- complex mapping coverage includes nested child records, notes, and sources
  with joins
- tests stay fixture-grounded and avoid duplicating VizModel unit tests

PRD reference:

- Scope / Automated Playwright coverage / Mapping detail rendering

### 7. Add field coverage and highlighting tests (`sl-cca6`)

Assert the visual contracts that make mapping detail useful.

Scope:

- mapped target fields show mapped coverage indicators
- unmapped target fields show unmapped coverage indicators
- hovering an arrow row highlights the matching source and target field rows
- hovering a source field highlights the arrow row and mapped target field
- hovering a target field highlights upstream source fields
- nested field paths are matched by dotted path, not only leaf field name

Acceptance criteria:

- at least one non-nested mapping and one nested mapping are covered
- field coverage indicators are asserted through stable selectors or attributes
- hover assertions validate visible state, not only event-log entries

PRD reference:

- Scope / Automated Playwright coverage / Field coverage and highlighting

### 8. Add filter and lineage-mode tests (`sl-xqd5`)

Cover toolbar filtering and import-reachable model differences.

Scope:

- namespace filter on `ns-platform.stm`:
  - select one namespace such as `mart`
  - assert unrelated namespace cards are hidden
  - reset to all namespaces
- file filter on `metrics-platform/metrics.stm` in lineage mode:
  - show all files
  - select `metrics.stm`
  - select `metric_sources.stm`
  - reset to all files
- single-file vs lineage mode:
  - assert an imported-source card appears only in lineage mode for a chosen
    fixture

Acceptance criteria:

- filters are exercised through real toolbar controls
- tests wait on the viz ready state after each filter/mode transition
- assertions are based on visible cards and mapping nodes

PRD reference:

- Scope / Automated Playwright coverage / Filters and lineage mode

### 9. Add geometry sanity helpers and tests (`sl-e80e`)

Create reusable Playwright helpers for layout sanity assertions.

Scope:

- read positioned-card bounding boxes from the viz shadow root
- assert positive dimensions and finite coordinates
- assert small-fixture cards do not overlap beyond a small tolerance
- assert overview mapping nodes sit horizontally between source and target
  schema cards
- assert detail columns are ordered source -> mapping -> target
- assert cards fit within the canvas bounds for the tested viewport
- assert namespace card content is not clipped by namespace-pill height

Acceptance criteria:

- geometry helpers are reusable and documented in the test file
- geometry tests avoid exact ELK coordinates
- at least one non-namespaced, one namespaced, one metrics/report, and one
  complex fixture are covered

PRD reference:

- Scope / Automated Playwright coverage / Geometry sanity

### 10. Add screenshot review workflow (`sl-mm7v`)

Add a deterministic screenshot script or Playwright project that emits named
review artifacts and a manifest.

Scope:

- capture the required PRD screenshot list:
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
- write `screenshots/manifest.json` with fixture path, view mode, UI state,
  viewport, timestamp, and test/script step name
- keep screenshot artifacts out of normal source control unless a later ticket
  deliberately adds curated reference images
- document how a human should mark up screenshots and feed them back to a VLM
  as visual requirements

Acceptance criteria:

- screenshot workflow can run through the local watcher or a documented package
  script
- generated file names are deterministic
- screenshots are review artifacts, not golden pass/fail baselines

PRD reference:

- Scope / Screenshot artifacts for human and VLM review
- Acceptance Criteria 8 and 9

### 11. Update harness docs (`sl-gfo4`)

Update developer-facing documentation for the expanded suite.

Scope:

- update README viz harness section or add a package-level harness README
- document the existing sentinel watcher workflow with absolute-path reminder
- document the fixture matrix and why each fixture exists in the suite
- document screenshot output directory and manifest shape
- clarify that Playwright remains local-only and not part of GitHub Actions

Acceptance criteria:

- a contributor can run the tests and screenshot workflow from docs alone
- docs distinguish automated assertions from human-review screenshots
- docs mention the known browser limitation that keeps Firefox as the default
  local browser target

PRD reference:

- Scope / Documentation and workflow
- Non-Goals

### 12. Verification and cleanup (`sl-zowz`)

Run the relevant package checks and close any incidental breakage introduced by
the expanded suite.

Scope:

- run `npm --prefix tooling/satsuma-viz run test`
- run `npm --prefix tooling/satsuma-viz-backend run test`
- run `npm --prefix tooling/satsuma-viz-harness run build`
- run Playwright through the existing sentinel watcher workflow
- inspect screenshot artifacts manually before closing the feature
- update TODO checkboxes and ticket notes with root cause/fix summaries as
  tasks complete

Acceptance criteria:

- all relevant automated tests pass locally
- Playwright result output is captured in `.playwright-results.txt`
- screenshot artifacts and manifest exist for the required review states
- no unrelated generated artifacts are staged

PRD reference:

- Acceptance Criteria 10

## Suggested Dependency Order

1. Audit current harness coverage and selector gaps
2. Fix the harness event recorder contract
3. Add renderer test hooks for mapping detail and field coverage
4. Replace synthetic event tests with real interaction tests
5. Expand overview coverage across fixture families
6. Add mapping detail coverage for canonical mappings
7. Add field coverage and highlighting tests
8. Add filter and lineage-mode tests
9. Add geometry sanity helpers and tests
10. Add screenshot review workflow
11. Update harness docs
12. Verification and cleanup

Tasks 5 through 9 can be parallelized after tasks 2 and 3 land, as long as each
ticket owns disjoint test cases or coordinates shared helper changes explicitly.
