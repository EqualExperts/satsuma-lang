---
id: sl-v3w5
status: open
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

