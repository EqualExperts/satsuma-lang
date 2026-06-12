---
id: sl-padl
status: open
deps: []
links: []
created: 2026-06-12T08:53:17Z
type: task
priority: 2
assignee: Thorben Louw
---
# LSP: false duplicate-definition for reopened namespace blocks

Opening examples/namespaces/ns-platform.stm in VS Code shows:

  Namespace 'analytics' is already defined in .../examples/namespaces/namespaces.stm:93  satsuma(duplicate-definition)

ns-platform.stm imports from namespaces.stm, so both files are in the open file's import closure (scoping per sl-rw3e is working correctly). The false positive comes from the LSP semantic-index adapter: the workspace index registers each namespace_block as a definition entry (kind "namespace", needed for go-to-definition), and buildSemanticIndex in tooling/satsuma-lsp/src/semantic-diagnostics.ts derives duplicate records from ANY name with multiple definition entries.

But reopening a namespace is legal Satsuma (features/15-namespaces): the CLI index-builder merges reopened namespace blocks across files and never calls checkDuplicate for namespace names — it only emits namespace-metadata conflicts for disagreeing notes. The LSP adapter must match: namespace-kind definition entries must be excluded from duplicate derivation.

Acceptance criteria:
- Opening a file whose import closure contains the same namespace reopened in multiple files/blocks produces NO duplicate-definition diagnostic for the namespace name.
- Duplicate detection for schemas/fragments/mappings/metrics/transforms is unchanged (existing tests stay green).
- Regression test added in tooling/satsuma-lsp/test/semantic-diagnostics.test.js covering a reopened namespace across two files in the same closure.

