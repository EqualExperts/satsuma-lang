---
id: sc-pgih
status: closed
deps: [sc-wspp]
links: []
created: 2026-08-06T16:35:32Z
type: task
priority: 2
assignee: Thorben Louw
tags: [eval, feature-44]
---
# eval: measure static compactness of .stm against YAML and JSON (arms S/Y/J)

Build scripts/measure-static-compactness.mjs following the scripts/measure-agent-reference-tokens.mjs precedent. Pulls Feature 44's Phase 2 static-compactness measurement forward for arms S/Y/J only: YAML and JSON are mechanical re-serialisations of the same content, so the MappingIntent pairing machinery the spreadsheet and markdown arms need does not apply. Arms X, M and C stay deferred. No model spend.

## Acceptance Criteria

Reuses countTokens from reference/token-cost.mjs, adding no second counter; sources structure from @satsuma/core extraction, projecting only author-written semantic content rather than the graph export's positions and derived facts; reports per tokeniser and never averaged, o200k_base always and the Anthropic endpoint when a key is present; charges Feature 45's measured AI-AGENT-REFERENCE.md overhead to the Satsuma arm and reports ratios both with and without it; covers the examples/ corpus across its real size range; emits committed reference/static-compactness.json and .md; unit tests include a negative test proving the renderer fails when a .stm construct has no serialisation, so a new language feature cannot silently drop out of one arm


## Notes

**2026-08-06T17:31:11Z**

Cause: Feature 44 parked static compactness in Phase 2 behind the MappingIntent pairing machinery, but arms Y and J do not need it - YAML and JSON are mechanical re-serialisations of identical content rather than independently authored artifacts, so the contamination control the spreadsheet and markdown arms require does not apply.
Fix: added scripts/static-compactness-{model,render}.mjs and measure-static-compactness.mjs, following the measure-agent-reference-tokens.mjs precedent and reusing reference/token-cost.mjs as the single counter. Two guards run on every spec and fail the measurement rather than warn: assertRoundTrips (the YAML says what the renderer meant) and assertFactsPreserved (the renderer built everything the projection found). The second earned its place - it caught dropped namespaces, metrics rendered twice and losing their blockMetadata, several //! comments colliding on one key, and each/flatten arrows silently becoming plain ones, all of which had made the YAML arm smaller and overstated Satsuma. Fixing them moved the median from -1.7% to +9%.
Result: median reduction vs YAML 9% (range 2.5-22.1%), vs JSON 36.1%; YAML is never smaller on any of 21 specs. The published 40-60% claim needs 1.67-2.50x; measured range is 1.03-1.28x. The 6813-token agent reference is never repaid - the largest saving in the corpus is 369 tokens. (commit immediately after d5a2c6b3)
