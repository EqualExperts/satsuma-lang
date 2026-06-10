---
id: sl-akz6
status: closed
deps: []
links: []
created: 2026-06-10T21:52:05Z
type: bug
priority: 1
assignee: Thorben Louw
external-ref: gh-274
tags: [lsp, windows, diagnostics]
---
# LSP duplicate schema/src false positives: workspace files indexed under two URI representations on Windows

GitHub issue #274 (user kiaroa, v0.8.0): in VS Code on Windows, schema/src declarations that are valid per 'satsuma validate' are flagged as duplicate definitions across files in the same repo.

Root cause (user-traced, confirmed plausible in code): the same file gets indexed under two different URI strings, so every definition in it is counted twice and trips core duplicate detection.

- tooling/satsuma-lsp/src/server.ts:488-489 — the initial workspace scan indexes files under pathToFileURL(filePath).toString(), which on Windows yields 'file:///C:/...' (uppercase drive).
- tooling/satsuma-lsp/src/server.ts:141,159,205 — didOpen/didChange/watched-file events index under the client-supplied document URI, which VS Code sends as 'file:///c%3A/...' (lowercase drive, percent-encoded colon).
- indexFile (tooling/satsuma-viz-backend/src/workspace-index.ts:291) keys strictly by URI string and removeFile only clears the exact same key, so the two representations coexist as separate indexed files.
- computeSemanticValidationDiagnostics (tooling/satsuma-lsp/src/semantic-diagnostics.ts:72) then builds the semantic index over the whole wsIndex; buildSemanticIndex detects duplicates by counting definitions per name, so each opened file's definitions appear twice → 'duplicate schema'/'duplicate namespace src' diagnostics.

Fix direction: canonicalize file URIs at every index boundary (one normalization helper in viz-backend's workspace-index used by indexFile/removeFile and the server's scan/didOpen/didChange/watched handlers) — normalize drive-letter case and percent-encoding to a single canonical form. This is shared-core logic per the Core vs Consumer rule, so it belongs in viz-backend/core, with tests covering 'file:///C:/...' vs 'file:///c%3A/...' equivalence.

Also assess while in there: the global wsIndex is not import-scoped when handed to buildSemanticIndex; verify scoping is not a second contributor to the false positives the user describes (defined once standalone and again via each importing file).

## Acceptance Criteria

On Windows-style URI variation (drive letter case, percent-encoded colon), a file opened in the editor produces no duplicate-definition diagnostics for names it defines once. Unit tests exercise both URI forms mapping to one index entry. Repro from gh-274 (multi-file repo with namespace src imported by several mapping files) is clean while 'satsuma validate' stays clean too.


## Notes

**2026-06-10T22:23:45Z**

Cause: the workspace index keyed files by raw URI string. On Windows the startup scan indexes under pathToFileURL's spelling (file:///C:/...) while didOpen/didChange index under the client's spelling (file:///c%3A/...), so an opened file existed twice in the index and every definition in it was counted as a duplicate (gh-274).
Fix: added canonicalizeFileUri() to viz-backend's workspace-index (decode percent-escapes, lowercase Windows drive letter, re-encode via WHATWG URL; browser-safe) and applied it in indexFile/removeFile/walkImportGraph/resolveImportUri; the LSP's semantic-diagnostics adapter canonicalizes the query URI and resolved import URIs so diagnostics match across spellings. Regression tests in viz-backend (uri-canonicalization.test.js) and satsuma-lsp (semantic-diagnostics.test.js).
