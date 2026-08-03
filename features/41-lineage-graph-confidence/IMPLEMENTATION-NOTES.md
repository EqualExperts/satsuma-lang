# Feature 41 — implementation notes and decisions

Running log for the autonomous implementation run started **2026-08-03**, branch
`feat/lineage-graph-confidence`. Every judgement call made without asking is
recorded here with its reasoning, so the PR review is a review of *decisions*
rather than an archaeology exercise.

Read the PRD (`PRD.md`) for the *why*. This file is only what changed about the
plan while executing it.

## Status at a glance

| Requirement | Ticket | State |
|---|---|---|
| R1 promote the generator to `satsuma-scenario-gen` | `sl-puky` | done |
| R2 workspace-shaped scenario model and ground truth | `sl-dqyu` | done |
| R3 structural edge invariants | `sl-hi0z` | done |
| R4 reachability properties | `sl-jsyn` | blocked — see [Feature 40 dependency](#the-feature-40-dependency-r4-and-r5) |
| R5 cross-consumer parity sweep | `sl-kwet` | blocked — same |
| R6 branded lineage endpoints | `sl-jyee` | blocked on Feature 39 R5, which has no ticket |

## The Feature 40 dependency (R4 and R5)

R4 (`sl-jsyn`) and R5 (`sl-kwet`) both depend on Feature 40's `sl-prlp`, which
extracts `traceFieldLineage` into a browser-portable package, which in turn
depends on the `sl-4871` spike. PRD decision 4 requires that ordering so the
properties aim at one portable traversal instead of a CLI-internal function about
to move, and so the `graph-builder.ts` / `field-lineage.ts` duplication is
*deleted* rather than acquiring two parallel property suites.

**Decision: respect that ordering; do not fold `sl-prlp` into this PR.** It is a
production refactor with a byte-identical-output requirement across two commands
(`sl-prlp`'s own acceptance criteria), in a PR whose entire premise is that it
adds no production behaviour. Overriding a recorded sequencing decision
unsupervised is the wrong trade even though it leaves two of six requirements
undelivered.

What was done instead, to make the follow-up as small as possible:

- **The `sl-4871` spike is delivered here** as a written finding (see
  `features/40-shared-field-lineage-view/`). It commits no production code — that
  is its own acceptance criterion — and it converts "blocked on an unstarted
  spike" into "blocked on one specified refactor".
- **R4's oracle ships early, inside R2.** Depth-bounded reachability over the
  scenario's own arrows is ground truth derived from the scenario, which is
  exactly what R2 is for. `scenarioAncestorsWithin` and
  `scenarioDescendantsWithin` are already in the generator package with their
  properties' invariants documented, so R4 becomes a test file that calls a
  traversal, not a design exercise.

## Findings that correct the PRD

### Feature 39 R4 shipped after the PRD was written

The PRD's asset table records "R4 independent coverage oracle — not ticketed".
It exists on `main`: `satsuma-core/test/support/coverage-oracle.js` plus
`test/generated-coverage-oracle.test.js`, delivered under `cbdr-da0j`. So R1's
move touched **three** core suites, not the two the ticket names. All three keep
every property and change only their imports.

This does not change the PRD's load-bearing argument — lineage still needs no
oracle of its own, because a generated scenario already *is* the graph — but it
does mean the coverage oracle is now a worked precedent for how a test-only
semantic model is written in this repo, and R2's ground-truth functions follow
its style deliberately.

## R1 — the generator package (`sl-puky`)

### The package is `@satsuma/scenario-gen`, three modules plus a barrel

`src/model.js` (shapes, constructors, path helpers), `src/render.js` (scenario →
Satsuma text), `src/arbitraries.js` (fast-check domains), `src/index.js` (public
surface). The original was one 493-line file; R2 roughly doubles the generator's
surface, so splitting on the seams the file already had was cheaper now than
later.

### Types got the `Scenario` prefix, values did not

`ScenarioField`, `ScenarioEntity`, `ScenarioArrow`, `ScenarioMapping`, and
`Scenario` for the whole thing (the ticket lists four names; the top-level
`SemanticScenario` needed one too and `Scenario` reads best). The *value* exports
keep their names — `semanticScenarioArbitrary`, `differentialCoverageScenarioArbitrary`
and the rest — because the collision the ticket warns about is with core's
exported **types** (`SemanticMapping` and friends in `validate.ts`), and renaming
the arbitraries would have churned three test suites for no safety gain.

### Core's adapter moved to `test/support/scenario-pipeline.js`

Renamed rather than kept as `generated-scenarios.js`: the file no longer contains
a generator, only the parse-and-assert and coverage-pipeline adapters. Leaving
the old name on a file that generates nothing would have been the most misleading
option available.

### TypeScript consumers need `allowJs` + `maxNodeModuleJsDepth: 1`

R1 mandates no build step, so the package publishes no `.d.ts`. The CLI's test
suite is TypeScript and typechecks under `strict`, so importing an untyped module
is a hard error there (TS7016).

Two ways to let `tsc` read the JSDoc were tried:

1. **`paths` mapping to the source** — narrower, but fails with TS6059: the
   generator's files sit outside `satsuma-cli`'s `rootDir`, and `tsc` enforces
   that even under `noEmit`. Unsetting `rootDir` is not possible in an extending
   config, only overriding it with a broader path, which is worse.
2. **`allowJs` + `maxNodeModuleJsDepth: 1`** — resolves through `node_modules`
   like any other dependency, so `rootDir` never applies. Verified clean, and
   verified to actually read the types (assigning `renderScenario`'s result to a
   `number` is reported as `string` is not assignable, not silently `any`).

Chose (2), with the reasoning recorded in `tooling/satsuma-cli/tsconfig.test.json`
beside the options. `checkJs` stays off: the generator's own correctness is not
the CLI's typecheck to enforce.

The theoretical cost of (2) is that untyped JavaScript from *other* dependencies
enters the program. In practice every other dependency of `satsuma-cli` ships
types, and the typecheck is clean.

### Editor-only wrinkle, deliberately not fixed

An IDE TypeScript server reports TS7016 on core's `.js` test files at the
`@satsuma/scenario-gen` import. No repo gate sees this: core's `test:typecheck`
covers `src/**` and `type-tests/**` only, by design. Fixing it would mean either
newly typechecking core's whole JS test tree — a much larger change than this
ticket — or a hand-written `.d.ts` that would silently drift from the JSDoc.
Neither is worth it; noted here so the next reader does not think it is news.

### Wiring

- `install:all`, `ci:all` and `clean:all` install/clean the new package **before**
  `satsuma-core`, which devDepends on it.
- The nine CI cache-path blocks gained `tooling/satsuma-scenario-gen/node_modules`.
- Added as a `devDependency` of `satsuma-core`, `satsuma-cli`, `satsuma-viz` and
  `satsuma-viz-backend`, and each verified to resolve it (acceptance test 3).
- `AGENTS.md`'s repository layout describes the package and its one hard rule.
- The package's own tests run **first** in both `scripts/run-repo-checks.sh` and the
  CI `satsuma-cli` job. Order matters: core's property suites depend on the
  generator, so a broken generator would otherwise present as a wall of unexplained
  property failures instead of one named failure.

## R2 — the workspace-shaped model (`sl-dqyu`)

### Two decisions that make the oracle trivially correct

**Endpoints name their schema explicitly.** An arrow endpoint is `{ schema, path }`,
never a bare string. Production code has to *infer* an authored ref's owning schema
— that inference is `qualifyField`, and `r0-7w76` is it guessing wrong. Had the
generator stored only the authored spelling, it would have needed the same inference
to state its own ground truth, and would have shared the bug. The renderer derives
the spelling *from* the schema instead: bare on a single-schema side, `schema.path`
on a multi-schema one.

**Paths are always absolute; relativity is a rendering concern.** A child arrow
inside `each orders -> shipments` stores `orders.order_no`; the renderer emits
`.order_no`. Container-relative resolution is exercised end to end — the shape
`3cdd-yavi` broke — while the ground truth never has to undo it. The renderer
*throws* if a child arrow reaches outside its block, because Satsuma has no notation
for that and emitting it would silently produce an undeclared path.

**`import` statements are derived from usage, not authored.** A workspace whose
imports disagreed with its own references would be semantically invalid, and the
properties would report the generator's bug as the toolchain's.

### Two shapes deliberately left out of the generated domain

Both are recorded in `workspace-arbitraries.js` beside the code that avoids them.

1. **A container header whose target is the schema root** (`flatten orders ->
   target_schema`) — that is `r0-7w76`. It has its own arbitrary,
   `schemaRootContainerWorkspaceArbitrary`, used only by the `todo` property that
   demonstrates the divergence.
2. **NL `@ref`s coinciding with a declared source or with the arrow's own target.**
   Both hit production *suppression* branches, which the oracle would have to
   restate to predict — the exact circularity the oracle exists to avoid. The
   hand-written `field-lineage` and `graph` suites keep covering them.

### The oracle has its own tests

`satsuma-scenario-gen/test/ground-truth.test.js`, 17 hand-written cases. An oracle
that is quietly wrong does not fail — it *weakens*, and every property built on it
keeps passing while defending less than it claims. These are deliberately not
property tests: a property over the oracle could only compare it to another
traversal of the same data.

### Two real bugs the R2 gates found immediately

The gates are "every generated workspace parses recovery-free" and "every generated
workspace validates clean". They earned their keep on the first run.

**`lgc-3f13` (P1) — a namespaced mapping targeting a global schema invents
`ns::name` everywhere.** `extract.ts:490-497` qualifies a mapping's *target* refs
with the enclosing namespace while deliberately leaving its *sources* authored. But
an unqualified name resolves current-namespace-then-global, so pre-qualifying
destroys what the resolver needs: `resolveScopedEntityRef` sees `ns_a::s1`, treats
anything containing `::` as fully qualified, finds nothing, and its `?? ref`
fallback keeps the invented key. From this one file —

```satsuma
schema s1 { field_0 STRING }

namespace ns_a {
  schema s0 { field_0 STRING }
  mapping m0 {
    source { s0 }
    target { s1 }
    field_0 -> field_0
  }
}
```

— four wrong answers: `validate` warns `undefined-ref` on a perfectly valid file;
`graph --json` emits a `schema_edges` endpoint `ns_a::s1` with no node; its field
edges point at `ns_a::s1.field_0`; and `lineage --from ns_a::s0` reports the data
flowing into a schema that does not exist. This is the *schema-level* twin of
`r0-7w76`, and it is exactly what R3's endpoint-existence property is for. The
generator avoids the shape for now (`mappingNamespace`, with the ticket referenced)
so R3 is not red for a defect it did not cause.

**`lgc-wtz1` (P2) — `graph --json` spells the same entity two ways.** `nodes[].id`
and `schema_edges[]` use the index-key form (`raw`), while `edges[]` uses the
canonical form (`::raw.field_0`, and `::raw` under `--schema-only`). They agree for
a namespaced entity and disagree for a file-scope one, so a consumer joining
`edges` to `nodes` finds no node for any file-scope schema. R3's
endpoint-has-a-node property normalises both forms and references the ticket.

**A generator bug the gates also caught,** worth recording because it is the failure
mode these gates exist for: `containerWorkspaceArbitrary` built a record chain one
level deeper than the block nesting, so every innermost arrow named a path that did
not exist. Reported as four `field-not-in-schema` warnings with the rendered source
attached, and fixed in the generator — not accommodated in a property.
