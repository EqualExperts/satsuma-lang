---
id: sl-mg63
status: closed
deps: []
links: []
created: 2026-06-11T02:41:29Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [bug-hunt, lsp]
---
# lsp: satsuma/vizFullLineage silently omits files not open in the editor

satsuma-lsp/src/server.ts:348-364 — the handler resolves each import-reachable URI via the trees map, which is populated ONLY by documents.onDidChangeContent (open editors). The workspace scan (indexWorkspaceFolder:485) and watched-file handler (:189-211) parse files but discard the trees. The VS Code extension sends the request without opening imports, so "full transitive lineage" only contains files the user happens to have open — contradicting the handler contract and its own unit test, which fakes a fully populated trees map.

## Acceptance Criteria

vizFullLineage parses unopened import-reachable files (from disk or retained trees); integration test with a closed imported file appearing in lineage.


## Notes

**2026-06-11T13:19:38Z**

Cause: the satsuma/vizFullLineage handler resolved each import-reachable URI through the trees map, which only holds open-editor documents — the workspace scan and watched-file handler discard their trees — so 'full transitive lineage' contained only open files.
Fix: traversal extracted to computeFullLineage (src/full-lineage.ts) with tree acquisition as a loader callback; the server backs it with trees.get plus a new parseTreeFromDisk fallback so closed imports are parsed from disk. The unit test now exercises the real module (the old test faked a fully-populated trees map) and pins that every reachable file is requested from the loader.
