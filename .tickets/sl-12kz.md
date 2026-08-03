---
id: sl-12kz
status: open
deps: []
links: []
created: 2026-08-03T12:24:14Z
type: epic
priority: 2
assignee: Thorben Louw
tags: [viz, field-lineage]
---
# Feature 40 — shared field lineage view

Field lineage is the only viz surface with no test surface. The renderer lives only in vscode-satsuma (560-line renderer + 284-line panel + 330-line CSS, zero tests); the traversal lives in satsuma-cli/src/commands/field-lineage.ts coupled to CLI-only modules, so no browser host can call it. See features/40-shared-field-lineage-view/PRD.md.

Outcome: one browser-portable traversal, one sz-field-lineage component rendered by BOTH the VS Code panel and the viz harness, and Playwright coverage for the lineage view.

