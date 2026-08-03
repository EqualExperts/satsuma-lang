# Feature 39 — Correctness by Default

> **Status: IN PROGRESS** (started 2026-08-03 with R1, `gcsc-ejb2`) — raised
> after reviewing the mechanism behind recent defect clusters. The recurring
> problem is broader
> than either “bad specification” or “bad implementation”: important rules have
> lived in prose, string conventions, or examples, so the build could confirm
> that code matched its tests without confirming that the rule was complete,
> internally consistent, or expressed at the right abstraction boundary.
>
> **State this revision was checked against:** `main` at `c53619b1`. The CST
> comparison counts below were originally measured at `4d17c505`; the two later
> commits only added and amended this PRD, so those counts are unchanged.
>
> **Recommendation.** Proceed, but as a sequence of independently valuable
> hardening tasks rather than one all-or-nothing programme. Generated CST types,
> generated-input coverage checks, domain-specific path/ref types, and build-gate
> repairs are the delivery scope. Formal modelling and a compositional semantic
> account are useful follow-on investigations; they do not gate completion.
>
> **What this feature is not.** It changes no Satsuma syntax or runtime protocol,
> and proposes no rewrite or verified-code extraction. Those approaches target a
> different failure mode at much greater cost.

## Goal

Move stable toolchain invariants from conventions into compiler- and
test-enforced contracts, so that a decided rule cannot quietly stop holding.

1. A misspelled, renamed, or removed CST symbol fails a build at a typed use
   site instead of becoming a branch that never matches.
2. Authored refs, container-qualified refs, schema-local paths, and canonical
   entity ids are different types at the points where confusing them is unsafe.
3. Coverage semantics are checked over generated counterexamples as well as
   human-authored examples.
4. Configured type checks and type-aware lint rules run wherever their signal is
   useful, including the test typecheck the repository already defines.

## Background — measured state

### The defect pattern

The recent defects are related, but they are not all accurately described as
specification defects:

| Defect | Failure in the rule system | Missing mechanical protection |
|---|---|---|
| `sl-joeq` | Coverage registered field segments where identity required a schema-local path | A generated counterexample or independent oracle over repeated names |
| `sl-qead` | Spread/explicit-field redeclaration had no uniqueness rule until ADR-041 amended the model | A uniqueness invariant over expanded field trees |
| ADR-038 constraining ADR-037 | The first whole-structure rule admitted a scalar-to-record counterexample | A model or property exploring combinations the author did not choose |
| `sl-iqud`, `sl-qxyl` | Three schema-ref spellings crossed one resolution boundary as plain strings | Types for authored and canonical identity plus one normalization function |

The common shape is therefore an **unenforced invariant**. Some invariants were
missing, some were initially wrong, and some were represented by types too weak
to show that two values had different meanings.

### CST symbols are addressed by unchecked strings

`SyntaxNode.type` is `string` (`satsuma-core/src/types.ts:10`) and CST helpers
such as `child(node, type)` accept `string`
(`satsuma-core/src/cst-utils.ts:25`). Measured at `4d17c505`:

| Package | `node.type === "…"` sites | Distinct symbols | Kind-keyed helper calls |
|---|---:|---:|---:|
| `satsuma-core` | 181 | 51 | 55 |
| `satsuma-cli` | 221 | 44 | 2 |
| `satsuma-lsp` | 73 | 32 | 49 |
| `satsuma-viz-backend` | 59 | 32 | 68 |

The grammar’s tracked `src/node-types.json` contains 60 named node kinds and 39
anonymous tokens. Four anonymous tokens — `record`, `list_of`, `enum`, and
`slice` — are intentionally compared today, so a generated type must include
anonymous symbols as well as named kinds.

Tree-sitter recovery is also part of the real contract. An unexpected construct
can produce a node whose type is `ERROR`; a MISSING node reports the expected
grammar symbol and sets `isMissing`. A generated CST type that contains only the
99 grammar symbols would therefore be unsound. The type used by parsed trees
must include `ERROR`, while recovery checks must continue to use `isMissing`.

This is the mechanism adjacent to ADR-031: that ADR made mis-parses loud; typed
CST symbols make stale or misspelled matches loud.

### Path and ref stages are all `string`

`schemaLocalFieldPath` (`coverage-paths.ts:221`) receives authored/container
qualified field refs and several spellings of entity refs, then returns a
schema-local path. All of those values are currently `string`.
`buildCoveredFieldPaths` also accepts `Iterable<string>`, so a value from the
wrong normalization stage remains type-correct.

