---
id: mbt-0f7t
status: closed
deps: [mbt-pumv]
links: []
created: 2026-08-04T11:08:48Z
type: task
priority: 2
assignee: Thorben Louw
parent: mbt-5l7g
---
# R3: Verify vscode-satsuma extension packaging survives workspace hoisting

vsce/extension packaging is sensitive to node_modules layout (hoisted vs nested), and this is the one package where that risk is concrete rather than hypothetical. After R2 lands, confirm vscode-satsuma still builds (npm run build) and packages correctly under the hoisted workspaces node_modules layout, and that the existing cli-pack-smoke-test-style global install check still passes.

## Acceptance Criteria

- vscode-satsuma builds successfully (client + server + webview) under the workspaces-hoisted node_modules
- Extension packages correctly (vsce package or equivalent) with all expected files bundled into the .vsix
- Existing vscode-extension CI job (fixture/golden tests, validate, build) passes unchanged
- Any packaging breakage found is fixed before this ticket closes -- R2 is not considered done until this passes


## Notes

**2026-08-04T16:52:56Z**

**2026-08-04T17:06:00Z**

Cause: vsce packaging is sensitive to node_modules layout, and hoisting did break the extension — but through its type-check and its asset copy rather than through vsce itself.
Fix: Verified the extension builds, packages and starts under the hoisted layout, and fixed the two breakages found. (commit immediately after 80f9206c)

What broke and why:

1. `@satsuma/viz` sets `"types": "src/satsuma-viz.ts"`, i.e. its TypeScript sources. That package was previously unresolvable from vscode-satsuma; hoisting made it resolvable, so `tsc -p src/tsconfig.json` began type-checking a sibling's Lit components under this package's compiler options and failed with TS1240/TS1270 on every `@property` decorator (satsuma-viz sets `experimentalDecorators` and `useDefineForClassFields: false`; vscode-satsuma deliberately does not). Fixed with a `paths` redirect to a local stub (`src/webview/viz/satsuma-viz.d.ts`) — viz.ts imports the package only for its custom-element registration side effect and talks to the element through the DOM, so none of its types are part of this package's contract. `@satsuma/viz` is now also a declared dependency rather than a phantom one.

2. esbuild.js reached into `../satsuma-lsp/node_modules` (via `nodePaths`) and `../satsuma-viz/node_modules/elkjs` (via two aliases), and its asset copy caught-and-ignored every failure — so a missing WASM produced an extension that packaged successfully and then could not start. `nodePaths` and both elkjs aliases are gone (elkjs is a declared dependency; esbuild's normal upward resolution finds the rest), and the three required server assets now fail the build loudly if absent. ci.yml's vscode-extension job builds the WASM grammar before the extension for the same reason.

Verified: `npm run validate` and `npm test` pass (46 unit + fixture + golden); LSP suite 300/300; `npm run build` emits all four webview bundles with elkjs genuinely inlined into the two that need it (3.5MB each) and all four server assets in server/dist; `npm run package` produces a 78-file 4.94MB vsix whose file set is byte-for-byte identical to one packaged from main before the migration; and the server extracted from that vsix completes a real LSP initialize round-trip, proving its bundled WASM loads from its packaged location.
