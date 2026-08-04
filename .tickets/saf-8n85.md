---
id: saf-8n85
status: open
deps: []
links: []
created: 2026-08-04T20:51:43Z
type: bug
priority: 2
assignee: Thorben Louw
parent: saf-dmvx
tags: [site, vscode]
---
# Reconcile 'Interactive Visualization: 3 Webview Panels' section in site/vscode.njk with real implementation

tooling/vscode-satsuma has 4 webview panel implementations (viz, field-lineage, lineage, schema-lineage); 'lineage' (LineagePanel) is dead code never imported anywhere. The site's 3-webview showcase names Workspace Graph, Field-Level Lineage, and Mapping Coverage as its three -- but Mapping Coverage is gutter decorations + status bar (zero createWebviewPanel calls, confirmed by the page's own earlier Commands section calling it exactly that). The real third live webview, SchemaLineagePanel (opened by 'Show Lineage From...' / satsuma.showLineage), is never mentioned in that section. See PRD Finding F.

## Acceptance Criteria

site/vscode.njk's Interactive Visualization section describes the three real, live, command-reachable webviews (Workspace Graph, Field-Level Lineage, Schema Lineage) and no longer presents Mapping Coverage as a webview panel there. The dead LineagePanel code (tooling/vscode-satsuma/src/webview/lineage/) is either wired up to a command or removed -- flag as a follow-up ticket if removal is out of scope here, but at minimum the site copy must stop being wrong.

