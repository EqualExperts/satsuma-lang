---
id: sl-iwlv
status: open
deps: [sl-5m9x, sl-4czz]
links: []
created: 2026-07-31T13:13:41Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-3de8
tags: [feature-36, vscode, lsp]
---
# vscode: feed host-computed coverage and chain models to the viz webview

PRD 36 open question 3, resolved REUSE in user review: the VS Code extension supplies coverage and chain models computed via the LSP/core path to the webview component, instead of bundling a second computation in the webview. Add commands/entry points to open coverage mode and trace a field from the editor.

## Acceptance Criteria

Webview panels show coverage overlay and chain view using host-supplied models; values match CLI output for the same workspace; extension commands exposed and tested; vscode-satsuma test suite passes locally.

