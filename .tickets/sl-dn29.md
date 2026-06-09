---
id: sl-dn29
status: open
deps: [sl-wpa8]
links: []
created: 2026-06-09T21:14:51Z
type: task
priority: 1
assignee: Thorben Louw
tags: [live-editor, harness]
---
# Feature 33 — browser-side model pipeline module

Add a client module (src/client/model-pipeline.ts) that turns the editor buffer into a VizModel entirely in the browser with no network call: initialise the WASM parser via initParser from @satsuma/core (locateFile pointing at the served tree-sitter.wasm / tree-sitter-satsuma.wasm), parse the buffer, and build a VizModel via buildVizModel against an in-memory WorkspaceIndex. Bundle @satsuma/viz-backend + @satsuma/core as the existing esbuild ESM browser target instead of fetching /api/model. The model code is already pure CST transforms; this ticket is the wiring plus a browser-bundle correctness check.

## Design

Verify the browser bundle: workspace-index.ts imports Range from vscode-languageserver as a runtime value (not type-only) — confirm browser bundling does not drag Node-only code in; switch to a type-only import or @satsuma/core's own range type if it does. Depends on the isomorphic resolver landing first.

## Acceptance Criteria

model-pipeline.ts initialises the parser and builds a VizModel from a string buffer with no network call; browser bundle builds under --platform=browser with no Node-only module errors; vscode-languageserver Range import confirmed type-only or replaced; a unit/integration test drives parse->buildVizModel from an in-memory buffer (core-level per Core-vs-Consumer).

