---
id: sl-nswc
status: open
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

