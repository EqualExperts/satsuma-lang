# @satsuma/viz-harness

Standalone browser harness for the Satsuma mapping visualization. The harness
hosts the production `@satsuma/viz` web component, serves real `.stm` fixtures
through `@satsuma/viz-backend`, and provides a Playwright suite that drives
the rendered viz the same way a user would. Feature 30 (`features/30-viz-test-suite-expansion/PRD.md`)
expanded the suite into a high-value regression net plus a deterministic
screenshot review workflow.

This README is the entry point for working on, running, or contributing to
that suite.

---

## What lives here

| Path | Purpose |
| --- | --- |
| `src/server.ts` | Tiny HTTP server. Lists `examples/**.stm` fixtures via `/api/fixtures` and serves the harness web UI. |
| `src/client/` | Harness web UI: fixture picker, view-mode toggle, the `<satsuma-viz>` host, and the `window.__satsumaHarness` event recorder. |
| `test/harness.test.ts` | **Semantic regression suite.** Real-click / real-hover Playwright tests asserting overview rendering, mapping detail content, field coverage, hover highlighting, interaction events, filters, and geometry sanity. |
| `test/screenshots.spec.ts` | **Screenshot review workflow.** Drives each fixture into a documented UI state and emits a named PNG plus a manifest entry. NOT a golden-baseline suite. |
| `playwright.config.ts` | Two Playwright projects — `firefox` (semantic suite) and `screenshots` (review artifacts). |
| `watch-and-test.sh` | Sentinel-file watcher that lets agents trigger Playwright runs without spawning a browser themselves. |
| `scripts/build-playground.mjs` | Assembles the server-free **"Try it Live!"** bundle (`npm run build:playground` → `dist/playground/`): page, client + viz bundles, both WASM files, and the examples manifest — every asset page-relative so it deploys under a non-root base path (GitHub Pages). |

---

## Why Firefox-only and local-only

Playwright in this repo runs **only on a developer machine**, **only in Firefox**,
and **never in CI** for Feature 30. Two reasons:

- Chromium headless-shell and WebKit both segfault inside SwiftShader on the
  macOS ARM configurations the team uses. Firefox's headless mode does not depend
  on SwiftShader and runs reliably.
- The agent sandbox cannot launch a browser at all (see "Sentinel watcher
  workflow" below). Pinning to a single browser keeps the suite reproducible
  for the human-in-the-loop run.

Both browsers exercise the same `satsuma-viz` web component code paths, so
choice of browser does not affect what the tests validate. If a future change
makes Chromium reliable on ARM macOS we can lift this restriction without
rewriting tests.

The `firefox` project covers `*.test.ts`; the `screenshots` project covers
`*.spec.ts`. A bare `npm test` runs both projects.

---

## Sentinel watcher workflow (human-in-the-loop)

The agent that maintains this suite cannot run `npx playwright test` directly:
the sandbox blocks browser launches. Instead, the watcher script is run **once
in a normal terminal by the developer**, and the agent triggers runs via a
sentinel file:

```text
agent ──touch .run-tests──▶ watch-and-test.sh
                                │
                                ├── kills any stale server on :3333
                                ├── runs `npx playwright test`
                                ├── writes .playwright-results.txt
                                └── removes .run-tests on pickup
```

### Run the watcher (developer)

```bash
/absolute/path/to/your/clone/tooling/satsuma-viz-harness/watch-and-test.sh
```

> **Always pass the agent the *full absolute path* to `watch-and-test.sh`.**
> Agents may be running inside a worktree at a non-obvious location such as
> `.worktrees/feat/<branch>/...`, and the developer will not know which clone
> the agent means without the absolute path.

### Trigger a run (agent)

```bash
touch tooling/satsuma-viz-harness/.run-tests
# wait for the file to disappear (watcher picks it up within ~1s)
# then read tooling/satsuma-viz-harness/.playwright-results.txt
```

A full run takes roughly 30–90 seconds. Results from the previous run remain
in `.playwright-results.txt` until the next run overwrites them, so always
check the file timestamp after triggering.

### Run directly (developer, not agent)

```bash
npm --prefix tooling/satsuma-viz-harness run test         # all projects
npm --prefix tooling/satsuma-viz-harness run screenshots  # screenshot project only
```

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
`features/30-viz-test-suite-expansion/PRD.md` §"Screenshot artifacts for human
and VLM review".

---

## Local checks before opening a PR

Before pushing changes that touch the harness, viz, or viz-backend, run:

```bash
npm --prefix tooling/satsuma-viz run test
npm --prefix tooling/satsuma-viz-backend run test
npm --prefix tooling/satsuma-viz-harness run build
# Then trigger the watcher and read .playwright-results.txt
```

The Playwright suite is the only one that requires the human-in-the-loop
watcher; the others run inside the normal agent sandbox.
