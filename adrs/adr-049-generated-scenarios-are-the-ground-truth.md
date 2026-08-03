# ADR-049 — A Generated Scenario Is Its Own Ground Truth, in a Package That Cannot Reach the Toolchain

**Status:** Proposed
**Date:** 2026-08-03 (sl-puky, sl-dqyu, sl-hi0z; feature 41)

## Context

Feature 39 introduced generated-input testing for coverage. Its generator built a
semantic scenario as plain data and rendered it to Satsuma, so property tests
crossed the real parser and extraction boundary instead of asserting on
hand-written trees. That generator lived in
`satsuma-core/test/support/generated-scenarios.js`.

Feature 41 pointed the same machinery at lineage and graph, and two problems
surfaced immediately.

**The generator was unreachable.** `test/` is not compiled to `dist/` and is absent
from core's `exports` map, so the CLI, the viz and the viz-backend — where every
lineage and graph property has to live, because that is where the code under test
is — could not import it. The options were a cross-package relative import into
another package's test tree, or a new home.

**The oracle problem has two different shapes, and only one of them needs a second
implementation.** Coverage needed one: the expected figure had to be restated from
ADR-034 through ADR-041, and the Feature 39 PRD rightly warns that two
implementations can share one misunderstanding. Lineage does not have that shape.
A generated scenario *already declares its arrows*, so the expected upstream set of
a field is the set of its ancestors under reachability over those arrows — a
definition with no Satsuma-specific content and nothing to misunderstand. The
oracle is a breadth-first search over data the generator produced.

That distinction is easy to lose. Two ways of losing it were live risks:

1. **Storing authored spellings.** An arrow is written `field_0` on a single-source
   side, `s0.field_0` on a multi-source one, and `.field_0` inside a container
   block. Production code must *infer* which schema owns each — that inference is
   `qualifyField`, and `r0-7w76` is it guessing wrong. A generator that recorded
   only the authored text would need the same inference to state its own
   expectations, and would then share the bug it was meant to catch.
2. **Restating suppression rules.** The `nl-derived` edge tier suppresses an edge
   that duplicates a declared source, and one whose `@ref` names the arrow's own
   target. Predicting those requires copying production branches into the oracle.

## Decision

**Generated scenarios live in `tooling/satsuma-scenario-gen`, a private test-only
package that must not depend on `@satsuma/core`; and the ground truth a property
asserts against is derived from the scenario alone.**

Five rules follow, and each closes one of the failure modes above.

- **No dependency on `@satsuma/core`, ever.** Core's own tests depend on this
  package, so the reverse edge would make core's test run need this package's
  output while this package needed core's `dist/` — a build cycle. It costs nothing
  because rendering is pure string building. The one-line reimplementation of
  `canonicalKey` in `workspace-model.js` is the price, and it is cheap and
  deliberate.

- **Pipeline adapters live with their pipeline, not in the package.** Parsing,
  extracting, computing coverage, building a graph, writing files and loading a
  workspace all happen in the consuming package's test tree —
  `satsuma-core/test/support/scenario-pipeline.js`,
  `satsuma-cli/test/support/generated-workspace.ts`, and a local `modelFor` in the
  viz's suite. Keeping pipeline code out of the generator is what stops it becoming
  a second production implementation of Satsuma's semantics.

- **A scenario stores resolved facts, and the renderer derives the authored form.**
  An arrow endpoint is `{ schema, path }` with an *absolute* path, never a bare
  string. `workspace-render.js` decides how it is written — bare, `schema.path`, or
  `.suffix` relative to its container. Production code has to invert that choice;
  the ground truth never does, because it reads the model. The renderer *throws*
  rather than emit a child arrow reaching outside its block, since Satsuma has no
  notation for that (spec §4.4) and emitting it would silently name an undeclared
  path.

