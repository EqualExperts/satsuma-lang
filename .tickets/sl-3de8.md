---
id: sl-3de8
status: open
deps: [sl-ce11]
links: [sl-9p2t, sl-46wr, sl-csrs]
created: 2026-07-31T13:13:41Z
type: epic
priority: 1
assignee: Thorben Louw
tags: [feature-36, viz]
---
# Feature 36 epic: viz coverage overlay and field chain view

Implement features/36-viz-coverage-and-chain-view/PRD.md: a paint-only coverage overlay on the viz overview, uncovered-field treatment in cards and detail views, and a chain view rendering one field's full upstream/downstream lineage. Depends on feature 35 for the core coverage function (sl-gsxu) and the core aggregate rollup (sl-4qvp) — not on the whole of feature 35. Doc review 2026-07-31 split the aggregation so this feature's overlay work runs in parallel with feature 35's CLI command rather than behind it; the per-ticket deps carry that, so treat the epic-level dep as informational. Open questions resolved by user review 2026-07-31: playground exposure deferred to a separate future feature (roadmap note); wide fans collapse by namespace with expand-on-click; the component accepts host-supplied models so VS Code reuses the LSP computation instead of shipping a second one in the webview bundle.

