---
id: sl-hhdk
status: open
deps: [sl-v3w5, sl-prlp]
links: []
created: 2026-08-03T12:24:35Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-12kz
tags: [viz-harness, field-lineage]
---
# Surface field lineage in the viz harness and cover it with Playwright

The harness already receives the field-lineage event (src/client/app.ts:423) and only logs it. Make it call traceFieldLineage in-browser against the library-backed workspace it already assembles, and render sz-field-lineage.

Must not introduce a server round-trip: playground-static.test.ts asserts editing/opening/saving complete with ZERO network requests, and that guarantee has to hold.

## Acceptance Criteria

- Clicking a field's lineage icon in the harness renders the lineage view.
- A Playwright test asserts the rendered upstream/downstream entries for a known fixture field that has both directions populated.
- Empty-upstream, empty-downstream and unknown-field states each have a test.
- The zero-network-request assertion in playground-static.test.ts still passes.
- The lineage view is captured light and dark in the screenshots project.

