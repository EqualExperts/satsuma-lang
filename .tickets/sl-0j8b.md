---
id: sl-0j8b
status: closed
deps: []
links: []
created: 2026-09-29T07:27:22Z
type: bug
priority: 2
assignee: Thorben Louw
external-ref: gh-542
tags: [lsp, vscode]
---
# lsp+vscode: //? questions never reach the Problems panel (gh-542)

From GitHub issue #542. A BA wants `//?` open questions listed in VS Code's Problems panel so the data engineers see them.

## Root cause

`tooling/satsuma-lsp/src/diagnostics.ts` (`walkComments`, question_comment branch, ~line 85) publishes `//?` at `DiagnosticSeverity.Hint` with `DiagnosticTag.Unnecessary`. The Problems panel lists only Error, Warning and Information. Hints show only as a faint ellipsis, and the Unnecessary tag greys the comment out, which is the opposite of "very visible".

This is a regression. The Feature 16 PRD (`archive/features/16-vscode-language-server/PRD.md:123,128`) specified Information "so they appear in the Problems panel". Commit b14d1464 (2026-03-24) switched it to Hint and added the `TODO: ` prefix. The module doc-comment (diagnostics.ts:20) and `tooling/vscode-satsuma/README.md:80` still describe Information.

A second gap: the LSP only publishes comment diagnostics for **open** documents (`sendMergedDiagnostics`; `onDidClose` clears them). The workspace-wide route is the `Satsuma: Show Warnings` command, which runs `satsuma warnings <entry> --json` without `--questions` and hard-codes Warning severity (`tooling/vscode-satsuma/src/commands/warnings.ts:16,37`). So even after the severity fix, a question in a file nobody has opened stays invisible.

`//!` is fine: published as Warning.

## Approach

1. LSP: publish `//?` at `DiagnosticSeverity.Information`, drop `DiagnosticTag.Unnecessary`. A bare `//?` gets a descriptive fallback message from a named constant, alongside `EMPTY_WARNING_COMMENT_MESSAGE` (an empty message makes vscode's Diagnostic constructor throw; see sl-sme1). Consider "Question: " over "TODO: " to match the spec's wording. Add a comment citing the Feature 16 PRD and gh-542 so this is not reversed again silently.
2. Show Warnings: also run with `--questions`; publish `//?` as Information and `//!` as Warning. Its info messages count both ("No warnings found." is wrong when only questions exist).
3. Decide how the LSP's diagnostics and the `satsuma-warnings-cmd` collection overlap for open files (`//!` already appears twice today). De-duplicate, or record the decision in the code.
4. Out of scope: a severity setting, and automatic workspace-wide publishing of comment diagnostics by the LSP. Note the latter as a possible follow-up if the command proves not enough.

## Acceptance Criteria

- `computeDiagnostics` returns `//?` (trailing and standalone) at Information (3) with no `Unnecessary` tag. Rewrite the existing "reports question comments as Hint severity with TODO prefix" test in `tooling/satsuma-lsp/test/diagnostics.test.js`; its purpose comment cites gh-542.
- A bare `//?` produces the named fallback message (not merely non-empty — `"TODO: "` already is).
- `warnings-logic.ts` unit tests cover the severity mapping and grouping for mixed warnings and questions.
- After running `Satsuma: Show Warnings`, `//?` comments from files that are not open appear in Problems at Information; `//!` stays Warning.
- Overlap between the two diagnostic sources is resolved or documented.
- diagnostics.ts doc-comment and vscode-satsuma README match the behaviour; CHANGELOG Unreleased entry.
- Manual VS Code check (native Problems panel, so Playwright does not apply): questions listed with the info icon, including closed files after Show Warnings.
- `turbo run test --filter=@satsuma/lsp` and `--filter=vscode-satsuma` pass.

## Notes

**2026-10-06T00:00:00Z**

Cause: b14d1464 moved `//?` diagnostics from Information to Hint with the Unnecessary tag, which VS Code leaves out of the Problems panel. Show Warnings already received questions from the CLI (its default output mixes both kinds) but published them all as Warning, because the JSON items carried no per-item kind.
Fix: LSP publishes `//?` at Information, untagged. `satsuma warnings --json` labels each item with `kind`; Show Warnings maps it to Warning/Information and withholds a file's results while it is open, since the LSP reports open files (overlap decision, documented in warnings.ts). Message wording moved to core `commentDiagnosticMessage` so both routes agree. (commit 34ace8b0, merged as PR #597)

**2026-10-06T14:00:00Z**

Manual check done by Thorben Louw on a VSIX built from main: `//?` questions are listed in the Problems panel, and the gh-542 behaviour is fixed. Closing. (commit immediately after 986b7d08)
