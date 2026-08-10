# @satsuma/viz-harness

Standalone browser harness for the Satsuma mapping visualization — and, since
feature 33, the source of the public **"Try it Live!" playground**. The package
plays two roles:

1. **Playwright host.** The harness hosts the production `@satsuma/viz` web
   component and provides a Playwright suite that drives the rendered viz the
   same way a user would. Feature 30
   (`archive/features/30-viz-test-suite-expansion/PRD.md`) expanded the suite into a
   high-value regression net plus a deterministic screenshot review workflow.
2. **Playground source.** The same browser client is published as a
   server-free live editor (`npm run build:playground`) where visitors edit
   Satsuma source and watch the visualization update — entirely client-side.
   See "The playground" below.

This README is the entry point for working on, running, or contributing to
either.

---

## What lives here

| Path | Purpose |
| --- | --- |
| `src/server.ts` | Tiny HTTP server. Lists `examples/**.stm` fixtures via `/api/fixtures` and serves the harness web UI. |
| `src/client/` | Harness web UI: fixture picker, view-mode toggle, the `<satsuma-viz>` host, and the `window.__satsumaHarness` event recorder. |
| `test/harness.test.ts` | **Semantic regression suite.** Real-click / real-hover Playwright tests asserting overview rendering, mapping detail content, field coverage, hover highlighting, interaction events, filters, and geometry sanity. |
| `test/screenshots.spec.ts` | **Screenshot review workflow.** Drives each fixture into a documented UI state and emits a named PNG plus a manifest entry. NOT a golden-baseline suite. |
| `playwright.config.ts` | Three Playwright projects — `chromium` (semantic suite), `screenshots` (review artifacts), and `playground-static` (static bundle smoke + privacy). |
| `scripts/build-playground.mjs` | Assembles the server-free **"Try it Live!"** bundle (`npm run build:playground` → `dist/playground/`): page, client + viz bundles, both WASM files, and the examples manifest — every asset page-relative so it deploys under a non-root base path (GitHub Pages). |

---

## Running the dev server locally (live preview, not Playwright)

Sometimes you just want to look at the current `<satsuma-viz>` UI in a real
browser — not run the Playwright regression suite. This starts the harness's
own Node HTTP server (`src/server.ts`), which serves the harness web UI (a
fixture picker over `examples/**` plus the production viz component) at
**<http://localhost:3333>**.

```bash
# One-time (or after changing core/viz-model/viz-backend/viz source):
npx turbo run build --filter=@satsuma/viz-harness

# Start the server:
npm --prefix tooling/satsuma-viz-harness run dev
```

Then open <http://localhost:3333> in your browser. The server does not
hot-reload — after further source changes, stop it (`Ctrl-C`, or
`kill "$(lsof -ti:3333)"`), re-run the turbo build, and start it again.

Note `npm run dev` here runs this package's own `build` script first, which
only rebuilds *this* package's bundle from already-built dependencies — it
does not build `@satsuma/core`, `@satsuma/viz`, etc. themselves. Run the
`turbo run build` step above whenever a dependency changed, not just this
package.

Claude Code users: the `/viz-dev` command (`.claude/commands/viz-dev.md`)
automates all of the above, including the agent-sandbox Turborepo env vars
(see AGENTS.md "Running Turborepo in the agent sandbox") and confirming the
server actually came up before handing you the URL.

This is unrelated to the Playwright suite described above — that suite drives
an automated headless-Chromium browser for regression tests, not a
human-facing preview.

---

## The playground (server-free live editor)

`npm run build:playground` emits `dist/playground/` — a flat, static bundle
(page, client + viz bundles, both WASM parser artifacts, bundled examples
manifest) that runs with **no Node process anywhere**. The deploy workflow
copies it into the website at `/playground/` ("Try it Live!").

Three pieces make it work, all shared with the dev-server harness:

- **Client-side model pipeline** (`src/client/model-pipeline.ts`, ADR-027):
  the browser initialises the WASM parser and calls the same
  `buildModelResultFromSources` the Node server used, so the playground
  renders exactly what every other surface renders. There is no model
  endpoint — parsing never leaves the page.
- **localStorage document library** (`src/client/library.ts`, ADR-028): the
  picker and the workspace are one thing. The bundled example corpus seeds
  the library on first visit (edited documents are never overwritten by a
  re-seed), opened/new files become user documents, and cross-file `import`
  lineage resolves against the whole library in-browser.
- **Base-path safety** (`scripts/build-playground.mjs`): every asset reference
  is page-relative, and the bundler refuses to emit a page with a
  root-absolute (`/…`) reference, so the bundle works unchanged under GitHub
  Pages' `/satsuma-lang/playground/` prefix. The `playground-static`
  Playwright project serves the bundle at that prefix and asserts the privacy
  guarantee: edit, Open, and Save complete with zero network requests.

---

## Why Chromium, and where it runs

