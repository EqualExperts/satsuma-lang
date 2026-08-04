---
id: sl-jcs6
status: closed
deps: []
links: []
created: 2026-07-31T13:13:41Z
type: task
priority: 1
assignee: Thorben Louw
parent: sl-3de8
tags: [feature-36, viz, core]
---
# viz-model+backend: chain traversal model type and builder

PRD 36 R3. Add a chain/traversal model type to @satsuma/viz-model: ordered upstream hops -> focus field -> ordered downstream hops; each hop carries field ref, owning schema, via_mapping, and classification (none / nl / nl-derived). @satsuma/viz-backend gains a builder producing it from the in-memory workspace.

## Design

Keep the shape deliberately compatible with the field-lineage --json output of the CLI so either source can feed the component. Depth-limited and cycle-guarded like the CLI traversal.

Parity test uses a checked-in golden, not a live CLI call (doc review 2026-07-31, user-confirmed). Commit the expected field-lineage --json output as a fixture and regenerate it with a script under scripts/. viz-backend must not gain a dependency on satsuma-cli to shell out for the comparison: the dependency direction is backend -> core, and inverting it for a test would couple the browser bundle's package graph to the CLI. Committing the golden is also what makes a divergence appear as a reviewable diff instead of a red test with no history.

## Acceptance Criteria

Model type exported with doc-commented fields; backend builder unit-tested against minimal .stm snippets including an nl-derived hop; golden parity test asserts builder output matches the committed field-lineage --json fixture, with a documented regeneration script under scripts/; viz-backend has no dependency on satsuma-cli; viz-model and viz-backend suites pass locally.


## Notes

**2026-08-04T15:27:25Z**

Cause: The viz protocol had no field-chain contract, and browser hosts had no adapter from their in-memory document workspace to core’s shared field-edge builder and traversal.
Fix: Added a CLI-compatible, doc-commented FieldChainModel, a browser-portable in-memory backend builder with NL-derived hops and import scoping, plus a checked-in CLI golden and explicit regeneration script. (commit immediately after c4bc1709)
