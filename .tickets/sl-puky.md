---
id: sl-puky
status: closed
deps: []
links: []
created: 2026-08-03T16:23:38Z
type: task
priority: 1
assignee: Thorben Louw
parent: sl-8f2p
tags: [feature-41, testing]
---
# test-support: promote the scenario generator to a shared satsuma-scenario-gen package

The generated-input machinery from Feature 39 R3 lives in tooling/satsuma-core/test/support/generated-scenarios.js. It is under test/, is not compiled to dist/, and is absent from core's exports map, so no other package can reach it. Split it along the line already present in the file: the semantic model, semanticLeafPaths, renderScenario and helpers, the arbitraries and GENERATED_PROPERTY_PARAMETERS are pure string building; only parseGeneratedScenario, coverageForScenario, toCoverageFields and entityKey import @satsuma/core.

## Design

New private workspace package tooling/satsuma-scenario-gen: type module, plain ESM .js with JSDoc types as today, no build step. Only dependency is fast-check. It must NOT depend on @satsuma/core — core's tests will depend on it, so a dependency back on core creates a build cycle where core's test run needs the package output and the package build needs core's dist. Pipeline adapters stay in satsuma-core/test/support/; each consumer owns its own thin adapter beside the pipeline it drives (same reasoning as Feature 39 decision 3: keeping pipeline code out of the package is what stops it becoming a second production implementation). Rename the exported JSDoc typedefs with a Scenario prefix (ScenarioMapping, ScenarioArrow, ScenarioField, ScenarioEntity) — core's validate.ts already exports SemanticMapping, SemanticArrow and SemanticSchema for an unrelated purpose and the collision would be actively misleading.

## Acceptance Criteria

satsuma-scenario-gen has no dependency on @satsuma/core and npm install from a clean checkout resolves without a cycle. Core's generated-coverage-properties.test.js and generated-format-properties.test.js keep every property they have and change only their import path; both pass. The CLI, viz and viz-backend test suites can import the package. Exported type names do not collide with core's validation model. Wired into npm run install:all and the repo checks.


## Notes

**2026-08-03T21:48:35Z**

Cause: The Feature 39 generated-input machinery lived in
satsuma-core/test/support/generated-scenarios.js — under test/, absent from
core's exports map — so the CLI, viz and viz-backend suites that Feature 41's
lineage properties need could not reach it.

Fix: Promoted the pure half (model, renderer, arbitraries,
GENERATED_PROPERTY_PARAMETERS) to a new private test-only package
tooling/satsuma-scenario-gen with fast-check as its only dependency and no build
step; core's pipeline adapters stay behind in test/support/scenario-pipeline.js.
Exported typedefs gained the Scenario prefix. Three core suites (not two — the
Feature 39 R4 coverage-oracle suite shipped after the PRD was written) changed
only their import paths and all 679 core tests pass. TypeScript consumers read
the JSDoc via allowJs + maxNodeModuleJsDepth: 1; the rejected paths-mapping
alternative and its TS6059 failure are recorded in tsconfig.test.json and in
features/41-lineage-graph-confidence/IMPLEMENTATION-NOTES.md. (commit
immediately after 3ba4e95d)
