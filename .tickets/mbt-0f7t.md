---
id: mbt-0f7t
status: open
deps: [mbt-pumv]
links: []
created: 2026-08-04T11:08:48Z
type: task
priority: 2
assignee: Thorben Louw
parent: mbt-5l7g
---
# R3: Verify vscode-satsuma extension packaging survives workspace hoisting

vsce/extension packaging is sensitive to node_modules layout (hoisted vs nested), and this is the one package where that risk is concrete rather than hypothetical. After R2 lands, confirm vscode-satsuma still builds (npm run build) and packages correctly under the hoisted workspaces node_modules layout, and that the existing cli-pack-smoke-test-style global install check still passes.

## Acceptance Criteria

- vscode-satsuma builds successfully (client + server + webview) under the workspaces-hoisted node_modules
- Extension packages correctly (vsce package or equivalent) with all expected files bundled into the .vsix
- Existing vscode-extension CI job (fixture/golden tests, validate, build) passes unchanged
- Any packaging breakage found is fixed before this ticket closes -- R2 is not considered done until this passes

