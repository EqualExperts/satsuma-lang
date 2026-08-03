---
id: sl-1f8o
status: closed
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


## Notes

**2026-08-03T17:28:29Z**

Cause: satsuma-core (the largest and most CST-central package) had no type-aware ESLint coverage, and no-unnecessary-condition/switch-exhaustiveness-check hadn't been enabled anywhere despite R2 narrowing core's CST type.
Fix: added recommendedTypeChecked + the two CST-narrowing rules for tooling/satsuma-core/src/**/*.ts, then fixed all 67 findings at their boundary across cst-utils.ts, extract.ts, format.ts, import-reachability.ts, nl-ref.ts, parse-errors.ts, parser.ts, spread-expand.ts, and validate.ts (dead `Map<string, unknown>` casts, non-null assertions replaced with real narrowing, one genuinely dead fallback branch in hasListOfKeyword removed, two dead `if (!index.fieldArrows)` guards removed). Three real behavior regressions surfaced only by running the actual test suites (not just tsc/lint), all the same shape — a type declares a field required but a real caller (test doubles across satsuma-core and satsuma-cli, built with `as any`) passes a partial object anyway: cst-utils.ts's null-filtering in child/children/allDescendants/walkDescendants (namedChildren), validate.ts's checkFieldTypeParens (FieldDecl.type), and nl-ref.ts's resolveRef bare-identifier/dotted-field branches (MappingContext.sources/targets). Reverted the defensive code in each case and used justified inline suppressions instead of deleting real behavior. All 607 core tests, 1003 cli tests, 300 lsp tests, 186 viz-backend tests, full-repo lint, and tsc pass. (commit immediately after 056dfcba)