Playwright in this repo targets **Chromium**, runs **headless** both on a
developer machine and inside the agent sandbox, and runs in its **own CI job**
(and via `test:all` locally — see the next section). Pinning to a single
browser keeps the suite reproducible everywhere; the same `satsuma-viz` web
component code paths are exercised regardless of engine.

Chromium is resolved in `playwright.config.ts`: an explicit
`CHROMIUM_EXECUTABLE_PATH` override wins, then the system Chromium at
`/usr/bin/chromium` (what the agent sandbox provides), then Playwright's own
bundled browser (a developer runs `npx playwright install chromium` once). The
`--no-sandbox` flag is added only when running as root, which the agent sandbox
does and Chromium otherwise refuses.

The `chromium` project covers `*.test.ts`; the `screenshots` project covers
`*.spec.ts`; the `playground-static` project covers the static bundle. A bare
`npm test` runs all three.

---

## Running the Playwright suite (headless Chromium)

The agent that maintains this suite runs it **directly in the sandbox** — no
human-in-the-loop watcher and no sentinel file. The sandbox provides a system
Chromium that `playwright.config.ts` resolves automatically; a developer
typically uses Playwright's bundled Chromium instead.

```bash
# From the repo root — builds every dependency, then runs all three projects:
npx turbo run test --filter=@satsuma/viz-harness

# Or, after a workspace build, from inside this directory:
npm test
```

A full run takes roughly 40–90s. On a developer machine, install the bundled
browser once first:

```bash
npx playwright install chromium
```

If a run fails with `EADDRINUSE` on :3333/:3334, a stale server is holding the
port — kill it and rerun: `pkill -f "node dist/server.js"`.

---

## Fixture matrix

The suite intentionally covers six canonical fixtures, each chosen to exercise
a render path the others do not. Adding a new fixture should be justified by
a render path not already covered here.

| Fixture | Why it is in the suite |
| --- | --- |
| `examples/sfdc-to-snowflake/pipeline.stm` | Non-namespaced vanilla schemas, single named mapping, computed arrows, NL `@ref` highlighting, map transforms — the canonical "small example" path. |
| `examples/namespaces/ns-platform.stm` | Namespaced schemas and mappings, qualified IDs, namespace pills, namespace filter — exercises the namespace card-height path that non-namespaced cards never hit. |
| `examples/metrics-platform/metrics.stm` | Metric schemas (rendered via `<sz-metric-card>`), cross-file lineage merge, file filter across `metrics.stm` and `metric_sources.stm`. |
| `examples/reports-and-models/pipeline.stm` | Report and model schemas with their distinct card metadata. |
| `examples/filter-flatten-governance/filter-flatten-governance.stm` | Multi-source joins with NL join text, mapping notes, nested child fields, list/flatten sections, governance metadata, field-coverage indicators. |
| `examples/sap-po-to-mfcs/pipeline.stm` | Larger real-world layout — layout-stability and a "looks right at scale" review screenshot. |

---

## Two kinds of test, on purpose

The suite separates **automated semantic assertions** from **human-review
screenshots**. They live in different files, run in different Playwright
projects, and have different failure semantics.

### Semantic regression (`harness.test.ts`)

- Validates a single observable property per test (overview cards, detail
  arrows, hover highlight, event payload, geometry invariant, filter effect).
- Uses real clicks, real hovers, and `data-testid` selectors — never pixel
  comparison.
- A failing test means the production renderer or model has regressed.

### Screenshot review (`screenshots.spec.ts`)

- Loads a fixture, drives it into a documented UI state, captures one PNG.
- Output goes to `tooling/satsuma-viz-harness/screenshots/` (gitignored).
- A `screenshots/manifest.json` entry is written for every shot, recording:
  ```json
  {
    "file": "sfdc-overview-single.png",
    "fixture": "sfdc-to-snowflake/pipeline.stm",
    "viewMode": "single",
    "uiState": "overview",
    "viewport": { "width": 1440, "height": 900 },
    "timestamp": "2026-04-09T19:31:47.167Z",
    "step": "sfdc-overview-single"
  }
  ```
- These shots are **review artifacts, not golden baselines.** They are intended
  for human markup and for feeding to a VLM together with the manifest entry as
  visual context. A failing screenshot test means the harness could not reach
  the documented state — *not* that pixels diverged from a stored reference.

The ten review shots produced today are listed in
`archive/features/30-viz-test-suite-expansion/PRD.md` §"Screenshot artifacts for human
and VLM review".

---

## Local checks before opening a PR

Before pushing changes that touch the harness, viz, or viz-backend, run:

```bash
npx turbo run test --filter=@satsuma/viz --filter=@satsuma/viz-backend
npx turbo run build --filter=@satsuma/viz-harness
# Then run the Playwright suite directly (headless Chromium):
npx turbo run test --filter=@satsuma/viz-harness
```

The Playwright suite runs headless Chromium right in the agent sandbox; no
human-in-the-loop watcher is needed.
