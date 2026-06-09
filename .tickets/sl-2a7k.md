---
id: sl-2a7k
status: closed
deps: []
links: []
created: 2026-06-09T22:02:56Z
type: bug
priority: 1
assignee: Thorben Louw
external-ref: gh-265
---
# CLI crashes on Windows: dynamic import() needs file:// URL

satsuma CLI fails to start on Windows. index.ts:75 passes a raw OS path (join(__dirname, cmd) -> 'C:\...\commands\summary.js') to a dynamic import(). Node's ESM loader rejects bare drive-letter specifiers (ERR_UNSUPPORTED_ESM_URL_SCHEME, protocol 'c:'); absolute specifiers must be file:// URLs. POSIX absolute paths are tolerated, so the bug never surfaced on macOS/Linux. Crash fires on the first loop iteration before any command runs, so 'satsuma' with no args dies.

## Acceptance Criteria

Command modules are imported via a file:// URL (pathToFileURL) on all platforms; no platform branching; regression test pins the file:// invariant; existing CLI integration tests still pass.


## Notes

**2026-06-09T22:09:25Z**

**2026-06-09T22:10:00Z**

Cause: index.ts passed a raw OS path (join(__dirname, cmd)) to dynamic import(); Node ESM rejects bare drive-letter specifiers on Windows (ERR_UNSUPPORTED_ESM_URL_SCHEME, protocol c:). POSIX tolerated it, so it never surfaced on macOS/Linux.
Fix: extracted commandModuleSpecifier() in command-loader.ts wrapping the path with pathToFileURL().href; index.ts imports command modules via that file:// URL. Added command-loader.test.ts pinning the file:// invariant.

**2026-06-09T22:13:19Z**

**2026-06-09T22:25:00Z**

Folded a second, independent Windows bug into the same PR (#268): satsuma-lsp/validate-diagnostics.ts built file:// URIs via string concat (\"file://\" + encodeURI(path)), malformed for Windows drive paths so validate diagnostics never matched the open document. Replaced with pathToFileURL(); exported pathToFileUri and added round-trip regression coverage.
