---
id: sl-kap8
status: in_progress
deps: []
links: []
created: 2026-08-03T11:35:29Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [viz-harness, tooling, agent-workflow]
---
# Viz harness watcher runs a stale bundle: watch-and-test.sh bypasses the pretest build

watch-and-test.sh runs 'npx playwright test' directly. The harness package rebuilds only via the npm 'pretest' hook ('npm run build'), which npx bypasses entirely. So the sentinel workflow documented in CLAUDE.md (touch .run-tests) exercises whatever is already in tooling/satsuma-viz-harness/dist/ -- not the current source.

Observed today on a clean main: dist/client/satsuma-viz.js was dated 14 Jul while tooling/satsuma-viz/dist/satsuma-viz.js was dated 3 Aug. The harness bundle did not contain the string 'data-coverage-state' at all, even though sz-schema-card.ts has emitted that attribute since PR #430 (coverage-via-core, ADR-042). A full 127-test run reported green against that three-week-old bundle.

Impact: the harness's green result is not evidence about current code, and it is silently not evidence -- nothing in the output says the bundle is stale. Every agent following the documented sentinel workflow inherits this. It also invalidates the harness as a gate for exactly the recent viz work it should be covering (coverage rendering, field lineage).

playwright.config.ts compounds it: webServer runs 'node dist/server.js', so a stale server binary is served too.

## Acceptance Criteria

- The sentinel workflow rebuilds before running: watch-and-test.sh invokes 'npm test' (which fires pretest -> build), or runs 'npm run build' explicitly before 'npx playwright test'.
- Build failures are surfaced in .playwright-results.txt rather than silently falling through to a stale-bundle run.
- .playwright-results.txt records what was built (e.g. the build step's output), so a reader can tell a fresh run from a stale one.
- CLAUDE.md's viz-harness section states that the watcher rebuilds, so no agent assumes it must rebuild by hand.
- Verified by touching a string in tooling/satsuma-viz/src and confirming it reaches the browser in the next sentinel-triggered run without any manual build.

