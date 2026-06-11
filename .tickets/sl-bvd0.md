---
id: sl-bvd0
status: in_progress
deps: []
links: []
created: 2026-06-11T02:40:50Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-hunt, cli]
---
# cli: --depth/--budget numeric options accept garbage and silently change behaviour

parseInt with no NaN/range check in satsuma-cli/src/commands/lineage.ts:48, field-lineage.ts:43, context.ts:42. Repro: lineage --from s_a --depth banana -> NaN -> prints only the start node, exit 0, no error; --depth -1 prints start node annotated [?]; context --budget banana -> NaN disables the budget entirely and emits all blocks.

## Acceptance Criteria

Non-numeric or out-of-range values for --depth/--budget exit with a usage error; tests for banana/-1/0 inputs.

