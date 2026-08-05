---
id: sl-iwlv
status: closed
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


## Notes

**2026-08-05T11:35:30Z**

## Notes

**2026-08-05T00:00:00Z**

Cause: VS Code's viz panel had no way to feed the chain view a host-computed FieldChainModel — the only field-tracing entry point (`satsuma.traceFieldLineage`) shelled out to the CLI and rendered a separate, now-superseded lineage webview instead of reusing the LSP-computed model the panel already loads (PRD 36 open question 3, REUSE).

Fix: split viz-backend's browser-only field-chain builder into a host-neutral `buildFieldChainFromWorkspace` (mirroring the existing `computeFullLineage` split) plus the browser wrapper; added an LSP `satsuma/fieldChain` request on top of it; wired the VS Code viz panel to request a chain and call the component's `openFieldChain`; rewired `satsuma.traceFieldLineage` onto that path and deleted the superseded CLI-driven field-lineage webview; added `satsuma.showVizCoverage` as a discoverable entry point for the coverage overlay, which needed no new host computation since the panel's existing full-lineage model already self-computes matching numbers (ADR-042). (commit immediately after 77c6ad02)
