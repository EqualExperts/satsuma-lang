# Feature 41 — Generated-Input Confidence for Lineage and Graph

> **Status: PROPOSED** (raised 2026-08-03) — raised while assessing whether
> Feature 39's generated-input machinery, which is deliberately scoped to
> coverage, transfers to the rest of the toolchain.
>
> **State this PRD was checked against:** `main` at `c93b1130`.
>
> **Recommendation.** Proceed. Lineage is the strongest available target for
> generated-input testing in this repository, for a reason that does not apply to
> coverage: the generated scenario *is* the ground-truth graph, so the oracle is
> free rather than something that has to be re-derived from ADRs. Deliver it as a
> sequence of independently valuable tickets, starting with the two that are
> unblocked today.
>
> **What this feature is not.** It changes no Satsuma syntax, no lineage or graph
> semantics, and no command output. It decides nothing about `r0-7w76`. It adds
> no user-facing surface. Every deliverable is a test, a test-only generator, or
> a type that makes an existing prose rule mechanical.

## Goal

Make the lineage and graph surfaces defend their own invariants, so that an
invented endpoint, a silently dropped edge, or a truncated traversal fails a test
instead of shipping.

1. Every edge any consumer emits names a field the workspace actually declares.
2. Every arrow the model holds produces an edge, or is dropped by a named and
   commented exception.
3. Traversal answers are checked against reachability over a graph whose shape
   the test chose, not against hand-picked fixtures.
4. The CLI, the viz and the LSP are shown to agree about the edges of one
   workspace, rather than asserting it in prose.

## Background — measured state

### What Feature 39 already banked, and what is still landlocked

| Feature 39 asset | State at `c93b1130` | Applies to lineage/graph? |
|---|---|---|
| R1/R2 generated CST symbol contract | Delivered in core, CLI, LSP and viz-backend (`gcsc-ejb2`, `tcc-e35f`, `tcc-ef1b`, `tcc-yb3z`, `tcc-chls`) | **Already applies.** No further work — a renamed grammar symbol is already a compile error in every package that builds lineage. |
| R3 semantic generator and renderer | Delivered (`cbdr-o6xn`, `cbdr-yp9m`), but lives in `satsuma-core/test/support/generated-scenarios.js`, which is under `test/`, is not compiled to `dist/`, and is absent from core's `exports` map | Needs promoting and extending. This is the reusable asset. |
| R4 independent coverage oracle | Not ticketed | **Not needed here.** See below. |
| R5 opaque path/ref stages | Not ticketed | Directly relevant — lineage endpoints are the same unbranded strings. |
| Parity sweep (`satsuma-cli/test/coverage-viz-parity.test.ts`) | Delivered for coverage, 219 lines, one sweep over the corpus | The single highest-value pattern to replicate for edges. |

### Why lineage needs no independent oracle

Coverage required R4 because the expected answer had to be restated from
ADR-034–041, and the PRD for Feature 39 correctly warns that two implementations
can share one misunderstanding.

Lineage does not have that shape. A generated scenario already declares its
arrows, so the expected upstream set of a field is the set of its ancestors under
reachability over those arrows — a definition with no Satsuma-specific content
and nothing to misunderstand. The oracle is a breadth-first search over data the
generator produced.

This is why lineage is a better target than coverage was, not merely another one.

### Five sites resolve one question, and their agreement is prose

"What field does this arrow point at, and which schema owns it" is answered in
five places:

| Site | What it does |
|---|---|
| `satsuma-core/src/canonical-ref.ts:56` `qualifyField` | qualifies an authored ref against a mapping's schema list |
| `satsuma-cli/src/commands/graph-builder.ts:458` `buildFieldEdges` | declared arrows plus NL-derived edges → `FieldEdge[]` |
| `satsuma-cli/src/commands/field-lineage.ts:159` `buildFieldEdgeGraph` | a near line-for-line duplicate of the above, minus namespace filtering and NL text |
| `satsuma-viz/src/field-coverage.ts:82` `resolveSchemaLocalFieldPath` and `forEachMappingArrow` | wraps core's `schemaLocalFieldPath`, adding one card-specific rule; its doc-comment states the walk "mirrors core's `extractArrowRecords`" |
| `satsuma-viz/src/layout/elk-layout.ts:705` `findPort` | resolves each endpoint to an ELK port |

