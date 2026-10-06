---
id: bsw-e2vh
status: open
deps: []
links: [bsw-a2zk]
created: 2026-10-06T10:45:00Z
type: task
priority: 3
assignee: Thorben Louw
tags: [bug-sweep-2026-10, vscode, testing]
---
# vscode: no extension-host test can drive a command from the Explorer or editor menus

bsw-a2zk fixed `satsuma.showViz` ignoring the URI the Explorer's context menu passes. The precedence rule now lives in `src/webview/viz/viz-target.ts` and is unit-tested, but nothing proves the gesture end to end: right-click a closed `.stm` file in the Explorer, choose "Overview Visualization", and see that file in the panel. The viz Playwright harness mounts the web component only; it has no VS Code host, menus or command arguments. The package has no `@vscode/test-electron` (or similar) suite at all, so every command-argument and menu-contribution behaviour is verified by hand.

## Acceptance Criteria

- Decide whether an extension-host test suite is proportionate for this package (cost in CI time and flakiness against the menu and command wiring it would cover).
- If yes: a suite that runs in CI and covers at least `satsuma.showViz` invoked with an Explorer URI for a file that is not open.
