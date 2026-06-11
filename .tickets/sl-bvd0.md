---
id: sl-bvd0
status: closed
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


## Notes

**2026-06-11T06:19:49Z**

Cause: lineage --depth, field-lineage --depth, and context --budget coerced values with bare parseInt and no NaN/range check, so non-numeric or non-positive input silently changed behaviour (NaN depth printed only the start node; NaN budget disabled budgeting).
Fix: added src/option-parsers.ts with a strict parsePositiveInt coercion (anchored digit pattern, >= 1) that raises Commander's InvalidArgumentError as a standard usage error; wired into all three options. Unit tests pin the parser contract and subprocess tests pin the wiring for banana/-1/0.
