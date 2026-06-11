---
id: sl-th5k
status: closed
deps: []
links: []
created: 2026-06-11T02:41:29Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, lsp]
---
# lsp: stale cross-file validate diagnostics never invalidated

satsuma-lsp/src/server.ts:163-176 — on save only validateDiagCache.delete(event.document.uri) runs; entries cached for OTHER files from a previous validate run are never removed when the new run no longer reports them. Fixing in file A an error attributed to file B leaves B diagnostic frozen until B itself is saved. The adjacent comment ("clear stale entries for files no longer reporting") describes behaviour the code does not implement.

## Acceptance Criteria

After a save, files no longer reporting diagnostics get them cleared (publish empty); cross-file fix test.


## Notes

**2026-06-11T13:11:30Z**

Cause: onDidSave deleted only the saved file's validateDiagCache entry; cross-file diagnostics cached for other files in the validated closure were never removed when a new run stopped reporting them, freezing them client-side until that file was saved.
Fix: new pure reconcileValidateCache() in validate-diagnostics.ts clears cached entries for in-scope (import-reachable) files absent from the new run and returns them; the save handler republishes every touched file, with an explicit empty publish for cleared files that are not open. Entries outside the closure stay.
