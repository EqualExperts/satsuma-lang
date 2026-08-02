---
id: 3cc-iedv
status: open
deps: [sl-r6b0]
links: [3cc-t6uo, sl-r6b0]
created: 2026-07-31T14:02:18Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [coverage, core]
---
# coverage: a whole-record arrow leaves its nested leaves counted as uncovered

Coverage percentages count leaf fields on their own mapped flag (satsuma-core/src/coverage-rollup.ts, summarizeFieldCoverage). An arrow that copies an entire record — `address -> address` where both sides are record-typed — registers only the path "address", so the record's own entry is mapped but none of its leaves are. The schema then reports its address leaves as spec gaps even though one arrow populates all of them.

The obvious fix (a leaf inherits coverage from a covered ancestor) is wrong and was tried and rejected while implementing sl-4qvp: addPathAndPrefixes registers ancestor prefixes, so a record's mapped flag is already true when any *single* descendant is covered. Inheriting from it would turn 'one of twelve address fields is mapped' into 'all twelve are'. Excluding records instead under-counts the rarer whole-record case, erring toward a gap that is not there rather than hiding one that is.

A real fix needs the per-field computation to distinguish 'this exact path was written by an arrow' from 'this path was registered as an ancestor prefix of one' — i.e. coverage.ts tracking directly-covered paths separately from prefix-covered ones, then marking descendants of a directly-covered record as covered. That touches the per-mapping contract the VS Code gutter consumes, so it is deliberately out of feature 35's scope.

## Acceptance Criteria

computeMappingCoverage distinguishes directly-covered paths from prefix-registered ancestors; a leaf beneath a directly-covered record reports mapped=true while a leaf beneath a record that is merely a prefix of a covered descendant still reports mapped=false; core coverage and rollup tests cover both; VS Code gutter behaviour reviewed against the change.


## Notes

**2026-08-02T15:44:02Z**

Duplicate of the defect sl-r6b0 fixes: sl-r6b0 (PRD 38 R5, whole-subtree arrow coverage) already names this ticket in its description and carries 'this ticket closed with a note referencing that work' in its acceptance criteria. Linked and made dependent on sl-r6b0 rather than closed now — the defect is still live on main, so closing it before the fix ships would misreport coverage correctness. Close it when sl-r6b0 lands. Kept open deliberately; do not re-raise as a separate fix.
