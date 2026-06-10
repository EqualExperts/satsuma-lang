---
id: sl-tw0r
status: open
deps: []
links: []
created: 2026-06-10T22:04:48Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [viz, vscode]
---
# vsix overview: expand arrow on a source card navigates to source code instead of expanding

(Issue d) In the VS Code overview visualization, clicking the expand/collapse arrow on a source schema card jumps to the source code (the editor opens the .stm file and the view loses focus) instead of expanding the card like in the viz harness.

Root cause: _onHeaderClick in tooling/satsuma-viz/src/components/sz-schema-card.ts:781-786 conflates two actions — it toggles _collapsed AND dispatches a navigate event for the schema location on every header click (the toggle arrow at line 591 sits inside the header div whose @click is _onHeaderClick, sz-schema-card.ts:587). In the harness the navigate event has no document-opening listener so only the toggle is visible; in VS Code, webview/viz/viz.ts:16 forwards navigate to the extension which opens the document, so navigation wins.

Fix direction: separate the click targets — the toggle arrow (.header-toggle) should toggle only (stopPropagation), while clicking the title/name navigates. Review the compact-card path too (sz-compact-toggled event, parent-owned compact-expanded property) so overview compact cards expand without navigating.

## Acceptance Criteria

In the VS Code overview, clicking the arrow expands/collapses the card and does not open the source file; clicking the card title still navigates. Behavior matches the viz harness. Playwright harness test covers toggle-without-navigate.

