# ADR-050 — Cross-Consumer Parity Tests Get Their Own Package, Bounded to Portable Code

**Status:** Accepted
**Date:** 2026-08-04 (sl-kwet; Feature 41 R5)

## Context

Feature 38's `coverage-viz-parity.test.ts` compares `satsuma coverage`'s output
against the `VizModel` the webview and LSP consume, and it lived inside
`satsuma-cli/test/` — the reasoning given at the time was "the one place both
consumer paths are reachable in one process." Feature 41 R5 (`sl-kwet`) needed
the same shape of test for field edges: does the CLI's extraction
(`satsuma-cli/src/index-builder.ts`, a thin wrapper over core's
`extractMappings`) agree with `viz-backend`'s independent CST walk
(`viz-model.ts`'s `extractMapping`/`extractArrow`) about what an arrow's
resolved endpoint is? `field-coverage.ts`'s doc-comment already claims its walk
"mirrors core's `extractArrowRecords`"; nothing tested that claim, and coverage
had already learned the expensive way (ADR-036, ADR-037, sl-46wr, sl-csrs) that
an unverified mirror drifts.

Two questions came up while placing the new test that the original placement
had not had to answer, because it only reached one step beyond the CLI:

**Where should a test that inherently needs two packages' internals live?**
`satsuma-cli/test/` was reused for coverage because nothing depends on the
CLI, so a devDependency it adds for testing is a dead end in the graph rather
than an inversion. But a CLI test tree is not what either the CLI or
`viz-backend` mean by "our tests" — it is a third thing wearing the first
package's clothes. `viz-backend` itself cannot host it: it is deliberately
Node-independent (usable in a browser, no Node built-ins on its import path),
so importing the CLI's `fs`-based `loadWorkspace` into its test tree would
invert the real dependency direction (core ← viz-backend ← {LSP, viz}; the CLI
sits beside that, depending only on core).

**Is every "reachable in one process" dependency equally acceptable?** R5 also
needed "the edges the viz layout would draw" — `satsuma-viz`'s ELK layout
engine (`elk-layout.ts`), historically where the real edge-drawing bugs lived
(`3cdd-yavi`, `sl-l7u0`). But `@satsuma/viz` ships one esbuild-bundled,
minified `dist/satsuma-viz.js` containing the Lit web component; `tsc` runs
with `noEmit: true`, so there is no unbundled way to import `computeLayout`
without a DOM shim for Lit, even though `elk-layout.ts` and everything it
calls (`field-coverage.ts`, `metric-adapter.ts`, `model.ts`, `elkjs`) touch no
DOM API at all. Depending on `@satsuma/viz` from a test that only needs a
DOM-free function would mean carrying Lit and a DOM shim as a devDependency
purely to work around a packaging gap in a different package.

## Decision

Cross-consumer parity tests live in a new package, `tooling/integration-tests/`,
not in any consumer's own test tree. `coverage-viz-parity.test.ts` moved there
from `satsuma-cli/test/`, and the new `field-edge-parity.test.ts` joined it.
This package depends on `satsuma-cli`, `@satsuma/core`, `@satsuma/viz-backend`,
and `@satsuma/scenario-gen` as devDependencies; nothing else depends on it, so
it can carry whatever a specific sweep needs without constraining any real
package's architecture.

`satsuma-cli` gained one export subpath for this purpose, `"./testing"`
(`dist/testing.js`), re-exporting exactly `loadWorkspace`,
`createFieldEdgeSource`, `distinctArrowRecords`, `arrowEndpoint`,
`coverageForWorkspace`, and `resolveAllNLRefs` — mirroring the pattern
`@satsuma/viz-backend`'s `./workspace-index` and `./viz-model` subpaths
already established, so a cross-package integration test can build the CLI's
real, in-process answer instead of re-deriving it or parsing subprocess
`--json` output.

Rendering-layer packages are out of bounds for this kind of test even when
their algorithm is the thing being verified. Rather than depend on
`@satsuma/viz`, `field-edge-parity.test.ts` feeds both the CLI's index and a
`VizModel` through the *same* core `buildFieldEdges` function, using the *same*
`resolveEndpoint` (`arrowEndpoint`) on both sides, so any disagreement is a
genuine extraction-pipeline bug rather than a re-litigated endpoint-resolution
question. The viz side is adapted by
`tooling/integration-tests/test/support/viz-field-edges.ts`, a small,
deliberate re-port of `field-coverage.ts`'s `forEachMappingArrow`
container-scope algorithm, built from the one primitive in that algorithm that
*is* portable: core's `qualifyChildArrowPath`. The ELK/port-resolution layer
itself stays covered where it already was — `satsuma-viz`'s own
`generated-edge-completeness.test.js` (sl-hi0z), against generated workspaces;
extending that to the real corpus is a separate, later decision, not this one.

## Consequences

**Positive:**

- A cross-consumer claim ("the CLI and the model agree") has one home instead
  of squatting in whichever package happens to be a safe dependency leaf, and
  that home can depend on anything a future sweep needs without any real
  package inheriting the cost.
- `satsuma-cli`'s test-only export surface is explicit and narrow (one file,
  six names) rather than an implicit "whatever a test file's relative import
  happens to reach," making it obvious what cross-package tests may rely on.
- No package acquires a dependency that exists only to make it importable by
  a test — `viz-backend` stays Node-independent, and `satsuma-cli` stays
  Lit-free.

**Negative:**

- A third package now needs installing and building before its tests run
  (`npm --prefix tooling/integration-tests install`, wired into
  `install:all`/`ci:all`), adding one more step to the local hook and CI.
- The viz-side adapter (`viz-field-edges.ts`) is a second implementation of
  `forEachMappingArrow`'s container-scope accumulation, existing specifically
  so the sweep does not depend on `@satsuma/viz`. Keeping it in sync with the
  real algorithm — both call the same `qualifyChildArrowPath` primitive, but
  the recursion around it is duplicated — is a maintenance cost this decision
  accepts deliberately, in exchange for not growing a devDependency on a
  rendering package.
- Real ELK/port-resolution agreement against the shipped example corpus is not
  covered by this decision and needs a follow-up ticket inside `satsuma-viz`'s
  own test tree.
