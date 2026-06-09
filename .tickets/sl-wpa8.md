---
id: sl-wpa8
status: closed
deps: []
links: []
created: 2026-06-09T21:13:59Z
type: task
priority: 1
assignee: Thorben Louw
tags: [live-editor, viz]
---
# Feature 33 — isomorphic URL-based import resolver (browser-safe)

Replace the Node path/url import resolver in @satsuma/viz-backend's workspace-index.ts so one resolver serves file-based (CLI/LSP/server) and in-browser (localStorage) consumers. This is the enabling change for all cross-file lineage in the browser: today the module imports path/url at module scope, which (a) breaks an esbuild --platform=browser bundle and (b) is the only thing resolveImportUri/getImportReachableUris depend on. resolveImportUri's file://->path->resolve->file:// round-trip is pure URI resolution and is byte-for-byte reproducible with new URL(pathText, importerUri), which exists natively in Node and the browser. buildImportSuggestion's path.relative (LSP quick-fix only) gets a small pure pathname-diff reimplementation so the module has ZERO Node imports. Standardise the browser library on file:/// virtual URIs so index.indexedFiles.has(resolved) matches across runtimes.

## Design

new URL(...) verified equivalent to the path-based resolver across relative, ./, ../, absolute, and bare-name cases for file:// URIs, so CLI/LSP/server behaviour is unchanged. Reject custom schemes (satsuma://) — non-special schemes have unreliable relative-resolution semantics. This is a Core-vs-Consumer move; resolver logic stays shared, not duplicated per consumer.

## Acceptance Criteria

resolveImportUri uses new URL(...) with no path/url import; buildImportSuggestion reimplemented as pure pathname diff; workspace-index.ts has zero Node (path/url/fs) imports; parity tests assert the new resolver matches the old path-based output for file:// URIs (relative, ./, ../, absolute, bare name); a browser-virtual-URI test resolves an import cross-file; existing viz-backend + LSP + CLI tests still pass unchanged.


## Notes

**2026-06-09T21:35:51Z**

**2026-06-09T21:35:51Z**

Cause: workspace-index.ts resolved import paths via Node path/url (fileURLToPath→resolve→pathToFileURL), which cannot bundle for --platform=browser and blocked in-browser cross-file lineage.
Fix: replaced resolveImportUri with new URL(pathText, importerUri) and reimplemented buildImportSuggestion's path.relative as a pure pathname diff (relativeUriPath); module now has zero Node imports. Parity tests assert byte-for-byte equivalence with the legacy resolver for file:// URIs (commit b60dbef).
