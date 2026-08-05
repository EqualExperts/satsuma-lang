---
id: vcv-n42k
status: closed
deps: []
links: []
created: 2026-08-05T11:48:06Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [feature-36, viz-harness, bug]
---
# harness: overview schema-card testid prefix collides with header-count span, doubling card-count assertions

sl-5m9x (feat(viz): add overview coverage overlay) gave the schema card's header-count span a data-testid built from the same prefix as the card's own testid (`overview-schema-card-<id>-header-count`). Every Playwright locator that selects cards via an untagged `[data-testid^='overview-schema-card-...']` prefix match now also matches that inner span, doubling exact-count assertions (4 expected, 8 received) and producing a false card/span 'overlap' in the geometry suite.

## Acceptance Criteria

npx playwright test in tooling/satsuma-viz-harness (via the sentinel watcher) is fully green; fixed locators are tag-qualified to sz-schema-card rather than the testid renamed, since several passing tests already rely on the shared testid prefix to find a card's own descendants.


## Notes

**2026-08-05T11:48:21Z**

## Notes

**2026-08-05T00:00:00Z**

Cause: commit 9c24c45b (sl-5m9x, "feat(viz): add overview coverage overlay") added `data-testid=${this.testIdPrefix}-header-count` to the schema card's header-count/coverage-badge span. That testid shares the `overview-schema-card-<id>` prefix with the card's own testid, so every harness locator that selected cards via an untagged `[data-testid^='overview-schema-card-...']` prefix match started also matching that inner span — doubling exact `toHaveCount` assertions (4→8, 1→2) and producing a false card/span "overlap" in the geometry sanity suite. 7 tests failed under the sentinel watcher.

Fix: tag-qualified every affected card-selecting locator to `sz-schema-card[data-testid^='overview-schema-card-...']` — the same technique an adjacent, already-passing test in harness.test.ts used for an identical class of bug — across editor.test.ts, harness.test.ts (including the shared `readOverviewCardBoxes` helper and the "Compact card expansion" describe block), and open-save.test.ts. Left the component's testid naming and the tests that intentionally rely on the shared prefix to find a card's own descendants (`-field-*`, `-namespace-pill`, etc.) unchanged. Full harness suite (103 tests) now green via the sentinel watcher. (commit immediately after c605c75e)
