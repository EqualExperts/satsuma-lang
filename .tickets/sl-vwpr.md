---
id: sl-vwpr
status: closed
deps: []
links: []
created: 2026-06-10T11:16:28Z
type: bug
priority: 1
assignee: Thorben Louw
external-ref: user-report-v0.9.0
---
# satsuma-lsp standalone tarball ships no WASM or highlights.scm — fresh install fails initialize with ENOENT

The v0.9.0 release asset satsuma-lsp-v0.9.0.tgz contains zero .wasm files and no highlights.scm, but dist/server.js hard-codes loading tree-sitter-satsuma.wasm and tree-sitter.wasm from __dirname at initialize (server.ts:71-75). A fresh 'npm install -g satsuma-lsp-*.tgz' therefore fails its initialize request with ENOENT. The VSIX works only because vscode-satsuma/esbuild.js copyAssets() does its own copy into server/dist; the CLI tarball ships its wasm via scripts/prebuild.js + verify-pack.js. The LSP standalone pack path has no asset copy and no tarball verification, and the release smoke test only installs the CLI tarball.

## Acceptance Criteria

1) npm run build in tooling/satsuma-lsp leaves tree-sitter-satsuma.wasm, tree-sitter.wasm (web-tree-sitter runtime, renamed), and highlights.scm in dist/. 2) The packed satsuma-lsp.tgz is verified to contain bin/satsuma-lsp.js, dist/server.js, both wasm files, and highlights.scm, failing the build if any are missing. 3) Release workflow smoke-tests a fresh global install of the LSP tarball with a real LSP initialize round-trip over stdio. 4) build-artifacts.sh uses the verified pack path.


## Notes

**2026-06-10T12:01:54Z**

Cause: the LSP standalone pack path had no asset-copy step — esbuild only emits dist/server.js, and only the VS Code extension's own esbuild.js copied the WASM/highlights.scm next to the server bundle. npm pack therefore shipped a tarball whose server fails initialize with ENOENT, and the release smoke test only exercised the CLI tarball.
Fix: added scripts/copy-assets.js (runs in prebuild) to place tree-sitter-satsuma.wasm, the web-tree-sitter runtime (renamed tree-sitter.wasm), and highlights.scm in dist/; added scripts/pack.js + verify-pack.js mirroring satsuma-cli's verified pack path; build-artifacts.sh now uses npm run pack (and drops the vestigial node_modules symlink replacement — the tarball ships no node_modules); release workflow now smoke-tests a fresh global install of the LSP tarball with a real stdio initialize round-trip (scripts/smoke-initialize.js).
