---
id: sl-hhdk
status: closed
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


## Notes

**2026-08-06T13:20:35Z**

## Notes

**2026-08-06T00:00:00Z**

Cause: this ticket asked for the harness to call the traversal in-browser on the field-lineage event and render the shared component with Playwright coverage -- sl-nswc (Feature 36, merged 2026-08-05) already wired the harness's "field-lineage" listener (src/client/app.ts:423) to buildFieldChain -> openFieldChain, and added seven Playwright specs in harness.test.ts/view-persistence.test.ts covering multi-hop chains, nl-derived hops, hop-click refocus, and edit-while-open reconciliation, all through the zero-network-request path.
Fix: closing as superseded, not implemented -- verified the listener wiring in app.ts and the "Field chain view" describe block in harness.test.ts directly. Two acceptance criteria this ticket also wanted (empty-upstream/-downstream states, unknown-field state) are partially covered (empty-direction case has a unit test) with the unknown-field gap carried forward in sv-embb. features/40-shared-field-lineage-view/PRD.md updated to Status: SUPERSEDED. (commit immediately after 9fe61674)
