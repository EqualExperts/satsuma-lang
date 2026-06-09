# Feature 33 — Live Editor & "Try it Live!"

> **Status: REVIEWED** (2026-06-09) — viability assessed against the codebase; the
> enabling change re-scoped to a browser-safe import resolver (see §1 and the
> *Pre-implementation findings* below).

## Pre-implementation findings (2026-06-09)

A codebase assessment confirmed the feature is viable and refined where the work
actually is:

- **The model code is already browser-ready.** `buildVizModel`, `mergeVizModels`,
  `indexFile`, and `createWorkspaceIndex` are pure CST transforms with no
  filesystem dependency. The harness client already bundles `@satsuma/core` +
  `@satsuma/viz-backend` as ESM and `highlightSatsuma` is already a client-side,
  zero-dependency regex tokenizer. So "move `buildVizModel` into the browser" is
  near-trivial wiring — **it is not the hard part.**
- **The real enabling change is import resolution.** `workspace-index.ts` imports
  Node `path`/`url` at module scope and `resolveImportUri` (the only resolver, used
  by `getImportReachableUris`) round-trips `file://` → path → `resolve` → `file://`.
  This (a) makes an esbuild `--platform=browser` bundle fail to resolve `path`/`url`,
  and (b) is the thing all cross-file lineage depends on. It is **pure URI
  resolution**, not filesystem logic.
