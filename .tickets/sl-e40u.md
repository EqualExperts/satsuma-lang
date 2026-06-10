---
id: sl-e40u
status: open
deps: []
links: []
created: 2026-06-10T22:04:54Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [vscode, ux]
---
# vsix: editor context menu lacks a recognizable 'Satsuma: Overview Visualisation' entry

(Issue e) User expects the editor right-click context menu to offer the Overview Visualisation — the equivalent of the eye icon in the editor title bar — and reports it missing.

Triage: tooling/vscode-satsuma/package.json already contributes satsuma.showViz to editor/context (when editorLangId == satsuma, group satsuma) since commit a369815 (2026-03-26), and the eye icon (editor/title) runs the same command. The entry is titled 'Satsuma: Show Mapping Visualization' although VizPanel opens in OVERVIEW mode — so either (a) the menu item is present but unrecognizable under that title, or (b) the when-clause fails for the user (e.g. file not associated with the satsuma language).

Fix direction: retitle the command (or add a distinct entry) to 'Satsuma: Overview Visualisation' so it matches what it opens; verify the editor/context when-clause fires for .stm files in the packaged vsix; consider an explorer/context entry for .stm files as well.

## Acceptance Criteria

Right-clicking in a .stm editor shows a context-menu entry clearly named for the Overview Visualisation which opens the same view as the eye icon. Command palette and eye tooltip use the same accurate title.

