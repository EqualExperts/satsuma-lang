---
id: sl-6m5k
status: closed
deps: []
links: []
created: 2026-06-11T02:42:20Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, viz]
---
# viz: SVG export interpolates schema names unescaped, producing invalid XML

satsuma-viz/src/satsuma-viz.ts:1391 — _exportSvg builds the file with raw template interpolation of node ids into <text> elements. Backtick names legally contain & < > (grammar backtick_name), so a schema named `P&L <quarterly>` produces an exported SVG no XML parser will open. Proven by repro.

## Acceptance Criteria

All user-controlled strings XML-escaped in SVG export; exported file parses as XML with hostile names; test.


## Notes

**2026-06-11T20:52:19Z**

Cause: _exportSvg built the SVG with raw template interpolation of node ids into <text> elements; backtick names containing & < > produced invalid XML.
Fix: extracted document construction into pure buildExportSvg and escape authored names via new escapeXml; tests include a strict well-formedness check over a hostile 'P&L <quarterly>' name (commit 2ff500c)