Only the fourth of these delegates its path rules to core, and even there the
*arrow walk* mirrors core's by hand. Nothing tests the mirroring.

### Three failure modes, all previously caught by hand

**1. Invented endpoints.** `qualifyField` ends with an unconditional
`` `${schemas[0]}.${field}` `` (`canonical-ref.ts:75`). It has no access to the
declared field set, so it cannot tell a bare field name from a container header
naming the schema root, and emits `mart::species_fact.species_fact` for
`flatten observations -> species_fact`. `satsuma validate` reads the same token
correctly via `resolveFieldPath`, so core holds two readings of one authored
form. Open as **`r0-7w76`**.

**2. Silently dropped edges.** `elk-layout.ts:754` reads
`if (!sourceNode || !srcPort || !tgtPort) continue;`. When container-relative
arrows were not qualified against their container, every such arrow resolved to
no port and its edge vanished — nested-iteration mappings drew no lines at all
and no test failed (**`3cdd-yavi`**; **`sl-l7u0`** is the same class). There is no
assertion anywhere that an arrow in the model must produce an edge.

**3. Truncated or invented traversals.** `lineage.ts` records the shallowest
depth each node was expanded at because a plain visited-set silently truncates a
subtree when a later, shorter path arrives with budget remaining (**`sl-y89y`**).
`lineage --to` once returned a single upstream chain instead of every declared
branch (**`sg-pufq`**). NL backtick refs in transform text once manufactured
phantom source edges (**`cbh-y5og`**). Each of these is one sentence about
reachability.

A fourth pattern is adjacent: `sl-p895` was fixed by a node-backfill block
(`graph-builder.ts:196-249`) that walks the schema edges and adds any endpoint
missing from `nodes`, so callers "can rely on structural consistency without
further checks". That is an invariant maintained by construction with nothing
stating it.

### The existing test surface is a list of remembered cases

| Suite | Tests |
|---|---:|
| `satsuma-cli/test/graph.test.ts` | 37 |
| `satsuma-cli/test/field-lineage.test.ts` | 17 |
| `satsuma-cli/test/lineage.test.ts` | 11 |

All 65 are valuable and all 65 are cases someone thought of. By contrast, the
coverage parity sweep — one test — held on the two fixtures it was written
against and failed on twelve shipped examples the moment it was pointed at the
corpus.

### The generator is one mapping wide

`generated-scenarios.js` models a single `mapping` over scalar/record fields with
optional fragment spreads, and renders arrows as `sources -> target`
(`renderMapping`, line 160). That was the right domain for coverage. Lineage
needs chains, so it needs more than one mapping, and the interesting endpoint
bugs live in namespaces, containers and NL refs — none of which the model can
express today.

The module does, however, already split along the line this feature needs: the
semantic model, the arbitraries and `renderScenario` are pure string building,
while only `parseGeneratedScenario`, `coverageForScenario`, `toCoverageFields`
and `entityKey` import `@satsuma/core`.

## Problems

### P1 — An emitted endpoint need not exist

No consumer checks that the field it names is declared. The failure is invisible
in the emitting command and surfaces only when a different command is asked about
the same name (`r0-7w76`).

### P2 — A dropped edge is indistinguishable from no edge

Every resolver in the chain fails closed by skipping. Skipping is sometimes
correct, but nothing separates the correct skips from the regressions, so a
whole class of mapping can stop rendering silently.

### P3 — Traversal correctness is asserted on chosen graphs

Depth limits, cycles, diamonds and multi-branch upstreams interact. The three
defects above are all combinations, and combinations are what generated inputs
explore.

### P4 — Cross-consumer edge agreement is a prose claim

Coverage learned this the expensive way: a consumer that derives its own answer
from the model's arrows drifts, and every new rule has to be written twice
(ADR-042 records the resolution for coverage). Edges are still in the
pre-ADR-042 position, with a mirrored arrow walk and a private port resolver.

### P5 — The generator cannot be reached from the packages that need it