The relevant distinctions are:

- authored field ref — exactly the field expression written on an arrow;
- container-qualified field ref — relative syntax resolved against enclosing
  `each`, `flatten`, or nested-arrow containers;
- schema-local path — the path relative to one declared schema;
- authored entity ref — e.g. `customers` or `crm::customers` as written;
- canonical entity ref — the unique workspace id, e.g. `::customers` or
  `crm::customers`.

ADR-039 says consumer models preserve authored form and core resolves at the
point of use. That boundary is currently enforced by prose only.

Brands cannot prove every path algorithm correct. In particular, `city` is a
perfectly valid schema-local path for a top-level field; a type cannot infer
that the same string was incorrectly obtained by splitting
`home_address.city`. The value of domain types is narrower and still useful:
they prevent accidental cross-stage calls and concentrate the semantic
conversion in named functions that can be tested thoroughly.

### Existing strengths

This feature does not duplicate checks already in place:

- Formatter corpus tests assert idempotence and parse-tree structural
  equivalence; CLI diff tests cover formatter round trips.
- `strict` and `noUncheckedIndexedAccess` are enabled in all but the viz
  package’s TypeScript configuration.
- Coverage ADRs are cited throughout production comments and example tests.
- `MetaEntry` is already a useful discriminated-union example for core types.
- Grammar corpus tests, package suites, and cross-consumer coverage tests cover
  many deliberately chosen regressions.

### Remaining gaps

- There is no property-based test dependency in the repository. Existing
  round-trip and coverage checks use human-selected inputs.
- Type-aware ESLint is configured only for `satsuma-cli` production source.
- CST comparisons and kind-keyed helper calls accept arbitrary strings.
- `FieldDecl` is a bag of optional fields even though record, scalar-list,
  record-list, and scalar variants have different valid shapes.
- `satsuma-cli` defines `test:typecheck`, but neither CI nor
  `scripts/run-repo-checks.sh` runs it. It currently exposes stale `FileData`
  literals in `canonical-ref.test.ts`.

## Problems

### P1 — A stale CST symbol is a silent behaviour change

A typo or renamed grammar symbol produces a branch that never matches. The
compiler cannot distinguish it from an intentional comparison with arbitrary
text.

### P2 — Path and ref normalization stages are conventions

An authored value can be passed where a canonical id or schema-local path is
required. The function signature does not tell the caller which conversions
have already happened.

### P3 — Coverage rules are tested primarily on selected examples

The recent counterexamples are small combinations: repeated leaf names,
record/scalar whole-structure arrows, and spread redeclarations. Generated
finite trees are a good fit for exploring this space and shrinking failures to
reviewable examples.

### P4 — Strong checks are unevenly applied

The repository owns strict TypeScript configurations and a type-aware ESLint
setup, but their coverage differs by package and excludes a configured CLI test
typecheck entirely.

### P5 — Core public types permit invalid combinations

`FieldDecl` allows states such as a scalar with `children`, or a record-list
without a record body, because its structural variants are not represented in
the type system.

## Delivery Requirements

### R1 — Generate the CST symbol contract (fixes P1; `gcsc-ejb2`)

- A deterministic generator reads
  `tooling/tree-sitter-satsuma/src/node-types.json` and emits:
  - `SatsumaNamedKind` for the 60 named kinds;
  - `SatsumaAnonymousToken` for the 39 anonymous symbols;
  - `SatsumaGrammarSymbol`, their union;
  - `SatsumaCstType = SatsumaGrammarSymbol | "ERROR"`.
- The generator lives with the grammar, while its tracked TypeScript output
  lives under `satsuma-core/src/generated/`, where the public type is consumed.
  Consumers keep their existing dependency on `@satsuma/core`.
- Grammar generation refreshes the artifact. A check-only command regenerates
  to a temporary location and fails when committed output is stale.
- The generated module includes readonly symbol constants so ordinary code does
  not need to repeat literals when a named constant improves readability.
- The generated file and generator both explain the recovery-node exception.

This requirement deliberately does **not** assert that every grammar node must
be referenced by an extractor. Many nodes are intentionally consumed through a
parent, traversed generically, or irrelevant to a particular semantic model.
A string census would measure references, not semantic completeness.

### R2 — Enforce typed CST symbols at parser boundaries and use sites (fixes P1)

Tickets: core/parser foundation `tcc-e35f`, CLI migration `tcc-ef1b`, LSP
migration `tcc-yb3z`, and viz-backend migration `tcc-chls`.

