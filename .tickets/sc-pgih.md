---
id: sc-pgih
status: open
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

