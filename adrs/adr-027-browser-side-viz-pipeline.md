# ADR-027 — Browser-Side VizModel Pipeline and Server-Free Playground Build

**Status:** Accepted
**Date:** 2026-06-10 (sl-cahg, feature 33)

## Context

Until feature 33, every VizModel was built server-side. The LSP server builds
models for the VS Code webview (ADR-018, ADR-020), and the viz harness ran a
Node server whose `/api/model` endpoint parsed fixtures and returned models to
a render-only browser client. The browser never parsed Satsuma itself.

Feature 33 ("Try it Live!") requires a public playground with a hard privacy
promise: a visitor can paste proprietary mapping source, edit it live, and
nothing they type is ever transmitted. That promise is incompatible with any
server-side compute. Three options were considered:

1. **Keep `/api/model` and host a backend.** Rejected: it breaks the privacy
   promise structurally (source must travel to the server), adds hosting cost
   and an availability dependency, and puts a network round-trip inside the
   per-keystroke render loop.
2. **Write a separate browser-only pipeline.** Rejected: duplicating parse +
   model assembly guarantees drift between what the playground renders and
   what the CLI/LSP/VS Code surfaces render, violating ADR-020's single
   extraction truth.
3. **Make the existing pipeline isomorphic and run it in the page.** Chosen.
   `@satsuma/core` already parses via WASM (`web-tree-sitter`, ADR-002), so
   the parser was browser-capable by construction; the only Node-bound piece
   was import resolution.

The blocker was `tooling/satsuma-viz-backend/src/workspace-index.ts`, which
resolved `import` paths with a Node `fileURLToPath → path.resolve →
pathToFileURL` round-trip, imported at module scope — fatal to an esbuild
`--platform=browser` bundle.

## Decision

The VizModel pipeline is isomorphic and the playground builds models entirely
in the browser. Specifically:

- **Isomorphic import resolver** (sl-wpa8): `resolveImportUri` in
  `workspace-index.ts` is a single WHATWG `new URL(pathText, importerUri)`
  call — byte-for-byte equivalent to the old Node round-trip for `file://`
  URIs, and equally valid for the playground's virtual `file:///` URIs.
  `@satsuma/viz-backend` must remain free of Node-only APIs at module scope.
- **One pipeline, two hosts** (sl-dn29): the browser client calls the same
  `buildModelResultFromSources` the Node server used, via the thin
  `src/client/model-pipeline.ts` adapter that owns the only genuinely
  browser-specific concern — locating and initialising the WASM parser
  against `document.baseURI`. Client/server parity was proven by test before
  the server's `/api/model` endpoint was deleted (sl-j8n5).
- **Server-free static build** (sl-ncu9): `npm run build:playground` in
  `tooling/satsuma-viz-harness` emits a flat `dist/playground/` bundle (page,
  client + viz bundles, both WASM artifacts, bundled examples manifest) in
  which every asset reference is page-relative; the bundler refuses to emit a
  page containing a root-absolute (`/…`) asset reference, so the bundle works
  unchanged under GitHub Pages' `/satsuma-lang/playground/` base path. A
  dedicated Playwright project serves the bundle at that non-root base path
  and asserts that edit, Open, and Save complete with zero network requests.

## Consequences

**Positive:**

- The privacy promise is a tested property, not prose: with no model endpoint
  anywhere, no request can carry source content, and the network-isolation
  test enforces it.
- The playground renders exactly what every other surface renders — one
  pipeline, no parity drift (ADR-020 extended into the browser).
- No backend to host, scale, or secure; the deployable is static files.
- Live editing has no network latency in the render loop.

**Negative:**

- `@satsuma/viz-backend` carries a new portability constraint: contributors
  must not introduce Node-only imports at module scope (the browser bundle
  breaks); this is enforced only by the harness build and its tests.
- Both WASM artifacts (~1.5 MB total) must ship with every deployment and be
  resolvable page-relative; asset-path regressions are a new failure class
  (mitigated by the bundler's root-absolute guard and the static Playwright
  project).
- Parse + layout cost moves to the visitor's device, bounded by the existing
  keystroke debounce.
