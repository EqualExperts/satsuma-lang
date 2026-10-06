---
id: sl-oz1t
status: closed
deps: [sl-t7mg]
links: []
created: 2026-03-23T09:55:41Z
type: task
priority: 3
assignee: Thorben Louw
tags: [feature-16, lsp, vscode]
---
# LSP Phase 3: advanced (outline panel, breadcrumbs, code actions, lineage webview)

## Acceptance Criteria

Outline panel shows schemas/mappings/metrics hierarchy. Breadcrumbs work. Code actions for common fixes. Lineage visualization webview using satsuma graph.


## Notes

**2026-03-23T20:00:00Z**

Cause: Phase 3 required advanced VS Code extension features beyond the core LSP server.
Fix: Implemented full PRD Phase 2+3 scope across 3 commits:

Commit 1 — Server-side features:
- CodeLens: inline annotations on all block types (field counts, mapping usage, spread counts, source→target, metric sources)
- Rename Symbol: F2 workspace-wide rename with duplicate detection
- 17 new tests (142 total)

Commit 2 — Command palette + CLI integration:
- 9 commands: validate, lineage, where-used, warnings, summary, arrows, graph, field-lineage, coverage
- Shared CLI runner, custom LSP requests (satsuma/blockNames, satsuma/fieldLocations)

Commit 3 — Visualization + coverage:
- Workspace Graph webview (SVG DAG layout, namespace filter, click-to-navigate, auto-refresh on save)
- Field-Level Lineage webview (multi-hop chain tracing via satsuma arrows, NL badges)
- Mapping Coverage Heatmap (gutter decorations, status bar percentage)
- esbuild webview bundling