- `SyntaxNode.type` becomes `SatsumaCstType`, and its recursive child/parent
  properties use the same typed node interface.
- Web-tree-sitter’s external `Node.type: string` is narrowed in one audited
  parser-adapter boundary per runtime. Arbitrary casts at extraction use sites
  are not permitted.
- `child`, `children`, `allDescendants`, and equivalent local helpers accept
  `SatsumaGrammarSymbol`; call sites are migrated from unchecked strings.
- Direct symbol comparisons and switch labels in core, CLI, LSP, and
  viz-backend compile against the generated union. Existing `ERROR` handling
  remains explicit.
- Renaming or removing a referenced grammar symbol after regeneration causes a
  compile failure. Adding a new symbol does not require every partial walker to
  handle it; construct-specific completeness must be tested at that semantic
  boundary.

### R3 — Add generated-input properties for coverage and formatting (fixes P3)

Add `fast-check` as a dev dependency of `satsuma-core`. Generators build a small
semantic scenario first — declarations, refs, arrows, nesting, and spreads —
then render valid Satsuma from that scenario. A property run must never discard
invalid generated text until only easy examples remain: the renderer’s output
must parse without recovery nodes before the semantic assertion runs.

Each property has an explicit domain and preconditions:

| Property | Domain / source |
|---|---|
| For a schema with at least one declared leaf, `100%` means every leaf is covered and `0%` means no leaf is covered | ADR-040 |
| Expanded coverage contains one entry per qualified declared path, including spread/explicit redeclaration cases | ADR-041 |
| A valid record-to-record whole-structure arrow covers the target record’s declared leaf subtree | ADR-037 constrained by ADR-038 |
| A scalar or unresolved source never expands a target record subtree | ADR-038 |
| `ancestors` is exactly the set of proper dotted prefixes derived from `direct` | `coverage-paths.ts` contract |
| A ref already known to be schema-local remains unchanged; a ref belonging to another schema returns `null`; an unshadowed own-schema prefix is removed once | `schemaLocalFieldPath` contract |
| A structure-preserving path bijection that re-nests declarations and rewrites every arrow preserves the leaf coverage ratio | Feature 38 depth-invariance goal |
| Adding a valid arrow to the same valid workspace cannot remove a previously covered leaf | `--fail-under` monotonicity assumption |

The earlier draft proposed universal idempotence for `schemaLocalFieldPath`.
That is false when a schema name legitimately repeats as the first local path
segment; the three normalization properties above express the actual contract.

Generated formatter inputs extend the existing properties — idempotence,
structural equivalence, and error-free reparse — rather than replacing the
canonical corpus. Seeds and shrunk counterexamples must be printed on failure so
a regression can be promoted to a small permanent example when useful.

### R4 — Differentially test an independent coverage oracle (fixes P3)

- Implement a deliberately simple, test-only coverage oracle over the semantic
  scenarios generated by R3: materialise declared leaf paths, apply the stated
  arrow/spread rules directly, and compute membership without reusing production
  coverage helpers.
- Render the same scenario to Satsuma, parse it, run the production extraction
  and coverage path, and compare qualified per-field state and rollups with the
  oracle. This crosses the parser/extraction boundary rather than comparing two
  functions over already-extracted production data.
- Keep the oracle small and structurally independent. A short rule-to-ADR table
  in the test module is its executable documentation.
- Keep it test-only. It must not become a second production walker or a fallback
  implementation.

The oracle cannot prove that the chosen semantics are correct; it detects when
the production implementation diverges from the independently stated rules.
R3’s individual properties remain necessary because two implementations can
share the same misunderstanding.

### R5 — Introduce opaque path and ref stages in core (fixes P2)

- Add opaque string types for `AuthoredFieldRef`,
  `ContainerQualifiedFieldRef`, `SchemaLocalPath`, `AuthoredEntityRef`, and
  `CanonicalEntityRef`.
- Public constructors validate syntax only. Semantic transitions are named core
  functions: container qualification, schema localization, and entity
  canonicalization. Each transition accepts one stage and returns the next.
- The brand symbol is private to the module. The only unsafe assertion lives
  inside the constructor/transition implementation and is explained as the
  runtime-erased representation boundary.
- `schemaLocalFieldPath` returns `SchemaLocalPath | null`;
  `buildCoveredFieldPaths` and `buildCoveredFieldSet` accept
  `Iterable<SchemaLocalPath>`; path probes accept `SchemaLocalPath`.
- External JSON, LSP, and VizModel shapes remain strings. Consumers call core
  constructors/conversions when data enters the typed domain; they do not cast
  unvalidated boundary strings.
