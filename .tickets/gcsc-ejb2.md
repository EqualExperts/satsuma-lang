---
id: gcsc-ejb2
status: closed
deps: []
links: []
created: 2026-08-03T14:13:02Z
type: task
priority: 1
assignee: Thorben Louw
parent: gcsc-qka8
tags: [feature-39, r1, grammar, core]
---
# grammar: generate the CST symbol contract

Implement Feature 39 R1. Add a deterministic grammar-owned generator over src/node-types.json and track its public TypeScript output under satsuma-core/src/generated/. Export named kinds, anonymous tokens, their grammar-symbol union, the recovery-aware CST type, and readonly symbol constants. Refresh the artifact during grammar generation and add a check-only stale-artifact gate.

## Design

The generator belongs to tree-sitter-satsuma because that package owns node-types.json. It writes the normal artifact into satsuma-core but supports an explicit output path so the stale check can generate in a temporary directory and compare without modifying tracked files. Both generator and generated module document why ERROR is added while MISSING remains represented by isMissing. R2 owns changing SyntaxNode and consumers to use these types.

## Acceptance Criteria

A deterministic generated module contains exactly the 60 named kinds and 39 anonymous symbols from node-types.json; it exports SatsumaNamedKind, SatsumaAnonymousToken, SatsumaGrammarSymbol, SatsumaCstType including ERROR, and readonly constants; record, list_of, enum, and slice are present; grammar generation refreshes the tracked artifact; a check-only command fails on stale output and passes on a clean tree; focused generator tests validate classification, deterministic ordering/output, the ERROR recovery exception, and stale detection; core exports the public contract; relevant grammar/core tests and repository checks pass.

## Notes

**2026-08-03T14:31:46Z**

Cause: CST node types crossed parser-backed package boundaries as unchecked strings, so grammar renames and misspellings compiled while silently disabling matching branches.
Fix: Added grammar-owned deterministic CST contract generation, tracked core exports, and non-mutating freshness gates in local checks and CI (commit 11152b60).
