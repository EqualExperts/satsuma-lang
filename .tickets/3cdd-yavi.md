---
id: 3cdd-yavi
status: open
deps: []
links: [svdfe-s6we, sc-xnxp]
created: 2026-08-01T21:19:06Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [viz, viz-model, coverage]
---
# viz-backend: qualify relative child-arrow paths against their container, as core extraction does

Arrows inside nested_arrow, each and flatten bodies are authored with element-relative paths (.line1 -> .line1 — spec 4.6, examples/nested-iteration/pipeline.stm:89) and the viz model stores that authored text verbatim: viz-backend's pathText (viz-model.ts) strips backticks but not the leading dot, and nothing makes a child arrow's path absolute against its container's src/tgt. resolveSchemaLocalFieldPath('.line1', ...) then splits to ['', 'line1'], matches no declared field, and returns null — so every relative-path arrow contributes nothing to buildMappingCoveredFields (mapping-detail coverage), hover cross-highlighting lookups, or elk-layout's findPort (overview edges silently skipped via the missing-port continue). Arrow COUNTS and the detail table are correct since svdfe-s6we; it is the resolution-dependent surfaces that drop them. This is sc-xnxp one package over: core hit the same defect class (items..id), fixed pathText, then centralised the rule in extract.ts, whose extractArrowRecords doc-comment states the contract — 'each container (nested_arrow, each_block, flatten_block) emits its own record and its children's relative paths are made absolute against the container's paths'. Core-vs-consumer: prefer reusing core's rule (extractMappingArrowRecords or a shared qualification helper) over teaching viz-backend a second copy; viz still needs its structural blocks for scope sections and locations, so the likely shape is qualifying paths at model-build time while keeping the block tree.

## Acceptance Criteria

Child arrows inside nested_arrow/each/flatten reach the model with container-qualified absolute paths (or the resolution layer qualifies them equivalently), reusing core's qualification rule rather than a viz-local copy; buildMappingCoveredFields marks .line1 -> .line1 under 'addr -> address' as covering address.line1 on both sides; elk-layout produces edges for relative-path arrows, including flatten-inside-each (the sl-vu22 shape) and nested_arrow bodies; hover cross-highlighting resolves them; a layout test with populated eachBlocks/flattenBlocks/nestedArrows pins edge collection; viz + viz-backend suites pass and the Playwright harness run is green.