It is a `test/` file in another package. Consuming it from the CLI, viz or LSP
test suites requires either a cross-package relative import into a test tree or a
new home.

## Delivery Requirements

### R1 — Promote the scenario generator to a shared, cycle-free test package

Create `tooling/satsuma-scenario-gen`: private, `type: module`, plain ESM `.js`
with JSDoc types exactly as today, and **no build step** — the current file needs
none.

- It takes the pure half of `generated-scenarios.js`: the semantic model
  constructors, `semanticLeafPaths`, `renderScenario` and its helpers, the
  arbitraries, and `GENERATED_PROPERTY_PARAMETERS`.
- Its only dependency is `fast-check`.
- It **must not** depend on `@satsuma/core`. Core's tests will depend on this
  package, so a dependency back on core would create a build cycle where core's
  test run needs the package's output and the package's build needs core's
  `dist/`.
- The core-pipeline adapters — `parseGeneratedScenario`, `coverageForScenario`,
  `toCoverageFields`, `entityKey` — stay in `satsuma-core/test/support/`. Each
  consumer package owns its own equivalent thin adapter next to the pipeline it
  drives. This is the same reasoning as Feature 39's decision 3: keeping the
  scenario package free of pipeline code is what stops it becoming a second
  production implementation.
- Exported type names must not collide with core's validation model, which
  already exports `SemanticMapping`, `SemanticArrow` and `SemanticSchema` from
  `validate.ts` for an unrelated purpose. Use a `Scenario` prefix
  (`ScenarioMapping`, `ScenarioArrow`, `ScenarioField`) in the new package and
  rename the JSDoc typedefs accordingly.
- `satsuma-core/test/generated-coverage-properties.test.js` and
  `generated-format-properties.test.js` keep every property they have and change
  only their import path. Their pass/fail behaviour is the regression gate for
  the move.

### R2 — Extend the semantic model from one mapping to a workspace

Grow the model to a workspace of files, adding each axis as its own arbitrary so
that a property can pick the smallest domain that exercises it rather than paying
for every axis at once:

| Axis | Why lineage needs it |
|---|---|
| Multiple mappings forming chains, diamonds and deliberate cycles | the entire subject of traversal properties; `sg-pufq` is a diamond and `sl-y89y` is a re-entered node |
| Multiple files plus `import` | the LSP's `computeFullLineage` merges per-file models across the import-reachable set; a single-file scenario cannot reach it |
| Namespaces | `qualifyField` has a namespace-matching branch (`canonical-ref.ts:68-72`) with no generated coverage, and `r0-7w76` reproduces in both the global and namespaced cases |
| `each`/`flatten` containers with container-relative arrows | the exact shape of `3cdd-yavi` and `r0-7w76` |
| NL `@ref` transform text | `cbh-y5og`'s phantom edges, and the `nl-derived` edge tier both CLI builders emit |
| `derived` blocks | sourceless arrows, which the graph represents as `from: null` |
| Metrics | `metric_source` schema edges, a distinct edge role |

Two gates on every generated workspace:

1. it parses recovery-free — the existing `parseGeneratedScenario` assertion; and
2. it validates clean via core's `validateSemanticWorkspace`, so no lineage
   property ever asserts over input the toolchain itself considers broken.

Expose the ground truth the properties consume, derived from the scenario and not
from any production code:

- `scenarioFieldEdges(scenario)` — every `(fromField, toField, mapping)` the
  scenario declares, with fully qualified endpoints;
- `scenarioSchemaEdges(scenario)` — the same projected onto schemas, with roles;
- `scenarioDeclaredFieldPaths(scenario)` — every qualified declared leaf and
  container path, for the endpoint-existence property.

### R3 — Structural invariants: nothing invented, nothing silently dropped

Over generated workspaces, for the CLI's graph assembly, the portable traversal
and the VizModel plus its layout:

