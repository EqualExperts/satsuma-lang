---
id: sl-j30s
status: closed
deps: [sl-npi6]
links: []
created: 2026-07-31T13:14:15Z
type: task
priority: 1
assignee: Thorben Louw
parent: sl-iffm
tags: [feature-37, core, cli]
---
# core+cli: type-mismatch-direct-arrow lint rule

PRD 37 R1. Warn when an arrow classified none (bare src -> tgt, no transform body) connects two fields whose declared types differ. Arrows classified nl or nl-derived are exempt: a transform body may legitimately change type, and judging that is NL interpretation which the CLI leaves to agents.

## Design

Detector in @satsuma/core operating on core extraction types; lint-engine.ts registers a thin wrapper (Core vs Consumer rule — the LSP will mirror this diagnostic later). Normalization: case-insensitive base-token equality (parameterized lengths/precision ignored), extended by alias groups from the satsuma.config.yaml type mapping section (C1). Skip silently when either side lacks a declared type or is unresolvable (validate territory). Severity warning, not fixable. Message names both qualified field paths and both declared types so lint --json consumers can group by type-pair.

Value-map arrows need no special case, and this is decidable today (doc review 2026-07-31 — the PRD previously hedged). map_literal is a pipe_step (grammar.js:483-488) and classifyTransform returns "nl" for any non-empty pipe chain (satsuma-core/src/classify.ts:26-28), so an arrow bearing `map { ... }` always classifies nl and is already excluded by the none-only criterion. Do not add a map-literal branch to the rule. A regression test must lock this: a future refactor that classifies map literals separately would silently start type-checking value maps, which convert values and so may legitimately change type.

## Acceptance Criteria

Minimal-snippet tests in core: STRING to DATE bare arrow warns naming both fields and types; same arrow with any transform body does not warn; an arrow bearing a `map { ... }` value map between differently-typed fields does not warn (locks the classification reasoning above); String vs STRING and parameterized vs bare base token do not warn; missing declared type does not warn; alias group in config suppresses an otherwise-mismatching pair; the rule contains no map-literal special case; CLI-level tests cover registration, severity and --json shape only; all suites pass locally.


## Notes

**2026-08-03T17:52:28Z**

**2026-08-03T17:52:28Z**

Cause: A bare arrow asserts its value passes through unchanged, but nothing in the toolchain compared the two ends' declared types, so a STRING -> DATE copy-paste or a schema edit that outran its mappings survived until a human read that arrow.
Fix: Added detectTypeMismatches() in satsuma-core/src/lint-type-mismatch.ts — none-classified single-source arrows only, types compared on their upper-cased base token with lint.typeAliases groups layered on, silent on undeclared/unresolvable/ambiguous endpoints — plus a thin type-mismatch-direct-arrow wrapper in the CLI's lint-engine and a LintRuleContext carrying the config's alias groups to rules. 20 core tests lock the semantics including that value maps stay exempt through classification alone, with no map-literal branch. (commit immediately after acbb3b96)
