---
id: bsw-a2zk
status: open
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-sweep-2026-10, vscode, viz]
---
# vscode: Explorer "Overview Visualization" ignores the right-clicked file

`package.json` contributes `satsuma.showViz` to `explorer/context` for `.stm`/`.satsuma` (sl-e40u), but the handler at `tooling/vscode-satsuma/src/extension.ts:72` takes no URI argument and `VizPanel.refresh()` (`src/webview/viz/panel.ts:104-113`) uses only the active editor or the last URI. Right-clicking a file that is not open shows "Open a .stm file to see its mapping visualization", or the previously viewed file.

## Acceptance Criteria

- The command uses the URI passed from the Explorer when present; unit test on the command logic.
