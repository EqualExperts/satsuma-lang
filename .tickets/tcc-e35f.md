---
id: tcc-e35f
status: open
deps: [gcsc-ejb2]
links: []
created: 2026-08-03T14:37:47Z
type: task
priority: 1
assignee: Thorben Louw
parent: gcsc-qka8
tags: [feature-39, r2, core, parser]
---
# core: enforce generated CST symbols at parser boundaries

Implement the foundational core portion of Feature 39 R2. Make the shared CST node/tree contract recovery-aware and generated-symbol-typed, add the single audited narrowing boundary from web-tree-sitter parser output, and migrate core CST helpers and comparisons away from unchecked strings.

## Design

Import the R1 contract into core's public SyntaxNode and Tree types. Preserve web-tree-sitter's concrete runtime objects while isolating the unavoidable assertion in the parser adapter; extraction and formatting modules must not cast around the contract. Navigation helpers accept SatsumaGrammarSymbol, while recovery handling continues to name ERROR explicitly and missingness continues through isMissing. This ticket defines the adapter API consumed by the package migrations.

## Acceptance Criteria

SyntaxNode.type is SatsumaCstType and its child/parent properties recursively use the same typed interface; the public Tree root is typed; one documented core parser adapter narrows web-tree-sitter output and no extraction use site performs an arbitrary CST cast; child, children, allDescendants, formatter helpers, and other symbol-selecting core helpers accept SatsumaGrammarSymbol; every direct core CST comparison and switch compiles against the generated contract with ERROR handling explicit; a compile-time regression test proves an invalid or removed referenced symbol is rejected while adding a symbol does not impose exhaustive handling on partial walkers; existing and new core/parser tests pass.