- **One isomorphic resolver serves both worlds.** `new URL(pathText, importerUri)`
  reproduces the current `path`-based result byte-for-byte for `file://` URIs
  (verified across relative, `./`, `../`, absolute, and bare-name cases) and exists
  natively in both Node and the browser. So we support **file-based (CLI/LSP/server)
  and in-browser (localStorage) resolution with a single runtime-agnostic resolver**,
  not a fork — a simplification and a portability win (it also removes the current
  Windows `\` platform-dependence). *Loading* stays environment-specific (fs vs
  localStorage); *resolving* becomes shared.
- **The corpus is small.** `examples/` is ~115 KB across 23 `.stm` files — well
  inside the `localStorage` quota. Seed the whole corpus; the "store compressed /
  by reference" mitigation is unnecessary for v1.

## Goal

Turn the viz harness's read-only source pane into a **client-only live editor**,
and publish that editor on the public site as **"Try it Live!"** so anyone can
write Satsuma in the browser and watch the visualization update — with no server,
no upload, and no stored files.

The primary success criterion is:

**A visitor can open "Try it Live!" from the website, edit Satsuma source in the
left pane (with syntax highlighting and horizontal scrolling for wide lines),
see the visualization re-render as they type, open a local `.stm` file into the
editor and download the current buffer back to disk — and at no point is any
file content sent to or stored on a server.**

This feature builds on the Feature 29/30 harness. It does not change the renderer
or the VizModel contract. It changes (a) where parsing and model-building happen
(server → browser), (b) the left pane (read-only `<pre>` → editable buffer), and
(c) how the harness is hosted (Node dev server → also a static client-only build
embedded in the site).

---

## Problem

Today the harness is a **fixture viewer**, not an editor, and it is **server-bound**:

1. **The source pane is read-only.** `app.ts` sets `sourceCodeEl.innerHTML` from
   `highlightSatsuma(source)` — there is no way to change the text. Exploring "what
   if I map this field differently?" requires editing a file on disk and reloading.
2. **Parsing and model-building happen on the Node server.** `/api/model` reads the
   fixture from the filesystem, parses it with the WASM parser, and runs
   `buildVizModel` / `mergeVizModels` server-side (`src/server.ts:230`). The browser
   only ever receives finished JSON. A static host (GitHub Pages) has no such server.
3. **There is no "open" or "save".** Source can only come from the server's
   `examples/` directory via `/api/source`. A user cannot bring their own file in,
   and cannot take their edits out.
4. **The harness is not linked from the site.** The public Eleventy site
   (`site/`, deployed to GitHub Pages on release) has Home / CLI / VS Code /
   Examples / Learn / Diaries, but no interactive playground. People read about
   Satsuma; they cannot try it.

The unifying constraint the user has set: **this is purely local / client-only.**
Editor content lives in the browser (and optionally `localStorage`); it is never
uploaded, persisted server-side, or otherwise transmitted.

---

## Design Principles

1. **Client-only, by construction.** The "Try it Live!" build must work as static
   files with no backend. The only way to guarantee "nothing is stored on the
   server" is for there to be no server in the loop at all for parse/model/open/save.
2. **Parser-backed, reusing core.** Highlighting and model-building must continue
   to flow through `@satsuma/core` and `@satsuma/viz-backend`, not a second ad-hoc
   path. `@satsuma/core` is already WASM and runs in a browser; we move the existing
   `buildVizModel` call site into the client rather than reimplementing it.
3. **One model pipeline, two hosts.** The Node dev server (for fixtures + Playwright)
   and the static site build share the same browser-side model-building code. The
   server keeps working for the existing test suite; the static build is the same
   client with model-building done in-page.
4. **Simple editor, no IDE.** A code buffer with Satsuma syntax highlighting,
   horizontal scrolling, and a monospace caret — nothing more. No LSP, no
   autocomplete, no multi-file tabs in v1.
5. **Minimal, safe dependencies.** Prefer reusing the existing `highlightSatsuma`
   tokenizer over pulling a large editor framework. Any added dependency must be
   small, widely used, MIT/permissive, and free of native build steps. (See
   *Open Decisions*.)
6. **Graceful on invalid input.** A live editor means the buffer is *usually*
   mid-edit and syntactically incomplete. Parse failures must degrade to "keep the
   last good visualization + show an unobtrusive error", never a blank crash.

---

## Scope

### 1a. Browser-safe isomorphic import resolver (the true enabling change)

Before any browser model-building can resolve `import`s, the import resolver in
`@satsuma/viz-backend`'s `workspace-index.ts` must stop depending on Node `path`/
`url`. This is a **core concern** (per Core-vs-Consumer): the CLI, LSP, server, and
the new browser client all share it.

- Replace `resolveImportUri`'s `fileURLToPath`/`dirname`/`resolve`/`pathToFileURL`
  round-trip with a single `new URL(pathText, importerUri)` call. This is verified
  byte-for-byte equivalent for `file://` URIs, so **CLI/LSP/server behaviour is
  unchanged**, and it works natively in the browser.
- Reimplement `buildImportSuggestion`'s `path.relative` as a small pure pathname
  diff (it is LSP-quick-fix-only and never bundled to the browser) so the whole
  module has **zero Node imports** and bundles cleanly for `--platform=browser`
  with nothing excluded.
- **URI-scheme contract.** Resolution only works if every consumer indexes files
  under URIs in the same scheme the resolver produces. The browser library uses
  **`file:///` virtual URIs** rooted at a library base (each document's URI derived
  from its library path) — identical in form to the CLI's `pathToFileURL` output.
  This keeps `index.indexedFiles.has(resolved)` matching across runtimes and makes
  the server↔client model-parity test (§AC) trivial. A custom scheme
  (`satsuma://…`) is explicitly rejected: non-special schemes have unreliable
  relative-resolution semantics in the URL spec.
- Add parity tests proving the new resolver matches the old `path`-based output for
  `file://` URIs, plus a browser-virtual-URI case resolving cross-file.

### 1b. Browser-side model pipeline

With the resolver isomorphic (§1a), extract the model-building currently done in
`server.ts` into a browser-callable module so the client can turn editor text into a
`VizModel` with no network call.

- Add a client module (e.g. `src/client/model-pipeline.ts`) that:
  - initialises the WASM parser in the browser (`initParser` from `@satsuma/core`,
    with `locateFile` pointing at the served `tree-sitter.wasm` / `tree-sitter-satsuma.wasm`),
  - parses the current editor buffer,
  - builds a single-file `VizModel` via `buildVizModel` against an in-memory
    `WorkspaceIndex` seeded from the editor buffer (and, for fixtures, any
    import-reachable fixture sources the client already holds).
- The harness client bundles `@satsuma/viz-backend` + `@satsuma/core` (esbuild
  `--format=esm` browser target) instead of fetching `/api/model`. **Verify the
  bundle:** `workspace-index.ts` imports `Range` from `vscode-languageserver` as a
  runtime value (not type-only) — confirm browser bundling does not drag Node-only
  code in; switch to a type-only import or `@satsuma/core`'s own range type if it does.
- The Node dev server keeps `/api/fixtures` and `/api/source` for the fixture
  picker and Playwright, but **`/api/model` is no longer the source of truth** —
  the client builds the model from the source text it already has. (Server-side
  `/api/model` is retained as the parity oracle, then retired; see *Decisions*.)

> **Lineage works across the in-browser library.** Full cross-file `import`
> lineage merge (`mergeVizModels`) depends on resolving sibling files. Because the
> playground seeds **all bundled example files into a localStorage-backed document
> library** (see §5), the client builds the in-memory `WorkspaceIndex` from that
> whole library — so `import`s between library documents resolve client-side and
> **lineage mode renders cross-file edges with no server**. Editing a library
> document updates its entry in the workspace, so lineage stays live as you type.
> The single-file fallback applies only when the active buffer `import`s a file
> that is **not** in the library (e.g. a brand-new untitled buffer referencing an
> unknown path): that buffer renders single-file with a visible note explaining the
> unresolved import.

### 2. Editable source pane

Replace the read-only `<pre id="source-code">` with an editable, syntax-highlighted
buffer.

- The left pane becomes editable: typing updates an in-memory buffer that is the
  single source of truth for both highlighting and the model pipeline.
- **Syntax highlighting** continues to use the existing `highlightSatsuma`
  tokenizer (the same token classes/colours already defined in `index.html`).
- **Horizontal scrolling**: long lines must scroll left/right rather than wrap.
  Highlight layer and editable layer share `white-space: pre` and a common
  horizontal scroll region so the caret and the colours stay aligned at any
  scroll offset. (This is the explicit "scroll the code view left/right if the
  code is too wide" requirement.)
- **Debounced re-render**: edits trigger `model-pipeline` re-build on a short
  debounce (e.g. ~150–300 ms idle) so the viz keeps up without thrashing the
  parser on every keystroke.
- **Resilient rendering**: if the new buffer fails to parse or yields an empty
  model, keep the previous good visualization on screen and surface a small,
  dismissable parse-status indicator (e.g. "⚠ unparsed edits" / error count),
  rather than clearing the canvas.
- **Collapsible editor pane**: a toggle collapses the source pane to the left
  edge (a thin rail / re-expand handle) so the visualization can use the full
  width, and expands it back. Collapsing must reflow the viz to the reclaimed
  width (not just overlay it), and the collapsed/expanded state persists in
  `localStorage` so it survives reloads. This is the "maximum use for the viz"
  requirement.
- The document picker stays: selecting a document from the library (§5) loads its
  source **into the editor** (replacing the buffer), after which the user can edit
  freely.

### 3. Open a local file ("Open…")

Add an **Open** action to the source toolbar that loads a `.stm` file from the
user's machine into the editor.

- Uses a client-side file read only (`<input type="file" accept=".stm,.txt">`
  and `FileReader`, or the File System Access API where available with the
  `<input>` fallback). **The file is read into memory in the browser and never
  uploaded.**
- The file's text **replaces** the current editor buffer (per the request: "just
  adds it to the window replacing the code"); the viz re-renders from it.
- The chosen file name is shown as the current document label (replacing the
  "fixture name" label) so the user knows what they are editing. No server-side
  fixture entry is created.

### 4. Save / download ("Save to local")

Add a **Save to local** (download) action that writes the current editor buffer
to a file on the user's machine.

- Implemented as a client-side `Blob` download (anchor with `download` attribute),
  or the File System Access API's save picker where available with the anchor
  fallback. **No content leaves the browser.**
- Default filename derives from the current document label (opened file name, or
  fixture-derived name, or `untitled.stm`).

### 5. The localStorage document library (no server)

All persistence is **client-side only** and built around a single `localStorage`
document library that doubles as the playground's example browser.

**Seeding the built-in examples.** At build time, the bundled example corpus is
serialized into a static JSON asset (a manifest of `{ name, path, source }`
entries) shipped with the playground build. On first load — when the library
version key is absent from `localStorage` — the client seeds the document library
from that bundled JSON, so the user immediately has the full set of built-in
examples available locally, editable, and surviving reloads. This is the
"pre-load the built-in examples into localStorage" requirement.

- **Library schema.** `localStorage` holds: the document library (each example as
  an editable entry keyed by its path), a pointer to the active document, the
  current editor buffer, the view-mode, and the editor collapsed/expanded state.
  A `librarySeedVersion` key records which bundled corpus version seeded the
  library so later visits don't clobber the user's edits.
- **Library = workspace.** The in-browser `WorkspaceIndex` (§1) is built from the
  library entries, so `import`s between seeded examples resolve and lineage renders
  client-side. Editing a document updates both its library entry and the workspace.
- **Seed semantics.** Seeded examples are the user's own local, editable copies.
  Edits persist to that library entry. **Re-seeding only adds genuinely new or
  updated built-in examples on a version bump; it never overwrites a document the
  user has edited** (so a returning visitor never loses work). A per-document
  **"Restore original"** action re-copies a single example from the bundled JSON;
  a global **Reset** restores the whole library to the bundled corpus and clears
  the working buffer.
- **User documents.** Opening a local file (§3) or creating an untitled buffer
  adds a user document to the same library, distinguished from built-in examples
  so Reset/Restore semantics are unambiguous. There is **no** server-side storage
  of any kind.
- **Starter on a blank slate.** If `localStorage` is somehow empty and seeding is
  unavailable, fall back to a small bundled starter `.stm` so the canvas is never
  blank.

### 6. Static "Try it Live!" build + site integration

Publish the harness client as a static, client-only bundle reachable from the site.

- Add a harness build target that emits a **server-free** static bundle: the
  client `app.js`, `satsuma-viz.js`, the two WASM files, `index.html`, and the
  bundled examples JSON (§5) — everything needed to run with no Node process.
- The bundle is published under **`/playground/`**. The Eleventy site build copies
  it into the published site, analogous to how the deploy workflow already copies
  diary content into `site/` before building.
- Add a **"Try it Live!"** entry to the site navigation (`site/_includes/nav.njk`,
  both desktop and mobile menus) and a prominent call-to-action on the home page,
  linking to `/playground/`.
- Update the repository **`README.md`** to add (a) a **"Try it Live!"** link to the
  playground (`https://equalexperts.github.io/satsuma-lang/playground/`) and (b) a
  link to the published GitHub Pages **site**
  (`https://equalexperts.github.io/satsuma-lang/`). The playground link must land
  **with this feature** — not before the `/playground/` build is deployed — so the
  README never carries a 404. The plain site link can be added independently since
  the site already exists.
- In the static build there is no `/api/fixtures` or `/api/source` server: the
  document picker is backed entirely by the localStorage library (§5), seeded from
  the bundled examples JSON. The Node dev server's fixture API remains only for the
  local Playwright harness.
- The static build must work under a non-root GitHub Pages base path (the site is
  served from a project path), so asset URLs (WASM, scripts, examples JSON) must
  resolve relative to the page, not absolute `/…` roots.

### 7. Documentation

- Update `tooling/satsuma-viz-harness/README.md`: the harness is now both a
  Playwright host *and* the source of the public live editor; document the static
  build target and the client-side model pipeline.
- Note in `PROJECT-OVERVIEW.md` that an in-browser editor exists and that it is
  fully client-side (privacy: source never leaves the browser).
- Document on the page itself (a short, visible note) that editing is local-only
  and nothing is uploaded — this is a trust/privacy statement users should see.

---

## Non-Goals

- **Server-side anything.** No upload, no persistence, no shared links that store
  content server-side. (A future "share via URL-encoded buffer" is out of scope
  here but compatible with the client-only design.)
- **Lineage to files outside the in-browser library.** Lineage resolves `import`s
  between documents in the localStorage library (§5). A buffer importing a path
  that is not in the library renders single-file with a note — v1 does not fetch or
  resolve arbitrary external paths.
- **IDE features.** No completions, hover, go-to-def, rename, inline diagnostics
  beyond a simple parse-status indicator, or multi-tab editing. (The LSP exists
  for editors; the live editor is deliberately minimal.)
- **Pixel-perfect or golden-image testing** of the editor (consistent with
  Feature 30's stance).
- **Mobile-first editing UX.** The editor should not break on small screens, but
  rich touch editing is not a v1 goal.
- **Replacing the VS Code extension.** "Try it Live!" is a try-before-you-install
  surface, not a replacement for the real editor integration.

---

## Decisions

**Resolved:**

1. **Editor implementation → zero-dependency overlay.** A transparent `<textarea>`
   (or `contenteditable`) layered over a `<pre>` rendered by the existing
   `highlightSatsuma`, with synced scroll. Reuses tested code, adds *no* dependency,
   satisfies "simple editor" + "safe dependency", and gives full control over
   horizontal scroll. We own the caret/scroll-sync edge cases. **CodeMirror 6**
   remains the documented fallback if richer editing is later wanted.
2. **Published slug → `/playground/`**, nav label **"Try it Live!"**.
3. **Examples ship as a bundled JSON and seed the localStorage document library**
   (§5); the playground picker is backed by that library, not a server.
4. **One isomorphic import resolver, not a fork** (§1a). `new URL(...)`-based
   resolution serves CLI/LSP/server (file-based) and the browser (localStorage)
   from a single code path; verified equivalent for `file://` URIs.
5. **Browser library uses `file:///` virtual URIs** (§1a), matching the CLI's URI
   form so resolution and the model-parity test stay consistent across runtimes.
6. **Fate of server-side `/api/model`: keep briefly, then retire.** Retain it as the
   parity oracle for a "client model == server model" test on canonical fixtures,
   then remove once the client pipeline is authoritative.
7. **Library breadth: seed the *entire* `examples/` corpus.** At ~115 KB / 23 files
   it is well within the `localStorage` quota, and the whole corpus is what makes
   cross-file lineage resolve in the playground. The compressed/by-reference storage
   mitigation is dropped as unnecessary for v1.

**Still open:**

8. **Viz reflow on collapse (needs a spike).** AC 10 asserts the `<satsuma-viz>`
   canvas widens and re-lays-out (elkjs) when the editor collapses. Whether the
   component already relayouts on container resize (ResizeObserver) is unverified.
   Confirm before committing to the AC; if it does not, collapse must explicitly
   trigger a relayout.

---

## ADRs, Architecture Docs & Test Impact

This feature crosses several recorded architectural boundaries, so it must land
with the corresponding ADRs and doc updates — not as code-only changes. Run
`/adr-draft` to assess and confirm before opening the PR; the list below is the
expected outcome of that assessment.

### New ADRs to draft

1. **Client-side VizModel pipeline & server-free playground build.** Records the
   decision to move parsing + `buildVizModel` out of the Node server and into the
   browser, and to ship a static, backend-free build of the viz stack. This is a
   new *consumer topology* for the viz packages (browser-only, no Node), so it
   warrants its own ADR. It builds on **ADR-002** (WASM parser — the thing that
   makes browser parsing possible), **ADR-018** (the `@satsuma/viz-model` contract,
   which now crosses an in-browser boundary), and **ADR-020** (core remains the
   single extraction truth; the playground is thin wiring around it). It should also
   record the **isomorphic `URL`-based import resolver** (§1a) — replacing the Node
   `path`/`url` round-trip so one resolver serves file-based and in-browser
   consumers — as a load-bearing part of this topology.
2. **Client-only document library & persistence (no server storage).** Records
   that the playground's "workspace" is an in-browser `localStorage` document
   library seeded from bundled examples, and that file content is never transmitted
   or stored server-side (a data-residency / privacy decision, not just a storage
   detail). This **interacts with ADR-022** ("make workspace scope file-based
   everywhere"): the playground builds an equivalent `WorkspaceIndex` from in-memory
   documents rather than the filesystem. The new ADR must state the relationship
   explicitly — ADR-022's *scope-resolution* semantics (import-graph reachability)
   still hold; only the *source medium* of the documents changes. ADR-022 is **not
   superseded** and its body stays immutable; the new ADR references and scopes it.

   > These two may be drafted as one "client-only playground architecture" ADR if
   > `/adr-draft` judges them a single decision. Treat the count as 1–2.

3. **(Candidate) No editor framework — zero-dependency highlighted overlay.** The
   deliberate choice to avoid CodeMirror/Monaco and reuse the existing
   `highlightSatsuma` tokenizer is the kind of dependency decision this project
   already records as ADRs (cf. **ADR-002**, **ADR-015**, **ADR-016**). Assess
   whether it merits a standalone ADR or is adequately captured in this PRD's
   *Decisions* section; lean to a short ADR if the overlay approach is load-bearing
   enough that a future contributor might otherwise "just add CodeMirror".

### Existing ADRs to reference (no body changes)

- **ADR-022** — reference and scope as above (in-memory vs file-based workspace).
- **ADR-002 / ADR-012 / ADR-018** — referenced as the foundations the playground
  stands on; no changes expected. If `/adr-draft` finds any of these is genuinely
  contradicted (not just extended), mark the Status line per the ADR workflow.

### Architecture & overview doc changes

- **`docs/product-owner/PROJECT-OVERVIEW.md`** — add the browser playground as a
  first-class product surface and state the client-only / privacy guarantee.
- **`docs/product-owner/ROADMAP.md`** — move this item from planned to in-progress
  / shipped as appropriate.
- **`docs/using-satsuma-without-cli.md`** — add "Try it Live in the browser" as a
  zero-install path to use Satsuma.
- **`HOW-DO-I.md`** — add an entry, e.g. *"How do I try Satsuma without installing
  anything?"* → the playground.
- **`tooling/satsuma-viz-harness/README.md`** — document the harness's dual role
  (Playwright host *and* source of the public playground), the static build target,
  the client-side model pipeline, and the `localStorage` document library.
- **`site/_includes/nav.njk`** + home page — the "Try it Live!" nav entry and CTA
  (already in §6; listed here so the doc surface is complete).
- **`README.md`** — a "Try it Live!" link to the playground (lands with the feature)
  and a link to the published GitHub Pages site (can land independently). See §6.

### Test impact

Beyond the per-criterion coverage in *Acceptance Criteria* (§AC 1–12):

- **Core / viz-backend unit tests** for any logic that moves into
  `@satsuma/core` / `@satsuma/viz-backend` (per the Core-vs-Consumer rule):
  building a `WorkspaceIndex` from in-memory document sources, and the
  parse→`buildVizModel` path driven from a string buffer rather than a file.
  Test the invariant once, at the core level — do not duplicate in the harness.
- **Model parity test** (ties to open decision #4): assert the browser pipeline
  and the existing server `/api/model` produce the same `VizModel` for canonical
  fixtures, for as long as the server path is retained.
- **Harness Playwright additions:** live re-render on edit, horizontal-scroll
  alignment, Open (loads text, *no* upload request), Save (download), collapse/
  expand reflow of the viz, `localStorage` seeding + edited-example-survives-reload,
  and cross-file lineage resolved entirely in-browser.
- **Network-isolation assertion:** a test proving the client-only claim — no
  network request carries source content during edit / Open / Save (the privacy
  guarantee must be enforced by a test, not just asserted in prose).
- **Static-build smoke check:** the published playground loads and renders a seeded
  example under a non-root base path (a Playwright run against the built static
  bundle, or a deploy-time smoke step).
- Apply the repo's test-quality standards throughout: each case carries a purpose
  comment, inputs are minimal Satsuma snippets, and no smoke/redundant tests.

---

## Acceptance Criteria

1. **Client-only model:** With the harness served as static files (no Node
   `/api/model`), editing the buffer produces an updated visualization built
   entirely in the browser via `@satsuma/core` + `@satsuma/viz-backend`. Verified
   by a Playwright test that loads the static build and asserts a re-render after
   a programmatic edit, with no network request to a model endpoint.
2. **Editable + highlighted:** The left pane is editable, shows Satsuma syntax
   highlighting via `highlightSatsuma`, and the highlight stays aligned with the
   caret while typing.
3. **Horizontal scroll:** A buffer with lines wider than the pane scrolls
   left/right (no wrap), and highlight + caret remain aligned at non-zero scroll
   offsets. Covered by a geometry/scroll assertion.
4. **Live re-render:** Edits re-render the viz on a debounce; invalid intermediate
   buffers keep the last good visualization and show a parse-status indicator
   instead of clearing the canvas.
5. **Open local file:** An "Open" action loads a chosen `.stm` file's text into
   the editor and re-renders, using only client-side file reading. A test (or
   documented manual check) confirms no upload request is made.
6. **Save to local:** A "Save to local" action downloads the current buffer as a
   `.stm` file with a sensible default name, entirely client-side.
7. **Seeded example library:** On first load the playground seeds the bundled
   examples into a `localStorage` document library; the picker lists them, opening
   one loads it into the editor, and a returning visit does not re-seed over a
   document the user has edited. Covered by a Playwright test that asserts the
   library is populated on first load and that an edited example survives a reload.
8. **Cross-file lineage in the browser:** With the library seeded, an example that
   `import`s another library document renders cross-file lineage edges with no
   network model call.
9. **Local persistence:** Reloading the page restores the active buffer and the
   editor collapsed/expanded state from `localStorage`. A global Reset restores the
   library to the bundled corpus; per-document "Restore original" re-copies one
   example. No server-side storage exists.
10. **Collapsible editor:** The source pane collapses to the left and re-expands;
    collapsing reflows the viz to the reclaimed width, and the state persists across
    a reload. Covered by a geometry assertion that the viz canvas widens on collapse.
11. **Privacy statement:** The page visibly states that editing is local-only and
    source is never uploaded.
12. **Site integration:** "Try it Live!" appears in the site nav (desktop + mobile)
    and as a home-page CTA, links to `/playground/`, and the playground loads and
    renders a seeded example under the GitHub Pages base path. The repository
    `README.md` links to both the published site and the playground (the playground
    link merged together with the deployed `/playground/` build, never ahead of it).
13. **Deploy path:** The site deploy workflow produces the static playground as
    part of the published site (assets resolve under the project base path).
14. **Core placement:** Any model-pipeline/highlighting logic that a second
    consumer would need lives in `@satsuma/core` / `@satsuma/viz-backend`, not
    duplicated in the harness client (per the Core-vs-Consumer rule).
15. **Tests pass locally:**
    - `npm --prefix tooling/satsuma-viz-backend run test`
    - `npm --prefix tooling/satsuma-viz run test`
    - `npm --prefix tooling/satsuma-viz-harness run build` (incl. the new static target)
    - Playwright via the existing sentinel-watcher workflow, covering editing,
      open, save (download), persistence, and live re-render.

---

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| WASM init/asset paths break under the GitHub Pages base path | "Try it Live!" loads blank in production | Use page-relative asset URLs and an explicit `locateFile`; add a deploy smoke check that the editor renders the starter example |
| `workspace-index.ts` imports Node `path`/`url`, so the browser bundle won't build and no `import` resolves | Cross-file lineage (the headline browser feature) is impossible | Make the resolver isomorphic via `new URL(...)` (§1a); parity-test against the old `path`-based output so CLI/LSP are unaffected |
| Browser and CLI index files under different URI schemes, so `indexedFiles.has(resolved)` misses | Cross-file edges silently absent in one runtime | Standardise on `file:///` virtual URIs in the browser (§1a); cover with the model-parity test |
| Bundling `@satsuma/core` + `viz-backend` for the browser pulls in Node-only APIs (e.g. `vscode-languageserver` runtime import) | Static build fails or bloats | Confirm browser-target esbuild build; make `workspace-index.ts` zero-Node-import; switch `Range` to a type-only/core import if it drags code in; measure bundle size and lazy-load WASM |
| `<satsuma-viz>` does not relayout on container resize | Collapse leaves the viz at the old width (overlay, not reflow) — fails AC 10 | Spike the resize behaviour early (Decision #8); if absent, fire an explicit relayout on collapse/expand |
| Static-build Playwright project is unspecified — current tests run Firefox against `node dist/server.js` | Static smoke check (AC 13) can't run; deploy regressions go uncaught | Add a second Playwright project serving the static dir over a plain file server under a non-root base path |
| Re-parsing on every keystroke janks the UI on large buffers | Editor feels slow | Debounce model builds; keep highlighting (cheap regex) synchronous and model-building deferred to idle |
| Caret/scroll desync in the zero-dep overlay | Highlight drifts from typed text | Share one scroll container and `white-space: pre`; add a Playwright scroll-alignment assertion; CodeMirror remains the documented fallback |
| An `import` to a file outside the seeded library renders single-file unexpectedly | Confusing "missing" cross-file edges | Show a note naming the unresolved import; seed the whole corpus so library-internal imports resolve |
| Re-seeding the library overwrites a returning user's edits | Silent data loss | Gate seeding on a `librarySeedVersion` key; only add new/updated built-ins, never overwrite user-edited documents; offer explicit Reset/Restore instead |
| Seeded corpus + buffers exceed the `localStorage` quota | Writes throw, persistence fails | Low risk — corpus is ~115 KB / 23 files, far under quota. Guard writes and surface a non-blocking warning if a quota error ever throws; no compression needed for v1 |
| "Client-only" claim is silently violated by a stray fetch | Breaks the core privacy promise | Assert in tests that Open/Save/edit make no network calls to any content endpoint; state the guarantee on-page and in docs |
| Invalid buffers crash the viz component | Canvas blanks mid-edit | Catch parse/model errors in the pipeline, retain last good model, surface a non-blocking status |
