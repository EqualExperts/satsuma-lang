---
id: bsw-a2zk
status: closed
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

## Notes

**2026-10-06T10:24:11Z**

Cause: The `satsuma.showViz` handler took no argument, and `VizPanel.refresh()` chose only between the active Satsuma editor and the last file shown, so the URI the Explorer passes was dropped.
Fix: The handler forwards a passed Satsuma file URI through `createOrShow` to `refresh`, which picks its target with the new pure `chooseVizTargetUri` (requested, then active editor, then last file), unit-tested in viz-target.test.js. The menu gesture itself cannot be driven by any existing harness; filed bsw-e2vh (commit immediately after 11034219)
