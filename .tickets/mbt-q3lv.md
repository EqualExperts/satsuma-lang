---
id: mbt-q3lv
status: closed
deps: []
links: []
created: 2026-08-04T16:46:52Z
type: bug
priority: 3
assignee: Thorben Louw
---
# viz-harness watcher test 'runs npm test so the pretest build output is recorded' is flaky

tooling/satsuma-viz-harness/scripts/watch-and-test.test.mjs intermittently fails its first case with 'The input did not match the regular expression /run passed/. Input: <empty>'. Observed 1 failure in 3 consecutive runs on macOS. The watcher polls for the sentinel every second and the test waits 5s (RESULT_WAIT_TIMEOUT_MS) polling every 25ms, so a slow first iteration can time out before the fake npm's output lands in .playwright-results.txt. Pre-existing: reproduced with no changes to the watcher or the test. Neither run-repo-checks.sh nor CI runs this suite, so it only bites someone invoking it by hand.

## Acceptance Criteria

The test either waits on a deterministic signal instead of a fixed 5s budget, or its timeout accounts for the watcher's 1s poll interval; 20 consecutive runs pass


## Notes


**2026-10-06T09:01:33Z**

Closed as obsolete. The watcher and its test (tooling/satsuma-viz-harness/scripts/watch-and-test.mjs and watch-and-test.test.mjs) were deleted on 2026-08-10 when the harness moved to headless Chromium (commit ec46db7d), so there is nothing left to deflake.
