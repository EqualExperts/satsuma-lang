---
id: sl-1f8o
status: open
deps: [sl-iwmd]
links: []
created: 2026-08-03T16:59:27Z
type: task
priority: 1
assignee: Thorben Louw
parent: gcsc-qka8
tags: [feature-39, r7, core]
---
# core: apply type-aware ESLint and CST-narrowing rules

PRD 39 R7. satsuma-core (tooling/satsuma-core/src, ~8800 lines) is the largest and most central package in the rollout and already has the narrowed CST type from R2 (tcc-e35f, closed). Add a tseslint.configs.recommendedTypeChecked block for tooling/satsuma-core/src/**/*.ts, then additionally enable @typescript-eslint/no-unnecessary-condition and @typescript-eslint/switch-exhaustiveness-check for this package now that node.type is SatsumaCstType rather than string. Configure switch-exhaustiveness-check to require exhaustiveness only for switches over domain discriminated unions (e.g. MetaEntry); do not require every intentionally partial switch over the 100-value CST union to be exhaustive — use the rule's allowDefaultCaseForExhaustiveSwitch/considerDefaultExhaustiveForUnions options or per-switch default clauses as the escape hatch, not a rule-level disable. Fix every finding at its boundary; no package-wide suppressions.

## Acceptance Criteria

recommendedTypeChecked plus no-unnecessary-condition and switch-exhaustiveness-check apply to tooling/satsuma-core/src/**/*.ts; lint passes with zero package-wide rule disables; a deliberately non-exhaustive switch over a domain discriminated union (e.g. FieldDecl-shaped or MetaEntry) is reported by ESLint, matching PRD acceptance test 17; an intentionally partial switch over SatsumaCstType/SatsumaGrammarSymbol is not forced to enumerate all 100 symbols; full satsuma-core test suite and npm run lint pass.

