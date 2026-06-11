---
id: sl-mg63
status: open
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

