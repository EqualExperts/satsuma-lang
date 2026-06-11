---
id: sl-jar4
status: closed
deps: []
links: []
created: 2026-06-11T02:43:30Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-hunt, vscode]
---
# vscode: VizPanel concurrent refreshes can overwrite newer model with stale data

vscode-satsuma/src/webview/viz/panel.ts — onDidSaveTextDocument and onDidChangeActiveTextEditor watchers plus manual refresh can trigger overlapping loadFullLineageModel calls; there is no generation counter or cancellation, so a slow earlier response can postMessage after a newer one and the webview renders stale data.

## Acceptance Criteria

Refresh requests are serialized or stamped with a generation id; stale responses discarded; unit test for out-of-order completion.


## Notes

**2026-06-11T21:40:25Z**

Cause: onDidSaveTextDocument/onDidChangeActiveTextEditor watchers and manual refresh could trigger overlapping loadFullLineageModel calls with no generation counter or cancellation, so a slow earlier response could postMessage after a newer one.
Fix: Added RefreshGate (pure latest-wins generation counter, unit-tested for out-of-order completion); refresh() stamps each load and drops superseded results and errors; expandLineage() drops expansions whose base model was replaced mid-flight. (commit dd63394)
