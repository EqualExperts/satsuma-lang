# @satsuma/scenario-gen

Test-only generator of semantic Satsuma scenarios, shared by every package's
property suites.

A *scenario* is plain data — declarations, mappings and arrows. This package
builds scenarios, renders them to Satsuma source, and states the ground truth
that follows from a scenario **by construction**. It never parses, validates or
interprets Satsuma.

## Why it is its own package

The generator started life in `satsuma-core/test/support/generated-scenarios.js`.
That directory is not compiled to `dist/` and is absent from core's `exports`
map, so no other package could reach it — and the lineage and graph properties
that Feature 41 needs live in the CLI and the viz (`sl-puky`).

## The one rule: no dependency on `@satsuma/core`

Core's tests depend on this package. A dependency back on core would make core's
test run need this package's output while this package needed core's `dist/` — a
cycle. It costs nothing, because rendering is pure string building.

The adapters that *do* drive the production pipeline — parse, extract, compute
coverage, build a graph — live in each consuming package's test tree, beside the
pipeline they drive:

| Consumer | Adapter | Drives |
|---|---|---|
| `satsuma-core` | `test/support/scenario-pipeline.js` | parse, extract, coverage |
| `satsuma-cli` | `test/support/generated-workspace.ts` | write to disk, load, validate, build the graph |

Keeping pipeline code out of this package is what stops it becoming a second
production implementation of Satsuma's semantics.

## Layout

| Module | Owns |
|---|---|
| `src/model.js` | single-file scenario shapes, constructors, path helpers |
| `src/render.js` | scenario → Satsuma source text |
| `src/arbitraries.js` | fast-check domains for coverage and formatting |
| `src/workspace-model.js` | workspace shapes: files, namespaces, arrow kinds |
| `src/workspace-render.js` | workspace → one Satsuma source per file, imports derived |
| `src/ground-truth.js` | declared paths, declared edges, reachability over them |
| `src/workspace-arbitraries.js` | one generated domain per lineage axis |
| `src/mutators.js` | one-defect mutations and the diagnostics each predicts |
| `src/index.js` | the public surface |

## The negative half: defect mutators

Every domain above builds workspaces the toolchain should *accept*, so the whole
diagnostic surface was proved by hand-written fixtures. `src/mutators.js` is the
other half: give it a valid workspace and it returns a `WorkspaceDefect` — the
mutated workspace, what was broken, and **every** diagnostic that break predicts.

```js
const defect = deleteMappedField(workspace);
// { applicable: true,
//   workspace,
//   mutation: { kind: "delete-mapped-field", target: "middle.field_0" },
//   expected: [{ rule: "field-not-in-schema", file: "entry.stm",
//                entity: "field_0", line: 15, surfaces: ["validate"] }, …] }
```

Four things a consumer must know:

- **The prediction is complete, not minimal.** One defect cascades — deleting a
  mid-chain field breaks the arrow that fills it *and* the arrow that reads it —
  and repeated `(rule, file, entity)` keys are meaningful, so compare multisets.
- **`expected` is what the mutation adds** to a diagnostic-free baseline:
  `diagnostics(mutated) = diagnostics(base) ⊎ expected`, the *multiset* sum, for
  the reason above — set union would drop a cascade's second diagnostic.
- **`surfaces` says which command reports it.** `duplicate-definition` and
  `unresolved-nl-ref` are in both the `validate` and the lint registry;
  `expectedForSurface(defect, "lint")` filters.
- **A mutator that cannot break a workspace says so** (`applicable: false` plus a
  reason) rather than returning a workspace that is still valid — a vacuous
  mutation would look exactly like a missed diagnostic.

The `NULL_MUTATORS` are the same contract with an empty prediction: reordering
declarations, splitting them across more files and renaming an entity everywhere
must change the source and add no diagnostic at all.

## Two ideas worth knowing before reading the code

**Endpoints name their schema; authored spellings are derived.** An arrow endpoint
is `{ schema, path }`, never a bare string, and paths are always absolute. The
renderer decides how each one is *written* — bare, `schema.path`, or `.suffix`
inside a container block. Production code has to invert that choice; the ground
truth never does. A generator that stored only the authored spelling would have to
re-implement the same inference to state its own expectations, and would then share
its bugs.

**`import` statements are derived from usage.** A file that references an entity
declared elsewhere gets exactly the import it needs. Satsuma scopes symbols
explicitly, so a workspace whose imports disagreed with its usage would be
semantically invalid — a generator bug the properties would report as a toolchain
bug.

## Consuming it from TypeScript

The package ships plain `.js` with JSDoc types and has no build step, so it
publishes no `.d.ts`. A TypeScript test suite needs `allowJs` and
`maxNodeModuleJsDepth: 1` to read those types — see
`satsuma-cli/tsconfig.test.json`, which explains why a narrower `paths` mapping
does not work.

## Naming

Exported types carry a `Scenario` prefix (`ScenarioMapping`, `ScenarioArrow`,
`ScenarioField`) because core's `validate.ts` already exports `SemanticMapping`,
`SemanticArrow` and `SemanticSchema` for the unrelated semantic-validation model.
