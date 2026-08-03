---
id: tcc-yb3z
status: in_progress
deps: [tcc-e35f]
links: []
created: 2026-08-03T14:38:22Z
type: task
priority: 1
assignee: Thorben Louw
parent: gcsc-qka8
tags: [feature-39, r2, lsp]
---
# lsp: migrate concrete CST nodes to the generated contract

Implement the satsuma-lsp consumer portion of Feature 39 R2. Preserve the concrete web-tree-sitter Node APIs needed by editor features while narrowing their type discriminant once and compiling every LSP CST comparison against the generated symbol contract.

## Design

The audited boundary belongs in parser-utils, which already owns LSP parser and navigation adaptation. Model the typed concrete node without weakening descendantForPosition, query capture, parent, and child APIs. Core helper wrappers accept SatsumaGrammarSymbol. Do not scatter assertions through hover, completion, definition, rename, semantic-token, diagnostic, or symbol handlers.

## Acceptance Criteria

LSP parser output and query-capture nodes cross one documented parser-utils narrowing boundary; the LSP's concrete node type preserves required web-tree-sitter methods while exposing SatsumaCstType recursively; child/children and equivalent helper parameters use SatsumaGrammarSymbol; every direct CST comparison and switch label in LSP handlers compiles against the generated contract, while LSP protocol discriminants remain unchanged; no arbitrary CST casts are introduced outside the audited adapter; an invalid referenced grammar symbol fails the LSP typecheck; all 299-or-current LSP tests pass with focused parser-utils and recovery coverage updated.
