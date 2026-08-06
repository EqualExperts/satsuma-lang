---
id: sl-v3w5
status: closed
deps: [sl-prlp]
links: []
created: 2026-08-03T12:24:35Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-12kz
tags: [viz, field-lineage]
---
# Add sz-field-lineage Lit component to satsuma-viz

Port the 560-line VS Code DOM renderer (vscode-satsuma/src/webview/field-lineage/field-lineage.ts) to a Lit component in satsuma-viz, alongside the other sz-* components. It takes a FieldLineageResult and renders the upstream and downstream chains.

The existing renderer has no tests, so parity cannot be checked against anything automated -- capture screenshots of the live VS Code panel first and use them as the visual reference.

## Acceptance Criteria

- sz-field-lineage renders upstream and downstream chains from a FieldLineageResult.
- Every chain entry carries a data-testid following the sz-schema-card pattern so Playwright can address it.
- All colours come from tokens.css; the component renders correctly in light and dark.
- Defined states for: no upstream, no downstream, unknown field, and a cyclic chain.
- Unit/DOM tests cover each of those states.


## Notes

**2026-08-06T13:20:35Z**

## Notes

**2026-08-06T00:00:00Z**

Cause: this ticket asked for a new sz-field-lineage Lit component, but Feature 36's sz-chain-view (tooling/satsuma-viz/src/components/sz-chain-view.ts, sl-4czz) already is that component -- a shared, tested, browser-portable field lineage renderer with data-testid attributes throughout, rendering FieldChainModel from @satsuma/core's traceFieldLineage/buildFieldEdges via viz-backend's buildFieldChainFromWorkspace (no second traversal copy). Building sz-field-lineage as scoped would have created exactly the renderer duplication Feature 40 exists to prevent.
Fix: closing as superseded, not implemented. features/40-shared-field-lineage-view/PRD.md updated to Status: SUPERSEDED and moved to archive/features/. Two real residual gaps found during verification (unknown-field state not distinguished from no-lineage; cyclic-chain rendering untested above the core traversal layer) are carried forward in sv-embb. (commit immediately after 9fe61674)
