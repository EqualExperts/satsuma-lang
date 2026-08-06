# Feature 40 — Shared Field Lineage View

> **Status: SUPERSEDED** by Feature 36, closed 2026-08-06. Raised 2026-08-03
> against `main` at `dd5ac032`, before Feature 36's field chain view
> (`sz-chain-view`) existed. By the time this feature's own tickets were
> picked up, Feature 36 had independently delivered everything this PRD asked
> for, through a different named component and design (a left-to-right rail,
> not a `sz-field-lineage` panel):
>
> - The traversal extraction (this PRD's Design §1) shipped as `sl-prlp`:
>   `traceFieldLineage`/`buildFieldEdges` in `@satsuma/core`, no Node built-ins,
>   consumed by both the CLI and `satsuma-viz-backend`'s
>   `buildFieldChainFromWorkspace` — one copy, not two.
> - The shared renderer (§2) shipped as `sl-4czz`'s `sz-chain-view` in
>   `satsuma-viz`, and `sl-iwlv` deleted the VS Code-only 560-line renderer,
>   284-line panel, and 330-line CSS this PRD's Background section measured —
>   `FieldLineagePanel` now renders `sz-chain-view` from a host-computed
>   `FieldChainModel`.
> - The harness surfacing (§3) shipped as `sl-nswc`: the harness's
>   `field-lineage` listener calls the traversal in-browser and renders
>   `sz-chain-view`, with seven Playwright specs, all through the
>   zero-network-request path this PRD required.
>
> Verified by reading the shipped code and running the existing test suites,
> not just by ticket status. This feature's own tickets (`sl-v3w5`, `sl-7ind`,
> `sl-hhdk`, epic `sl-12kz`) were closed as superseded rather than implemented,
> to avoid building a second lineage renderer alongside `sz-chain-view`.
>
> **Two genuine gaps survived the supersession** and were carried forward as
> `sv-embb`, because Feature 36's acceptance criteria never covered them: (1)
> an unresolvable field is not distinguished from a resolved field with empty
> lineage anywhere above the CLI, unlike the CLI's own
> `EXIT_NOT_FOUND` behaviour; (2) a cyclic chain is proven cycle-safe at the
> core traversal layer but was never rendered through `sz-chain-view` in a
> unit or Playwright test.
>
> The rest of this document is preserved as-written for historical context —
> it describes the problem accurately; only the proposed solution shape (a new
> `sz-field-lineage` component) was overtaken by events.

## Goal

Make field lineage a first-class, testable view rendered by one component, so
that the lineage a VS Code user sees is the lineage a test can assert on.

1. The lineage traversal is callable from a browser bundle, not only from a
   Node CLI process.
2. One renderer serves both the VS Code panel and the viz harness.
3. The lineage view is covered by automated tests, including visual/DOM tests in
   the Playwright harness.

## Background — measured state

### Field lineage is the only viz surface with no test surface

`satsuma-viz` emits a `field-lineage` event when the user clicks the lineage
icon on a schema-card field row (`satsuma-viz/src/satsuma-viz.ts:173` defines
`SzFieldLineageEvent`; `sz-schema-card.ts:1053` dispatches it). What happens
next depends entirely on the host:

| Host | Response to `field-lineage` | Test coverage |
|---|---|---|
| VS Code extension | `webview/viz/viz.ts:49` forwards it as a `fieldLineage` message; `webview/viz/panel.ts:175` opens `FieldLineagePanel`, which **shells out** to `satsuma field-lineage <field> <entry.stm> --json` and renders the result in its own webview | none |
| Viz harness | `src/client/app.ts:423` records the event in the harness event log and renders nothing | one test, asserting only that the event fires (`harness.test.ts:297`) |

Line counts for the VS Code-only lineage UI:

| File | Lines | Tests |
|---|---|---|
| `vscode-satsuma/src/webview/field-lineage/field-lineage.ts` (renderer) | 560 | 0 |
| `vscode-satsuma/src/webview/field-lineage/panel.ts` (host + subprocess) | 284 | 0 |
| `vscode-satsuma/src/webview/field-lineage/field-lineage.css` | 330 | — |

No file under `tooling/vscode-satsuma/test/` references field lineage. So 844
lines of lineage UI ship with no automated test of any kind, and the only place
that *could* test a browser-rendered lineage view — the Playwright harness —
has nothing to render.

By contrast the traversal itself is reasonably covered:
`satsuma-cli/test/field-lineage.test.ts` holds 17 tests.

### The traversal cannot reach a browser

`satsuma-cli/src/commands/field-lineage.ts` is 336 lines and mixes the
traversal with CLI plumbing. Its imports:

| Import | Why it blocks a browser bundle |
|---|---|
| `../load-workspace.js` | reads the workspace from disk (Node `fs`) |
| `../command-runner.js` | process exit codes, `CommandError` |
| `../option-parsers.js` | commander option parsing |
| `../index-builder.js` (`resolveIndexKey`, `canonicalKey`, `distinctArrowRecords`) | CLI-internal index representation |
| `../nl-ref-extract.js` (`resolveAllNLRefs`) | CLI-internal |
| `../spread-expand.js` (`expandEntityFields`) | CLI-internal |
| `@satsuma/core` (`collectFieldNames`, `findFieldByPath`, `resolveFieldEndpoint`) | already portable |
| `../types.js` (`ExtractedWorkspace`) | CLI-internal workspace shape |

