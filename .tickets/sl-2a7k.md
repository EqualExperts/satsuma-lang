---
id: sl-2a7k
status: in_progress
deps: []
links: [sl-vmqv]
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

