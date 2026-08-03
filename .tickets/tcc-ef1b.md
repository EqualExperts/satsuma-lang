---
id: tcc-ef1b
status: open
deps: [tcc-e35f]
links: []
created: 2026-08-03T14:38:22Z
type: task
priority: 1
assignee: Thorben Louw
parent: gcsc-qka8
tags: [feature-39, r2, cli]
---
# cli: migrate CST use sites to the generated contract

Implement the satsuma-cli consumer portion of Feature 39 R2 after the typed core boundary lands. Remove the CLI's parallel unchecked CST declarations, consume the core node/tree contract, and migrate CLI navigation helpers and direct CST symbol comparisons.

## Design

CLI file I/O remains in tooling/satsuma-cli/src/parser.ts, but parser output must enter through the audited adapter API established by tcc-e35f. Re-export shared core types instead of maintaining structural copies. Distinguish actual CST node types from unrelated domain fields named type so the migration stays semantically scoped.

## Acceptance Criteria

CLI SyntaxNode and Tree usages consume the shared core contract rather than a string-typed clone; parseFile and parseSource use the audited parser adapter without use-site casts; cst-query and other local symbol-selecting helpers accept SatsumaGrammarSymbol; direct CST comparisons and switch labels across CLI commands compile against the generated union, with domain model type fields left unchanged; a generated-symbol rename/removal affecting a CLI use site produces a compile failure; focused parser/query tests and the full CLI test suite pass.