The harness client cannot call any of this. It is deliberately server-free: the
client builds VizModels in-browser via `@satsuma/viz-backend`
(`viz-harness/src/client/model-pipeline.ts:17`), and
`playground-static.test.ts:100` asserts that editing, opening, and saving
complete with **zero** network requests. Shelling out to the CLI is not
available to it, and adding a lineage HTTP endpoint would contradict that
guarantee.

This is also a violation of the Core vs Consumer rule in `CLAUDE.md`: lineage
traversal is needed by the CLI, the VS Code extension, and the harness, so it
does not belong in a consumer package.

### There is already a portable home

`satsuma-viz-backend` is explicitly browser-portable. `workspace-index.ts`
opens by stating it has "zero Node built-in imports (no `path`/`url`/`fs`)"
precisely so one code path can serve the CLI, LSP, and the in-browser
playground. That, or `satsuma-core`, is where the traversal belongs.

## Design

### 1. Extract the traversal (`@satsuma/core` or `@satsuma/viz-backend`)

Introduce a pure function with no Node dependencies:

```
traceFieldLineage(workspace, fieldRef, { depth, direction }): FieldLineageResult
```

`FieldLineageResult` keeps the shape the CLI's `--json` already emits (`field`,
`upstream[]`, `downstream[]`, each entry carrying `field`, `via_mapping`,
`classification`), because that shape is a published contract consumed by the
VS Code panel today.

The CLI command becomes a thin adapter: parse args, load the workspace, call
the extracted function, format output. Its 17 existing tests must pass
unchanged — they are the regression gate for the extraction.

Placement decision (to be settled in the first ticket, not here): the traversal
needs an index and NL-ref resolution that currently live in CLI-internal
modules. If those are themselves portable, `satsuma-core` is the right home; if
they depend on the workspace index, `satsuma-viz-backend` is. Whichever is
chosen, the CLI must not keep a second copy.

### 2. One renderer: `sz-field-lineage` in `satsuma-viz`

Port the 560-line VS Code renderer to a Lit component in `satsuma-viz`,
alongside the existing `sz-*` components. It takes a `FieldLineageResult` and
renders the upstream/downstream chains. It carries `data-testid` attributes on
the same pattern as `sz-schema-card` so Playwright can address chain entries,
and it must theme from `tokens.css` so it works in light and dark like every
other viz surface.

The VS Code panel keeps its subprocess data path *or* moves to the extracted
function, but either way it renders `sz-field-lineage` instead of its own DOM.
The 330-line CSS file collapses into the component's styles.

### 3. Surface it in the harness

The harness client listens for `field-lineage` (it already receives the event at
`app.ts:423`), calls `traceFieldLineage` in-browser against the library-backed
workspace it already assembles, and renders `sz-field-lineage`. No server, no
subprocess, no new network request — so the zero-request guarantee holds.

## Success criteria

1. `traceFieldLineage` is importable from a browser bundle and has no Node
   built-in imports on its path.
2. `satsuma field-lineage` output is byte-identical for every case covered by
   the existing 17 CLI tests, which pass unchanged.
3. Exactly one renderer for lineage exists in the repo; the VS Code-only
   renderer and its CSS are deleted, not left in place.
4. Clicking a field's lineage icon in the harness renders the lineage view.
5. The VS Code panel renders the same component, verified in a real VS Code
   session.

## Acceptance tests

1. **Portability** — a browser-targeted build that imports `traceFieldLineage`
   succeeds, and a test asserts the module graph pulls in no `fs`/`path`/`url`.
2. **Extraction is behaviour-preserving** — the 17 `field-lineage.test.ts` tests
   pass with the CLI delegating to the extracted function.
3. **Harness renders lineage** — a Playwright test clicks a field lineage icon
   and asserts the rendered upstream/downstream chain entries for a known
   fixture (e.g. a `sfdc-to-snowflake` field with both directions populated).
4. **Both themes** — the lineage view is captured light and dark in the
   screenshot project, and no token resolves to a literal colour outside
   `tokens.css`.
5. **Empty and error states** — a field with no upstream, a field with no
   downstream, and an unknown field each render a defined state rather than an
   empty panel.
6. **Cycle handling** — a fixture with a cyclic field chain renders without
   infinite recursion, matching the CLI's cycle detection.

## Risks

- **The extraction is the whole risk.** The traversal is entangled with four
  CLI-internal modules; moving it may surface that those need to move too. The
  first ticket should be a spike that reports what must move, before any code is
  committed to a package.
- **Renderer parity is unverified by construction.** The current renderer has no
  tests, so "the port behaves the same" cannot be checked against anything.
  Capture screenshots of the VS Code panel before the port to serve as the
  reference.
- **Scope creep into lineage semantics.** This feature must not change what
  counts as lineage. Any semantic gap found during the port is a separate
  ticket.
