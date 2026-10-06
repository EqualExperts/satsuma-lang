---
id: sl-2e4z
status: closed
deps: []
links: []
created: 2026-03-23T09:55:40Z
type: task
priority: 3
assignee: Thorben Louw
tags: [feature-16, lsp, vscode]
---
# LSP Phase 1: core server (semantic tokens, fold ranges, document symbols, diagnostics)

## Acceptance Criteria

Node.js LSP server using vscode-languageserver + tree-sitter. File-level features: semantic tokens, fold ranges, document symbols, live diagnostics from satsuma validate. Extension activates and connects.


## Notes

**2026-03-23T15:00:00Z**

All Phase 1 features complete. Third commit adds semantic diagnostics:
- ✅ Semantic diagnostics — `satsuma validate --json` runs on save, results merged with parse diagnostics
- New `validate-diagnostics.ts` module: shells out to CLI, parses JSON output, maps to LSP Diagnostics
- Server wires `onDidSave` → `runValidate` → merged diagnostics (parse + validate)
- Extension passes configurable `satsuma.cliPath` to server via initializationOptions
- `satsuma.cliPath` setting added to package.json contributes.configuration
- 6 new tests (62 total LSP tests passing)
- Graceful fallback: if CLI not found, parse diagnostics still work

**2026-03-23T13:00:00Z**

Progress: Second commit on feat/lsp-phase1 (906765c). Added semantic tokens + hover. 5 of 7 Phase 1 features now complete. 56 LSP tests passing.

Completed features:
- ✅ Document symbols (outline panel with all block types, nested fields)
- ✅ Parse-error diagnostics (ERROR/MISSING nodes, //! warnings, //? info)
- ✅ Code folding (all block types matching folds.scm)
- ✅ Semantic tokens (highlights.scm → LSP SemanticTokenTypes with definition modifiers, multi-line support, dedup)
- ✅ Hover (block summaries, field type/metadata/parent, tag descriptions, spread resolution, arrow paths)

Remaining for sl-2e4z:
1. **Semantic diagnostics** — shell out to `satsuma validate --json` on save for workspace-level warnings (undefined schemas, duplicate names, missing imports). This is the only remaining item before this ticket can close.

Deferred to sl-t7mg (Phase 2):
- Go-to-definition (uses locals.scm, requires workspace index)
- Find references (workspace-aware)

## Architecture reference for next agent

- **Branch**: `feat/lsp-phase1` — worktree at `.worktrees/feat/lsp-phase1/`
- **Server source**: `tooling/vscode-satsuma/server/src/` — one file per provider:
  - `server.ts` — connection setup, capability registration, document lifecycle, handler wiring
  - `parser-utils.ts` — tree-sitter singleton, CST→LSP helpers (nodeRange, child, children, labelText, stringText)
  - `diagnostics.ts` — parse-error + comment diagnostics (ERROR/MISSING nodes, //!, //?)
  - `symbols.ts` — document symbols/outline
  - `folding.ts` — fold ranges
  - `semantic-tokens.ts` — runs highlights.scm query, maps captures to LSP token types (singleton Query)
  - `hover.ts` — contextual markdown hover (walks CST ancestors to find hover target)
- **Client**: `tooling/vscode-satsuma/src/extension.ts` — thin LSP client, starts server via IPC
- **Build**: `npm run build` (esbuild bundles client+server), `cd server && npx tsc` (for test dist/)
- **Tests**: `tooling/vscode-satsuma/server/test/*.test.js` — Node built-in `node:test`, import from `../dist/`, parse with tree-sitter directly (no mocking)
- **Run tests**: `cd tooling/vscode-satsuma && npm run test:lsp` or `cd server && npm test`
- **Full check**: `cd tooling/vscode-satsuma && npm run check` (manifest + grammar + TextMate tests + LSP tests)
- **PRD**: `features/16-vscode-language-server/PRD.md` — see §1.1 for semantic diagnostics acceptance criteria

## Implementation guidance for semantic diagnostics

The PRD §1.1 specifies: run `satsuma validate --json` on save (not on keystroke) and surface results as LSP diagnostics. Key considerations:
- Use `child_process.execFile` to run `satsuma validate --json <file>` on `documents.onDidSave`
- Parse JSON output and map to LSP Diagnostic objects with appropriate severities
- Workspace-level warnings: undefined schemas, duplicate names, missing imports, broken import paths
- Debounce or cancel in-flight validate calls if the user saves rapidly
- Handle missing `satsuma` CLI gracefully (warn once, don't spam)
- The existing `computeDiagnostics` (parse errors) runs on every keystroke; semantic diagnostics from validate should merge with those, not replace them
- Tests should mock/stub the CLI subprocess — don't shell out in unit tests

**2026-03-23T11:15:00Z**

Progress: First PR merged (feat/lsp-phase1, PR #47). Delivered LSP server scaffold with 3 of 7 Phase 1 features. 26 unit tests. Architecture established: one file per provider, esbuild bundles client+server, tests use Node built-in test runner.