- Compile-only tests using `@ts-expect-error` prove that raw strings and values
  from the wrong stage cannot cross these APIs. Runtime tests cover validation
  and normalization.

This is stage safety, not a proof of origin: both `city` and
`home_address.city` can be valid `SchemaLocalPath` values. The property/oracle
suite remains responsible for detecting an algorithm that manufactures `city`
from the latter.

### R6 — Make configured typechecks real build gates (fixes P4)

- Fix the stale `FileData` fixtures exposed by
  `satsuma-cli`’s existing `test:typecheck` command.
- Run that command from `scripts/run-repo-checks.sh` and CI.
- Document which package test sources are typechecked and which are only
  baseline-linted. Do not imply that test files are type-aware-linted when they
  are not.
- Treat any broader test-module target change (`node16` to a target supporting
  `import.meta.dirname`) as an explicit tooling task, not an incidental fix.

### R7 — Roll out type-aware linting incrementally (fixes P4)

- Apply `recommendedTypeChecked` to production TypeScript in core, LSP,
  viz-backend, viz-model, viz, and VS Code where not already covered. Land one
  package at a time so each cleanup is reviewable.
- Enable `no-unnecessary-condition` after R1/R2 in packages using the narrowed
  CST type. Enable `switch-exhaustiveness-check` where a switch is intended to
  cover a domain discriminated union; do not require every intentionally partial
  switch over the 100-value CST union to be exhaustive.
- Adopt the `no-unsafe-*` rules provided by the selected type-aware preset and
  fix findings at their boundary. Do not add package-wide suppressions to make
  the rollout green.
- Add `noUncheckedIndexedAccess` to `satsuma-viz/tsconfig.json`.

### R8 — Replace `FieldDecl`’s optional-field bag with variants (fixes P5)

- Define explicit scalar, record, scalar-list, and record-list variants with a
  shared base for name, metadata, and source location.
- Make children/spread fields available only on record-bearing variants and
  make the list element shape explicit.
- Add a core `assertNever` helper and use it where a consumer intentionally
  exhausts the variants.
- Migrate all consumers in the same ticket. The runtime/JSON shape remains
  compatible; the TypeScript public source contract becomes stricter and the
  release notes call that out.
- Consolidate invariant tests in core. Consumer tests cover only their own
  rendering or protocol behaviour, not the union rules again.

## Follow-on Investigations — Not Completion Gates

### I1 — Bounded consistency model for coverage rules

After Feature 38 closes, time-box an Alloy or Z3 model of the settled
ADR-034–041 rules. Ask for small counterexamples to consistency and intended
monotonicity. The result is a model plus a report: either a counterexample or
“none within the stated bound.” It is not a proof of the implementation.

### I2 — Compositional semantics section for the specification

The v2 specification describes data flow and gives construct-level meaning, but
does not provide one compositional semantic model from which coverage rules can
be derived. Investigate such a section without assuming in advance that a
mapping is a simple partial function from one source record to one target
record: multi-source joins, filtering, `each`, and `flatten` all affect the
semantic domain and cardinality.

The first deliverable is a proposed domain and interpretation for those
constructs. Only then should the work attempt to re-derive ADR-037, ADR-038, and
ADR-041. Prose is sufficient; mechanised proof is out of scope.

## Acceptance Tests

### Generated CST contract (R1, R2)

1. `node.type === "schema_blok"` and `child(node, "mapping_bdy")` fail TypeScript
   compilation.
2. Comparisons with `record`, `list_of`, `enum`, and `slice` still compile.
3. `node.type === "ERROR"` compiles and malformed-input parse diagnostics still
   pass.
4. Renaming a referenced grammar rule and regenerating causes at least one
   existing use site to fail compilation.
5. A stale committed generated module fails the check-only generation gate.
6. Web-tree-sitter nodes are narrowed only in the documented parser adapters;
   the migration introduces no scattered `as SatsumaCstType` assertions.

### Generated coverage and oracle (R3, R4)

7. Every property in R3 has a purpose comment naming its invariant or ADR and
   runs over valid, recovery-free generated Satsuma.
8. Restoring bare-segment registration makes a repeated-name generated scenario
   fail against the oracle.
9. Restoring spread/explicit-field duplication makes the uniqueness property
   fail.
10. Removing ADR-038’s container-source condition produces a shrunk
    scalar-to-record counterexample.
11. A failed generated test reports its seed, path, and shrunk Satsuma source.
12. Existing corpus formatter properties and all hand-authored coverage
    regressions remain in place.

