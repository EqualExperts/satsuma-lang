---
id: sl-2a7k
status: closed
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


## Notes

**2026-06-10T02:15:00+01:00**

Cause: index.ts passed a raw OS path from join(__dirname, cmd) to dynamic import(); Node's ESM loader reads a Windows drive letter as a URL scheme (ERR_UNSUPPORTED_ESM_URL_SCHEME), so the CLI died before any command ran. POSIX absolute paths are tolerated, hiding the bug on macOS/Linux.
Fix: commandModuleSpecifier() in src/command-loader.ts builds the specifier with pathToFileURL — a file:// URL on every platform, no branching — with regression tests pinning the file:// invariant, round-trip, and percent-encoding. Shipped in PR #268; gh-265 closed (commit 47cc171). Ticket was left in_progress after the merge; closing now.
