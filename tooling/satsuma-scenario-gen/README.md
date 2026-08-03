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

| Consumer | Adapter |
|---|---|
| `satsuma-core` | `test/support/scenario-pipeline.js` |

Keeping pipeline code out of this package is what stops it becoming a second
production implementation of Satsuma's semantics.

## Layout

| Module | Owns |
|---|---|
| `src/model.js` | scenario data shapes, constructors, path helpers |
| `src/render.js` | scenario → Satsuma source text |
| `src/arbitraries.js` | fast-check domains, each a named semantic family |
| `src/index.js` | the public surface |

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
