---
id: tcc-chls
status: in_progress
deps: [tcc-e35f]
links: []
created: 2026-08-03T14:38:22Z
type: task
priority: 1
assignee: Thorben Louw
parent: gcsc-qka8
tags: [feature-39, r2, viz-backend]
---
# viz-backend: migrate CST assembly to the generated contract

Implement the satsuma-viz-backend consumer portion of Feature 39 R2. Type its workspace indexing and VizModel assembly comparisons with the generated CST contract, including the Node/browser model-from-sources parser path.

## Design

Consume the core SyntaxNode/Tree contract through parser-utils. Route model-from-sources parser output through the audited adapter established by tcc-e35f, usable in both Node and browser hosts. Narrow local block-kind maps and symbol-selecting helper parameters to SatsumaGrammarSymbol without changing FieldDecl or VizModel fields that merely happen to be named type.

## Acceptance Criteria

model-from-sources uses the audited typed parser boundary in both Node and browser hosts; parser-utils re-exports the typed core node/tree and symbol-aware helpers; workspace-index and viz-model direct CST comparisons, switch labels, lookup maps, and symbol selector parameters compile against SatsumaGrammarSymbol or SatsumaCstType as appropriate; unrelated VizModel and FieldDecl type strings remain semantically unchanged; no arbitrary CST casts are introduced; a removed referenced grammar symbol fails the package typecheck; all viz-backend tests and existing source-to-model parity coverage pass.
