---
id: sl-6osm
status: closed
deps: [sl-0dy0]
links: []
created: 2026-08-03T16:59:55Z
type: task
priority: 1
assignee: Thorben Louw
parent: gcsc-qka8
tags: [feature-39, r7, vscode]
---
# vscode-satsuma: apply type-aware ESLint

PRD 39 R7. vscode-satsuma (tooling/vscode-satsuma/src, ~3300 lines) has no CST dependency (it delegates language intelligence to satsuma-lsp) and is the last package in the R7 rollout, landing after its lsp/core/viz dependencies are already clean. Add a tseslint.configs.recommendedTypeChecked block for tooling/vscode-satsuma/src/**/*.ts (parserOptions.projectService against tooling/vscode-satsuma/src/tsconfig.json). Fix every finding at its boundary; no package-wide suppressions. This completes PRD 39 R7 across core, LSP, viz-backend, viz-model, viz, and VS Code.

## Acceptance Criteria

recommendedTypeChecked applies to tooling/vscode-satsuma/src/**/*.ts; lint passes with zero package-wide rule disables; full vscode-satsuma test suite (34 tests) and npm run lint pass; webview message-guard behaviour (sl-b90g) is unaffected.

## Notes

**2026-08-03T20:00:00Z**

Cause: `commands/warnings.ts`, `commands/summary.ts`, and `commands/validate.ts` parsed
`satsuma` CLI subprocess JSON as untyped `any`, which both hid real type errors from
`no-unsafe-*` and a live bug: `warnings.ts` read a `row` field the CLI had already
renamed to `line` (1-indexed), so `item.row ?? 0` always fell back to 0 and every
warning/question diagnostic silently jumped to line 0 instead of its real line.
`summary.ts` separately assumed a `note` field on mappings/fragments/transforms/metrics
that the CLI never emits (only schemas carry one) and read `data.files` where the CLI
emits `fileCount`, so those sections rendered without their real detail and the file
count line never printed.
Fix: added `tseslint.configs.recommendedTypeChecked` for `tooling/vscode-satsuma/src/**/*.ts`
(excluding the four `@ts-nocheck` webview entry scripts, out of scope here), then fixed
every finding at its boundary — typed the three CLI JSON envelopes against their real
shapes (`warnings-logic.ts`, `summary-logic.ts`, inline in `validate.ts`), fixed the
row/line bug and the summary field mismatches, replaced non-null assertions with the
established capture-into-local pattern, and marked `client.start()` in `extension.ts`
with `void`. Extracted the warnings/summary parsing and formatting into pure
`*-logic.ts` modules (mirroring `coverage-logic.ts`) with 12 new unit tests covering
the line-number conversion and the corrected field shapes. This completes PRD 39 R7
across core, LSP, viz-backend, viz-model, viz, and VS Code. (commit immediately after 5530f7d6)

