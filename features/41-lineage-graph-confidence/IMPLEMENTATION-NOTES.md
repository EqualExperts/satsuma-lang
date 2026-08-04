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
| R4 reachability properties | `sl-jsyn` | blocked on `sl-prlp` then `spr-w98t` — see [Feature 40 dependency](#the-feature-40-dependency-r4-and-r5) |
| R5 cross-consumer parity sweep | `sl-kwet` | blocked on `sl-prlp` — same |
| R6 branded lineage endpoints | `sl-jyee` | done |

## No ADR for the generator package — dropped on review, 2026-08-04

An ADR-049 (*a generated scenario is its own ground truth, in a package that cannot
reach the toolchain*) was drafted with Status: Proposed and flagged for sign-off. The
answer was no, and it has been removed from the branch.

The two rules it would have recorded are stated where they are enforced instead:
`docs/developer/ARCHITECTURE.md` gives the package's position below core and why the
absence of a toolchain dependency is what makes it usable as an oracle, and
`satsuma-scenario-gen`'s own module comments carry the no-core-dependency rule at the
place a contributor would break it. Nothing referenced the ADR.

## Feature 39 R5 had shipped — R6 was never actually blocked

The PRD's Feature 39 asset table recorded R5 (opaque path/ref stages) as "not
ticketed", and `sl-jyee`'s body repeats that. Both were wrong by the time this branch
started: R5 landed on `main` as `cbdr-e6ft` (the five opaque types, their validating
constructors and the named transitions) and `cbdr-5r4d` (enforcement at the coverage
boundaries), recorded in **ADR-044**. The PRD was checked against `c93b1130`, one
commit before `fd409931`/`b97ecec9` put R5 on `main`.

R6 was therefore ready, not blocked, and is delivered on this branch. See
[R6](#r6--branded-lineage-and-graph-endpoints-sl-jyee) below. The PRD's asset table and
ticket map are corrected in the same commit.

## What I did not do

Ranked by what I would pick up next.

1. **Fix `lgc-4bxl` and `lgc-fu7o`** (both P1, both viz, both small). They are the
   two highest-value items here: a phantom lineage edge and a hover that points at
   the wrong card are user-visible wrong answers, and both properties are already
   written and waiting — the pinned test goes red on the fix and tells you what to
   replace it with. They are
   *not* in this PR because `sl-hi0z` says to record such findings against their own
   ticket rather than fix them here, and because changing what the viz draws deserves
   the Playwright harness and a look at the picture.
2. **Fix `lgc-3f13`** (P1, core). Bigger blast radius: it changes what
   `ExtractedMapping.targets` contains, so every consumer of that field needs
   checking. It also unblocks the generator's namespaced-chain arbitrary generating
   the shape again, which widens R3's domain for free.
3. **R4 and R5**, once Feature 40's `sl-prlp` lands — see below. R4's oracle is
   already shipped, but R4 also waits on `spr-w98t` (see the
   [addendum](#addendum-2026-08-04--one-bug-now-sits-between-sl-prlp-and-r4)).
4. **`lgc-wtz1`** (P2, cosmetic but corrosive): one spelling per entity across
   `nodes`, `edges`, `schema_edges` and `field-lineage`. Landing it deletes the two
   normalisation shims in R3's properties and the same shims R5 would otherwise need.

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

### Addendum, 2026-08-04 — one bug now sits between `sl-prlp` and R4

Re-planning `sl-prlp` against the spike surfaced `spr-w98t` (P1): `sl-y89y`'s
`DepthAwareTraversal` fix — shallowest-visit-wins, re-expanding on strictly shallower
revisits — landed only in `commands/lineage.ts`, the *schema-level* walk.
`field-lineage.ts`'s `traceUpstream`/`traceDownstream` still use the original
first-visit-wins visited set, so a field reached first by a long path is never
re-expanded when a shorter one reaches it with budget left.

That matters here because **R4's depth-exactness property is written to catch exactly
this** ("the result at depth *n* is exactly the nodes whose shortest path is ≤ *n*",
chosen over monotonicity precisely because the buggy version satisfies monotonicity).
So R4 is red against the traversal `sl-prlp` extracts, and the fix cannot ride inside
`sl-prlp`, whose acceptance criteria require byte-identical output. The chain is now
`sl-prlp` → `spr-w98t` → `sl-jsyn`, recorded as a dependency.

The spike's claim that "every logged traversal defect lives in the traversal half"
holds — it just understated it: one of the two is still live.

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

## R3 — structural edge invariants (`sl-hi0z`)

Nine properties, in two files:
`satsuma-cli/test/generated-edge-invariants.test.ts` (the graph's edges) and
`satsuma-viz/test/generated-edge-completeness.test.js` (the edges the layout draws).

| Property | Defends against | State |
|---|---|---|
| Every field-edge endpoint is a declared path | invented endpoints (P1) | green |
| A container header onto the schema root invents `::mart.mart` | `r0-7w76` | **pinned** |
| The emitted edge set is exactly the declared set | dropped *and* invented (P2) | green |
| Every arrow in a nested container block gets an edge | `3cdd-yavi`, `sl-l7u0` | green |
| Every field-edge endpoint's schema has a node | `sl-p895`'s backfill | green |
| Every schema-edge endpoint has a node, under `--namespace` too | same, filtered | green |
| `--namespace` edges are a subset of the unfiltered ones | filter soundness | green |
| The edge set survives reordering declarations | order-independence | green |
| The edge set survives splitting across more files | file-independence | green |
| The layout draws every declared arrow (chain, container, spread, namespaced) | silent port-resolution skips | green |
| Only the first source of a multi-source arrow is drawn | `lgc-fu7o` | **pinned** |
| A computed arrow is drawn as a phantom line | `lgc-4bxl` | **pinned** |

### Three known defects are *pinned*, not skipped — and `{ todo: … }` is unusable here

The three properties that fail on current behaviour started as `{ todo: … }`. That
broke CI's **Test report** check, and the reason is worth writing down: node's JUnit
reporter puts a **`failure=` attribute on a failing `todo` testcase**, alongside
`<skipped type="todo">`. `dorny/test-reporter` reads the attribute and fails the
check. So a `todo` test that actually runs and throws is not viable in this
repository — only one that is never executed.

Each was therefore rewritten to **pin the current, wrong behaviour**: it asserts the
invented endpoint, the phantom edge, the single drawn edge. That is strictly better
than a skip in three ways — the defect has an executable description, the test goes
**red the moment the bug is fixed** so nobody can fix it and leave a stale
expectation behind, and it catches the defect *changing shape*. Each opens with a
`⚠️ THIS TEST PINS A KNOWN DEFECT` banner naming the ticket and saying what to
replace it with, and each failure message tells the reader to read the comment
before touching the expectation.

### The mutation checks the ticket asks for, run and confirmed

- **Removing the `nsFilter` node backfill** (`graph-builder.ts:196-249`) makes the
  endpoint-has-a-node property fail with `schema edge endpoint has no node under
  --namespace ns_a`. Acceptance test 8. ✅
- **Reverting the container-relative qualification** in `elk-layout.ts` — the
  pre-`3cdd-yavi` behaviour — makes the container property fail with `actual: []`,
  which is precisely the original symptom: *no lines at all*. Acceptance test 7. ✅
- **Acceptance test 6 is not runnable as written.** It says "reverting
  `qualifyField`'s guard" makes the endpoint property fail; there is no guard to
  revert — the function has always guessed. The pinned property is the executable
  form of the same claim: it fails *now*, on the shape `r0-7w76` owns.

  **R6 gives the mutation a home.** The guess now lives at one named site,
  `arrowEndpoint` in `satsuma-cli/src/field-endpoints.ts`, so the mutation the
  acceptance test wanted is a one-line change there. The PRD text has been
  corrected to describe it that way.

### Three permitted omissions on the viz side, enumerated rather than shrugged at

The viz's edge set is deliberately a subset of the CLI's, so the property lists
what may be missing — which is what makes a *fourth* kind of omission a failure:

1. **`nl-derived` edges.** The VizModel carries no resolved `@ref`s, so the layout
   could not draw them.
2. **Container *header* edges.** The viz treats a block header as a scope, not an
   arrow, consistently in both its walks (`forEachMappingArrow` does not visit
   headers; `addMappingEdges` does not draw them). `satsuma graph` counts the header
   as an arrow record and emits an edge. **This is a genuine consumer divergence and
   is the first question for R5's parity sweep** (`sl-kwet`) — it is a coherent
   convention rather than a dropped edge, so R3 permits it rather than failing on it.
3. **Computed arrows** — `lgc-4bxl`, excluded rather than blessed.

### Two more real bugs, both viz, both P1

`sl-hi0z` says explicitly: if a property fails on current behaviour, record it
against the owning bug ticket rather than weakening the assertion. So these are
raised and pinned, not fixed here. Both are small, well-understood fixes and
are the highest-value follow-up in this area — see [What I did not do](#what-i-did-not-do).

**`lgc-4bxl` — a computed arrow is drawn as a line from a same-named source
field.** `addMappingEdges` resolves a sourceless arrow's source with
`: targetField` — it looks the *target's* own name up in the *source* schema. When a
field of that name exists there (the normal case, since matching names on both sides
is the norm) the viz draws a line asserting lineage the Satsuma explicitly denies;
when it does not, the edge is silently dropped. A phantom lineage edge is worse than
a missing one: it is a confident claim about where data came from. `satsuma graph` is
correct here — it emits `"from": null`.

**`lgc-fu7o` — only the first source of a multi-source arrow is drawn, and hover
points at the wrong card.** `a.sourceFields[0]` and nothing else, against spec §4.2's
"one edge per source field". Worse than a plain omission because the hover path does
*not* share it: `sz-edge-layer.ts:218` highlights on the whole authored
`arrow.sourceFields`, so hovering the **second** source highlights the single drawn
edge — which runs to the **first** source's card. The ticket also records a latent
contract problem in the same code path: `LayoutEdge.sourceField` holds the authored
ref, so it is schema-local for a bare ref and schema-prefixed for a qualified one,
with no doc comment and two meanings.

### `satsuma-viz` now runs in the local pre-commit hook

CI has always run it through the `tooling-modules` matrix, but
`scripts/run-repo-checks.sh` did not — so the viz properties, the ones defending
against a mapping that renders no lines at all, would only have failed after a push.
Added to the existing parallel step. **Revert this if commit time matters more**; the
cost is `satsuma-viz`'s `pretest` (a `tsc --noEmit` plus an esbuild bundle).

## R6 — branded lineage and graph endpoints (`sl-jyee`)

The only production change in this feature. No command output moved: all 1046 CLI
tests, including `graph.test.ts`, `field-lineage.test.ts`, R3's generated edge
invariants and the coverage parity sweep, pass unchanged.

### `qualifyField` is gone, replaced by a resolution that reports the fork

`qualifyField(field, schemas) -> string` collapsed three different situations into
one string, and its last line — `` `${schemas[0]}.${field}` `` — emitted a guess
that read as a fact. It is replaced by:

```ts
resolveFieldEndpoint(authored: AuthoredFieldRef, schemas: readonly string[])
  : FieldEndpointResolution
```

with three variants a caller has to acknowledge:

| Variant | Means |
|---|---|
| `field` | the owning schema was determined; carries the `CanonicalFieldEndpoint` |
| `schema-root-or-field` | the token is a bare name that *also* names a declared schema on this side, so it reads as that schema's root **or** as a same-named field; carries both readings |
| `unqualifiable` | the mapping declares no schema on this side, so there is no owner to attach to |

The middle variant is `r0-7w76` made typed. Core no longer chooses.

### One new stage, and the guess moved to one named site

`CanonicalFieldEndpoint` joins Feature 39 R5's vocabulary (ADR-044) as the last
stage in the field family: a `CanonicalEntityRef` for the owning schema plus an
optional path into it. `reference-stages.ts` owns that spelling in **both**
directions — `fieldEndpointOf` composes, `fieldEndpointSchema` /
`fieldEndpointPath` decompose — which is what let `graph-builder.ts:622`'s
`edge.from.split(".")[0]` go away.

The remaining decision lives in `satsuma-cli/src/field-endpoints.ts`
(`arrowEndpoint`), called by all three emitters: `graph-builder.ts`,
`field-lineage.ts` and `nl-ref-extract.ts`. It reads `schema-root-or-field` as a
field, exactly as today, behind a labelled rule comment. `resolution.schemaRoot`
is the other answer, sitting unused one line away, so deciding `r0-7w76` is a
one-line change at one site rather than an archaeology exercise across three.

`test/field-endpoints.test.ts` pins that choice with the same ⚠️ banner R3 uses,
so the fix turns it red and the comment says what to replace it with.

### Aggregation carries the schema instead of re-deriving it

`buildFieldEdges` now returns a `ResolvedFieldEdge` — the serialized `FieldEdge`
plus the branded endpoints it was built from — so `--schema-only` aggregation
projects onto the schema *core determined*. Previously the field-level walk and
the schema-level walk derived the owning schema independently, which is how two
walks over one graph stop agreeing. The protocol shape is untouched: `FieldEdge`,
`WorkspaceGraph`, VizModel and the LSP payloads are all still plain strings.

### What R6 deliberately did not do

- **It does not decide `r0-7w76`.** The emitted string is byte-identical.
- **It does not touch `viz-backend`'s `stripped.split(".")[0]`**
  (`workspace-index.ts:964`). That reads the first segment of *authored* NL-ref
  text to find a schema name — a different question from unbranding an endpoint,
  and outside this ticket's "graph and lineage code".
- **It leaves the CLI's `canonicalKey` alone.** Core's endpoint constructors state
  the same `[ns]::name` rule but reject an empty name, and `canonicalKey` is used
  for display keys where the empty case is reachable (`record.mapping ?? ""`).
  Rerouting it would turn that into a throw.
