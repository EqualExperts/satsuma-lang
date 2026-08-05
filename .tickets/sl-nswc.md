---
id: sl-nswc
status: closed
deps: [sl-5m9x, sl-twe8, sl-4czz, sl-iwlv]
links: []
created: 2026-07-31T13:13:41Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-3de8
tags: [feature-36, viz, testing]
---
# harness: Playwright spec suite for coverage overlay and chain view

PRD 36 R5. New Playwright specs in tooling/satsuma-viz-harness covering: coverage toggle on/off, badge values against a known-coverage fixture, uncovered-field treatment, chain view for a field with at least 2 upstream and 2 downstream hops including one nl-derived hop, hop-click refocus, and edit-while-in-chain-view state preservation.

## Design

Runs only via the sentinel-file watcher protocol (agent sandbox cannot launch browsers): human starts watch-and-test.sh, agent touches .run-tests and reads .playwright-results.txt. Include the layout-snapshot comparison proving coverage-mode toggling does not change card geometry.

## Acceptance Criteria

All new specs pass and the full existing harness suite remains green via the watcher protocol; layout snapshot test in place; results confirmed from .playwright-results.txt.


## Notes

**2026-08-05T14:44:06Z**

**2026-08-05T14:41:00Z**

Cause: PRD 36 R5's harness Playwright suite didn't exist yet, and sz-chain-view.ts's own unit tests could only prove the rendering function's logic — the click path (a field row's lineage icon -> real chain view), the harness's own host wiring from "field-lineage" event to openFieldChain, and the real per-hop DOM addressability were all unverified in a browser. While building the fixture for the "≥2 upstream/≥2 downstream, nl-derived" requirement, found that sz-chain-view.ts's hop testids collided (direction+depth only) whenever a column held more than one ungrouped hop below the namespace-fan threshold — invisible to the existing unit tests because they only do substring matching on serialized templates, never a real DOM query.
Fix: added seven new Playwright specs (harness.test.ts + view-persistence.test.ts) covering coverage-toggle on/off with badge values matching `satsuma coverage --json`, a coverage-mode layout-snapshot, chain-view rendering against examples/namespaces/ns-merging.stm (the only corpus fixture with a genuine multi-mapping fan on both sides), hop-click refocus, mapping-label navigation, and edit-while-in-chain-view preservation/fallback. Wired the harness's own "field-lineage" listener to `buildFieldChain` -> `openFieldChain` (previously it only recorded the event) so the real click path is exercised end-to-end. Fixed the testid collision in sz-chain-view.ts by appending a sanitized field-path suffix, with a new unit test pinning per-hop testid uniqueness. Full harness suite (114 tests) green via the watcher protocol; `run-repo-checks.sh` green. (commit immediately after b0e23830)
