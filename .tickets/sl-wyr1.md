---
id: sl-wyr1
status: closed
deps: []
links: []
created: 2026-06-09T20:43:00Z
type: epic
priority: 1
assignee: Thorben Louw
---
# Feature 32: viz light mode & VS Code theme integration

Make light and dark first-class themes for the mapping viz, driven by the VS Code colour theme with live switching. Single palette source of truth in tokens.css. See features/32-viz-light-mode/PRD.md


## Notes

**2026-06-09T21:16:48Z**

All six phases complete: Phase 1 tokenize (8f5752c, pre-existing), Phase 2 component theme property (sl-o05i), Phase 3 VS Code integration + live switching (sl-go45), Phase 4 harness light mode + server query fix (sl-wxac), Phase 6 Playwright + both-theme gallery (sl-7b29). Plus two fixes surfaced by the work: missing buy-to-om-order fixture (sl-dknl) and edge-layer theme-inheritance defect. Full Playwright suite green (61 passed); satsuma-viz (47) and vscode-satsuma viz-integration (8) unit suites green. Remaining manual step: VS Code Extension-Host GUI verification of live theme switching (cannot run in agent sandbox).