| Property | Catches |
|---|---|
| Every endpoint of every emitted edge is in `scenarioDeclaredFieldPaths` | P1; fails today on `r0-7w76`'s shape |
| Every edge in `scenarioFieldEdges` is emitted exactly once, and every emitted edge is in `scenarioFieldEdges` | P2 in both directions — dropped and invented |
| An edge may be omitted only where a named, commented exception applies; the property enumerates the permitted exceptions | closes the `elk-layout.ts:754` blind spot without forbidding legitimate skips |
| Every edge endpoint is backed by a node, including under `--namespace` | promotes `sl-p895`'s backfill to a stated invariant |
| `graph --namespace ns` edges are a subset of the unfiltered edges | filter soundness, currently untested as a general rule |
| The edge *set* is invariant under permuting declaration order, and under splitting the same declarations across more files | order- and file-independence, which the import-merge path assumes |

The viz-side property runs in `satsuma-viz`'s node test suite: `layout.test.js`
and `dom-shim.js` already make ELK layout reachable without a browser, so this
needs no Playwright harness work.

### R4 — Reachability properties with the scenario as oracle

Against the portable traversal extracted by `sl-prlp`:

| Property | Catches |
|---|---|
| `upstream(X)` at depth *d* is exactly the ancestors of X within *d* hops of `scenarioFieldEdges` | `sg-pufq` |
| `downstream(X)` at depth *d* is exactly the descendants within *d* hops | the same class, other direction |
| Duality: `Y ∈ downstream(X) ⟺ X ∈ upstream(Y)` | asymmetric edge construction between the two walks |
| Depth *exactness*: the result at depth *n* is exactly the nodes whose shortest path is ≤ *n* | `sl-y89y` stated as a property, rather than monotonicity, which the buggy version also satisfied |
| A generated cyclic workspace terminates and reports no duplicate entries | cycle handling |
| Schema-level `lineage` equals the projection of field-level edges onto owning schemas | ties `lineage` to `graph --schema-only`, two walks that must agree |

### R5 — Cross-consumer lineage parity sweep

Replicate `coverage-viz-parity.test.ts` for edges: over every `.stm` under
`examples/` and over generated workspaces, the CLI's field edges, the edges the
viz layout would draw, and the arrows in the LSP's merged full-lineage model must
agree.

- Scope differences are accounted for, not skipped, exactly as the coverage sweep
  accounts for workspace-versus-file scope: iterate the narrower side, and treat
  an edge present only on the narrower side as a failure.
- It lives in `satsuma-cli/test/` for the same reason the coverage sweep does —
  that is the one place both consumer paths are reachable in a single process.
- This is what makes `field-coverage.ts`'s "mirrors core's `extractArrowRecords`"
  an executable claim.

### R6 — Path/ref stage types for lineage endpoints

Depends on Feature 39's R5 brands existing.

- Apply the branded stages to graph and lineage endpoints, so an authored ref
  cannot be emitted where a qualified endpoint is required.
- Give `qualifyField` a signature that cannot silently conflate "bare field name"
  with "schema root token" — the caller must handle the ambiguous case rather
  than receiving a guess.
- Replace ad-hoc unbranding such as `edge.from.split(".")[0]`
  (`graph-builder.ts:622`) with a named core accessor.

This removes the type-level permission to guess. It does **not** decide what a
container header onto a schema root should mean; that remains `r0-7w76`.

## Acceptance Tests

### Generator package (R1, R2)

1. `satsuma-scenario-gen` has no dependency on `@satsuma/core`, and
   `npm install` from a clean checkout resolves without a cycle.
2. Core's two existing generated-property suites pass unchanged apart from their
   import path.
3. The CLI, viz and viz-backend test suites can import the package.
4. Every generated workspace parses recovery-free and produces no semantic
   diagnostics from `validateSemanticWorkspace`.
5. A generated workspace containing a namespace, an `each` container, an NL
   `@ref`, a `derived` block and a metric renders, parses and validates.

### Structural invariants (R3)

6. Reverting `qualifyField`'s guard makes the endpoint-existence property fail,
   and the reported counterexample names the invented field.
7. Restoring an unconditional `continue` in `elk-layout.ts`'s port resolution
   makes the arrow-to-edge completeness property fail.
8. Removing the `nsFilter` node backfill in `graph-builder.ts` makes the
   endpoint-has-a-node property fail.
9. Reordering declarations in a generated workspace does not change the emitted
   edge set.

