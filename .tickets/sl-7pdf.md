---
id: sl-7pdf
status: open
deps: []
links: []
created: 2026-06-10T07:19:14Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-ubbp
tags: [viz, playground]
---
# Export SVG: honest label, real download, self-contained output (R5)

Export button (satsuma-viz.ts:1145, _exportSvg) dispatches an export event that the playground only records for Playwright (app.ts:415-417) — clicking does nothing visible; the generated SVG also uses unresolved var(--sz-*) references (satsuma-viz.ts:1274-1298). User decision 2026-06-10: keep export, relabel 'Export SVG', make it work. See PRD P5/R5.

## Acceptance Criteria

Button reads 'Export SVG'; playground click downloads the SVG client-side (Blob/anchor, nothing leaves the browser); exported SVG resolves all var() to literal theme colours and renders standalone; VS Code save path unchanged; Playwright test asserts download of well-formed SVG with no 'var(' occurrences and the new label.