- **Structure that must be consistent is derived, not authored.** A file's `import`
  statements are computed from the cross-file references its declarations make.
  Satsuma scopes symbols explicitly (spec §5.3), so a workspace whose imports
  disagreed with its usage would be *semantically invalid* — a generator bug the
  properties would report as a toolchain bug.

- **Shapes the oracle cannot predict without copying production logic are excluded
  from the generated domain, by name and with a reason.** Today: NL `@ref`s
  coinciding with a declared source or with the arrow's own target (suppression
  branches), and a container header targeting a schema root (`r0-7w76`, which is
  also inexpressible — a schema root has no field path). Hand-written tests keep
  covering them. An exclusion is a comment naming the ticket, never a silent gap.

Two consequences of the decision are load-bearing enough to state as rules:

- **Every generated workspace must pass two gates before any property may assert on
  it:** it parses recovery-free, and it produces no semantic diagnostic. A property
  asserting how lineage behaves on input the toolchain itself considers broken is
  asserting nothing worth knowing, and without the gates a failure is ambiguous
  between a real defect and a generator that emitted Satsuma nobody would write.

- **The oracle gets its own hand-written tests.** An oracle that is quietly wrong
  does not fail — it *weakens*, and every property built on it keeps passing while
  defending less than it claims. Those tests are deliberately not properties: a
  property over the oracle could only compare it against another traversal of the
  same data, which is the circularity the whole arrangement avoids.

The rule for a new generated-input suite is therefore: if you are about to write
code that predicts what the toolchain will say, stop. State what the scenario
declares, and let the property compare.

## Consequences

**Positive:**

- One generator serves every package. Core, the CLI and the viz all import it, and
  the LSP and viz-backend can without further work.
- The gates found two real toolchain bugs on their first run, before a single
  property existed: `lgc-3f13` (a namespaced mapping whose target is a global
  schema makes `graph`, `lineage` and `validate` all name a schema that does not
  exist) and `lgc-wtz1` (`graph --json` spells the same entity two ways across
  sibling arrays). They also caught a generator bug — a record chain one level
  deeper than its blocks — and reported it with the rendered source attached.
- Resolved endpoints made three further properties cheap that would otherwise have
  needed their own inference: endpoint existence, exactly-once edge emission, and
  the schema projection of a field-level graph.
- R4's oracle was deliverable before R4, because depth-bounded reachability over
  the scenario's arrows is just a property of the scenario. It shipped with R2.
- The package has no build step, so nothing has to be compiled before core's tests
  run.

**Negative:**

- A TypeScript consumer needs `allowJs` and `maxNodeModuleJsDepth: 1` to read the
  JSDoc types, because a package with no build step publishes no `.d.ts`. The
  narrower alternative — a `paths` mapping to the source — fails with TS6059, since
  the generator sits outside the consumer's `rootDir` and `tsc` enforces that even
  under `noEmit`. The reasoning is recorded in
  `satsuma-cli/tsconfig.test.json`; an IDE still reports TS7016 on core's `.js`
  test files, which no repo gate sees.
- Excluding shapes the oracle cannot predict means the generated domain has holes,
  and each hole is a place where only hand-written tests apply. They are named and
  commented, but a reader must consult the comments to know what is *not* covered.
- Storing resolved endpoints means the generator never produces an authored
  spelling nobody would write. It covers the spellings it chooses to render, and a
  malformed-but-parseable ref is out of reach by construction. That is a deliberate
  trade for a trustworthy oracle, not an oversight.
- The rule that adapters live with their pipeline means near-identical adapters in
  several packages. Consolidating them would put pipeline code in the generator,
  which is the thing this ADR forbids.
- Multi-file scenarios go through the filesystem, because `import` resolution is a
  filesystem operation. A property therefore creates and removes a temporary
  directory per run, which is slower than an in-memory index and is the only way to
  exercise the multi-file axis at all.
- One duplicated line: the canonical `[ns]::name` form is reimplemented in the
  generator rather than imported from core. If core's spelling ever changes, this
  copy must follow, and only a property failure would say so.
