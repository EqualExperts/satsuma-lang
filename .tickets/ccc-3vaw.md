---
id: ccc-3vaw
status: closed
deps: []
links: [sl-lctd]
created: 2026-08-03T09:55:59Z
type: bug
priority: 2
assignee: Thorben Louw
parent: sl-j6g9
tags: [feature-38, coverage, core]
---
# coverage: an empty record {} is counted as a leaf, inflating the denominator and missing from the container tally

Raised from external review of PR #431 (sl-lctd).

`record {}` and `list_of record {}` are legal Satsuma (spec §5.1, tree-sitter corpus unified_fields.txt) and declare no children. Core classified a container by looking for entries whose path sits below it — right for every record with children, blind to an empty one — so an empty record was treated as a leaf in three ways at once:

- it entered the leaf denominator, so adding a field that cannot hold data moved a schema's percentage (2/5 40% where the data is 2/3 66%);
- it was omitted from countContainerStates, contradicting the documented guarantee that the three counts sum to the record and list_of record fields declared;
- coverage --json listed it in fields[], which the contract documents as leaf fields only.

Reproduced on a schema of `a STRING`, `hollow record {}`, `hollow_list list_of record {}` and `filled record {x, y}` with a -> a and a -> filled.x: records reported {covered: 0, partial: 1, uncovered: 0} against three declared containers.

## Design

Preserve the field kind rather than inferring it. CoverageField gains a `container` flag that adapters set from the declared type (the one thing that still names an empty record), and FieldCoverageEntry carries it through to the rollup, where leafFieldEntries and countContainerStates classify on it. Keep the structural test as a fallback so entries from a producer older than the flag still classify their non-empty records (ADR-042 cached viz payloads).

An empty container has no descendants to roll up, so its state is decided on its own path exactly as a leaf's is: `blob -> hollow` covers it, nothing else does, and it can never read partial.

Two rules deliberately stay apart. declaredFieldKind keeps calling an empty record a leaf: it answers 'is there a subtree to confer or enumerate?' (ADR-038, unenumerated-record-target), and an empty record has none. The union's container recomputation likewise keeps rolling up the entries with nothing declared beneath them — empty records included — since those carry their own verdict upward.

## Acceptance Criteria

coverage --json reports records summing to every declared record and list_of record field, empty ones included; an empty record is absent from fields[] and from total; an arrow onto an empty record still covers it; a record whose children are all empty records still reports partial when only some are covered. Regression tests in core (walk + rollup) and the CLI, over a committed fixture. CHANGELOG records the percentage change.


## Notes

**2026-08-03T09:58:56Z**

Cause: core classified a container by looking for entries whose path sits below it — correct for every record with children, blind to an empty one. `record {}` therefore reached the counting rule as a leaf: in the denominator (so a field that cannot hold data moved a schema's percentage), absent from countContainerStates (breaking the documented sum), and listed in --json's fields[] which is contracted as leaves only.
Fix: preserved the field kind instead of inferring it. CoverageField gains a 'container' flag that all three adapters (CLI field-positions, LSP, viz-backend) set from the declared type via core's new declaresRecordBody(); FieldCoverageEntry carries it through, and leafFieldEntries/countContainerStates classify on it, keeping the structural test as a fallback for entries from a producer older than the flag (ADR-042 cached payloads). An empty container's state is decided on its own path, so an arrow onto it still covers it and it can never read partial. Two rules deliberately unchanged: declaredFieldKind still calls an empty record a leaf (it answers 'is there a subtree to confer or enumerate?' for ADR-038 and unenumerated-record-target, and there is none), and the union's container recomputation still rolls up entries with nothing declared beneath them, so a record whose children are all empty records still reports partial. Fixture coverage-empty-record.stm: tgt goes from 2/5 40% records {0,1,0} to 2/3 66% records {0,1,2}.

**2026-08-03T10:04:45Z**

Fix: as above, implemented in commit b0bcde51 (branch fix/coverage-container-counts, PR #431) — the Cause/Fix note above predates the commit and so omitted the reference AGENTS.md requires.