### Reachability (R4)

10. Replacing `lineage.ts`'s shallowest-depth bookkeeping with a plain
    visited-set makes the depth-exactness property fail, and does **not** make a
    monotonicity-only property fail — demonstrating why exactness is the property
    worth having.
11. Restricting the upstream walk to a single predecessor makes the ancestor-set
    property fail with a generated diamond.
12. A generated cyclic workspace completes within the depth limit and reports
    each field once.

### Parity (R5)

13. The sweep runs over every `.stm` in `examples/` and reports any disagreement
    with the file, mapping and edge that differ.
14. A deliberate divergence introduced into any one of the three consumers is
    reported by the sweep.

### Repository (all)

15. Every property has a purpose comment naming the invariant or defect class it
    defends, per the repository's test-quality standards.
16. A failed generated test reports its seed, path and shrunk Satsuma source.
17. All existing package suites, the 318 grammar corpus parses, formatter checks,
    lint, the typecheck gates and the pytest-bdd smoke suite pass.

## Out of Scope

- Changing lineage or graph semantics, or deciding `r0-7w76`. This feature makes
  the disagreement visible and typed; the decision stays on its own ticket.
- The cross-command count and JSON-consistency family — arrow header counts
  (`cbh-ekvb`, `cbh-zdk3`, `sl-wta4`), row-index base (`cbh-7rvo`, `cbh-s9w6`,
  `cbh-gz2v`) and field-count agreement (`cbh-mpz2`). These are a strong
  follow-on feature over the same generator and should not be folded in here.
- Mutation-based generation of deliberately invalid workspaces for `validate` and
  `lint`. That needs a second generator with a known expected diagnostic, and is
  its own feature.
- Expanding the Playwright harness, beyond adopting any shrunk counterexample
  worth keeping as a fixture.
- Parser or scanner fuzzing, which Feature 39 already places out of scope.
- Performance work.

## Decisions and Sequencing

1. **Generator home:** a new private test-only package, not `satsuma-core/src`.
   Core would make generators importable by production code, which Feature 39
   decision 3 explicitly argues against, and would ship them inside the CLI's
   bundled `@satsuma/core`.
2. **No core dependency in the generator package:** required to avoid a build
   cycle, and it costs nothing because the renderer is pure string building.
   Pipeline adapters live with their pipelines.
3. **No independent oracle:** the scenario is the oracle. R4 of Feature 39 does
   not need a counterpart here.
4. **Traversal extraction first:** Feature 40's `sl-4871` spike and `sl-prlp`
   extraction land before R4 and R5, so the properties and the sweep aim at one
   portable function instead of a CLI-internal one that is about to move — and so
   the `graph-builder.ts` / `field-lineage.ts` duplication is deleted rather than
   acquiring two parallel test suites.
5. **Start where nothing blocks:** R1 and R2 depend on neither Feature 39's
   remaining requirements nor Feature 40, and are the work to begin immediately.
6. **R6 waits for Feature 39 R5,** which is not yet ticketed. R6 must not
   pre-empt that design by inventing its own brands.

## Ticket Map

Feature epic: `sl-8f2p`.

| Work | Ticket | Depends on |
|---|---|---|
| Feature 41 epic | `sl-8f2p` | — |
| R1 promote the generator to `satsuma-scenario-gen` | `sl-puky` | — |
| R2 workspace-shaped scenario model and ground truth | `sl-dqyu` | `sl-puky` |
| R3 structural edge invariants | `sl-hi0z` | `sl-dqyu` |
| R4 reachability properties over the portable traversal | `sl-jsyn` | `sl-dqyu`, `sl-prlp` |
| R5 cross-consumer lineage parity sweep | `sl-kwet` | `sl-hi0z`, `sl-prlp` |
| R6 branded lineage endpoints | `sl-jyee` | `sl-hi0z`; also blocked on Feature 39 R5, which has no ticket yet — recorded in the ticket body, not as a `tk` dependency |

The best first slice is **R1 + R2**: both are unblocked, neither touches
production code, and together they are what makes every later requirement — and
the follow-on count/consistency feature — cheap to write.
