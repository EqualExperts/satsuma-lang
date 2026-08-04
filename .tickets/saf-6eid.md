---
id: saf-6eid
status: closed
deps: []
links: []
created: 2026-08-04T21:25:27Z
type: task
priority: 2
assignee: Thorben Louw
parent: saf-dmvx
tags: [site, vscode, redesign]
---
# Redesign vscode.njk around user workflows, not LSP internals

Replace the 'Core LSP Features' feature-inventory grid and the internals-flavoured stats bar with workflow-oriented sections (review without reading raw syntax, catch mistakes before a PR, see the whole workspace, trace a field, know what's mapped, navigate a big spec like code). This also resolves saf-8n85: the redesigned Interactive Visualization section will correctly describe the 3 real live webviews (Workspace Graph, Field-Level Lineage, Schema Lineage) instead of miscounting Mapping Coverage as one of them.

## Acceptance Criteria

vscode.njk no longer has a flat feature-capability grid; content is organized by user workflow. The visualization section names only real webviews. Screenshot gaps are flagged in the PR description for the project owner to fill.


## Notes

**2026-08-04T21:32:47Z**

## Notes

**2026-08-04T00:00:00Z**

Cause: the page described the LSP as an internals inventory (Syntax
Highlighting / Diagnostics / Navigation / IntelliSense / Document Structure /
Format Document / CodeLens feature cards, plus a stats bar counting raw LSP
capabilities and webview panels) rather than explaining what a user actually
gets from installing it. On review with the project owner, decided this
needed a structural rewrite, not a fact-fix: reorganise around workflows
(read a mapping without knowing the grammar, catch mistakes before a PR, see
the workspace then drill into a mapping, trace a schema's or a field's
lineage, know what's mapped) so the extension's value is legible to a
non-technical reviewer, not just an internals list for engineers.
Fix: replaced the "Core LSP Features" / "Interactive Webviews" sections with
workflow-oriented content; correctly names the 3 real live webviews
(Workspace Graph + Mapping Detail as one panel, Field-Level Lineage, Schema
Lineage via "Show Lineage From...") instead of miscounting Mapping Coverage
(gutter markers, not a webview) as one of three -- this also resolves the
webview-count discrepancy saf-8n85 tracked. Put a previously-unused
screenshot (vscode-src-example.webp, showing CodeLens + syntax highlighting
+ Find References) to use for the first time. Flagged 4 further screenshot
opportunities to the project owner (diagnostics/squiggles in action, the
Field-Level Lineage webview, the Schema Lineage webview, and Mapping
Coverage gutter markers + status bar) for a follow-up pass
(commit immediately after 1518bacf).
