---
id: sl-dqyu
status: open
deps: [sl-puky]
links: []
created: 2026-08-03T16:23:38Z
type: task
priority: 1
assignee: Thorben Louw
parent: sl-8f2p
tags: [feature-41, testing]
---
# test-support: extend the scenario model from one mapping to a workspace

The scenario model is one mapping over scalar/record fields with optional fragment spreads — the right domain for coverage, insufficient for lineage. Lineage needs chains, and the interesting endpoint defects live in namespaces, containers and NL refs, none of which the model can express.

## Design

Add each axis as its own arbitrary so a property can pick the smallest domain that exercises it: multiple mappings forming chains, diamonds and deliberate cycles (traversal properties; sg-pufq is a diamond, sl-y89y a re-entered node); multiple files plus import (the LSP's computeFullLineage merges per-file models across the import-reachable set); namespaces (qualifyField's namespace-matching branch at canonical-ref.ts:68-72 has no generated coverage, and r0-7w76 reproduces in both global and namespaced cases); each/flatten containers with container-relative arrows (the shape of 3cdd-yavi and r0-7w76); NL @ref transform text (cbh-y5og's phantom edges and the nl-derived tier both CLI builders emit); derived blocks (sourceless arrows, from: null); metrics (the metric_source edge role). Two gates on every generated workspace: it parses recovery-free via the existing parseGeneratedScenario assertion, AND it validates clean via core's validateSemanticWorkspace, so no lineage property asserts over input the toolchain considers broken. Expose ground truth derived from the scenario and not from any production code: scenarioFieldEdges, scenarioSchemaEdges, scenarioDeclaredFieldPaths.

## Acceptance Criteria

Every generated workspace parses recovery-free and produces no semantic diagnostics from validateSemanticWorkspace. A generated workspace containing a namespace, an each container, an NL @ref, a derived block and a metric renders, parses and validates. scenarioFieldEdges, scenarioSchemaEdges and scenarioDeclaredFieldPaths are computed from the scenario alone, with a purpose comment stating that independence. Existing core property suites still pass.