### Domain types (R5, R8)

13. Passing a raw string or `AuthoredFieldRef` to a schema-local coverage API
    fails a compile-only test; constructing the valid top-level local path
    `city` through the public constructor succeeds.
14. Passing an authored entity ref where a canonical entity ref is required
    fails a compile-only test.
15. JSON, VizModel, and LSP protocol snapshots are unchanged after branding.
16. A scalar `FieldDecl` with children and a record-list without a record body
    fail compile-only tests.
17. A deliberately non-exhaustive consumer switch over `FieldDecl` variants is
    reported by ESLint.

### Build gates and regression (R6, R7)

18. `scripts/run-repo-checks.sh` invokes the CLI test typecheck and it passes.
19. Each newly type-aware-linted package passes without package-wide rule
    suppression.
20. All existing package suites, the 315 grammar corpus parses, formatter
    checks, lint, and the pytest-bdd smoke suite pass.

## Out of Scope

- Changing coverage semantics; Feature 38 and ADR-034–041 decide the rules this
  feature checks.
- Requiring every new grammar node to appear in an extractor. Completeness is a
  semantic, construct-specific property, not a reference-count property.
- New user-facing lint rules; Feature 37 owns those.
- Branding every string in core. File URIs, NL text, and namespace ids remain
  outside R5 unless a concrete cross-stage defect justifies them later.
- Parser/scanner fuzzing for crashes, hangs, or tokenisation errors. That is a
  credible separate feature with a different oracle.
- Formal proof, verified-code extraction, or a rewrite in another language.
- Performance work.

## Decisions and Sequencing

1. **Generated artifact ownership:** the grammar package owns the generator and
   source JSON; core owns the emitted public TypeScript artifact. This avoids a
   new runtime/package dependency for every consumer.
2. **Property-test library:** use `fast-check` as a dev-only core dependency and
   run `npm audit` after adding it.
3. **Reference model visibility:** test-only. Exporting it would invite a second
   production implementation.
4. **Brands:** stop at coverage/ref normalization stages. The first migration is
   evidence for whether more nominal types are worth their ergonomics.
5. **Feature 38 state:** the core path model, whole-structure semantics, and
   cross-consumer parity are implemented and epic `sl-j6g9` is closed. R3, R4,
   and R5 can begin against those accepted rules; I1 and I2 are also unblocked.
6. **Static-check rollout:** R1/R2 first, then package-by-package R7. R6 is
   independent and can land immediately. R8 is a separate public-model migration
   and must not be hidden inside lint cleanup.
7. **Test-source module target:** gate the already configured CLI test typecheck
   now; consider a broader Node module-target change in its own tooling ticket.

## Ticket Map

Feature epic: `gcsc-qka8`. R1 and R2 now have concrete tickets; later rows
remain the agreed ticket shape and will receive IDs when scheduled.

| Work | Ticket shape | Depends on |
|---|---|---|
| Feature 39 epic (`gcsc-qka8`) | 1 epic | — |
| R1 generated CST artifact and stale check (`gcsc-ejb2`) | 1 task | — |
| R2 typed core node/helpers and parser adapter (`tcc-e35f`) | 1 task | `gcsc-ejb2` |
| R2 CLI CST-use migration (`tcc-ef1b`) | 1 task | `tcc-e35f` |
| R2 LSP CST-use migration (`tcc-yb3z`) | 1 task | `tcc-e35f` |
| R2 viz-backend CST-use migration (`tcc-chls`) | 1 task | `tcc-e35f` |
| R3 semantic generators and coverage properties | 1 task | — |
| R3 generated formatter properties | 1 task | semantic generator task |
| R4 independent oracle and differential suite | 1 task | R3 semantic generator task |
| R5 opaque path/ref stages | 1 core task plus consumer migration subtasks if needed | `sl-46wr`, `sl-csrs` |
| R6 CLI test typecheck gate | 1 task | — |
| R7 type-aware lint rollout | 1 task per package | R2 for CST-specific rules |
| R8 `FieldDecl` variants and consumer migration | 1 task | schedule clear of active consumer-model work |
| I1 bounded consistency model | optional spike | Feature 38 epic closed |
| I2 compositional semantics proposal | optional spike | Feature 38 epic closed |

The best first slice is **R1 + the core portion of R2**: it is mechanical,
independent of coverage semantics, and turns a grammar rename or typo into a
compiler error. In parallel scheduling, R6 and the R3 semantic generator can
start immediately because they touch different surfaces.
