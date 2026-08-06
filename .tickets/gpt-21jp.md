---
id: gpt-21jp
status: open
deps: []
links: []
created: 2026-08-06T13:44:29Z
type: task
priority: 1
assignee: Thorben Louw
parent: gpt-uazn
tags: [feature-46, testing, lsp]
---
# lsp: scenario adapter, and definition/references duality (R3)

satsuma-lsp is the only consumer package with no dependency on @satsuma/scenario-gen; its 26 test files are all fixture-driven. Three of its features are inverse relations over ground truth the generator already states, so they need no new oracle — only an adapter. references.ts and rename.ts both delegate to workspace-index.ts (resolveDefinition, findReferences, resolveReferenceKey), so one adapter reaches all three.

## Design

Add tooling/satsuma-lsp/test/support/generated-workspace.ts: render a generated workspace to in-memory documents, build a WorkspaceIndex, expose position lookup for a declared entity or a usage site. The adapter is as much the deliverable as the properties — it is the first generated suite in the LSP. Deliberately NOT reused from the CLI: the CLI adapter writes to disk and loads an import graph, the LSP indexes a folder of in-memory documents, and sl-rw3e exists precisely because those two scope duplicates differently — a shared adapter would hide the defect class this feature targets. Properties over workspaceScenarioArbitrary, including the namespaced and multi-file domains where the reference key is not the authored spelling: references(decl) is exactly the declared usage sites; definition(usage) is the declaration for every usage; duality (x in references(d) iff definition(x) = d); includeDeclaration toggles exactly the declaration site.

## Acceptance Criteria

Mutation check: making resolveReferenceKey return the authored spelling instead of the canonical name makes the duality property fail, and the counterexample names a namespaced usage site missing from references. Run and recorded in the closing note. The adapter is documented with a module comment stating what it owns and why it is not shared with the CLI's.

