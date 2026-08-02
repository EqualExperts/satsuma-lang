---
id: 3cc-iedv
status: closed
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

**2026-08-02T15:43:01Z**

Cause: coverage counted leaves on their own mapped flag, and a whole-record arrow (address -> address) registered only the path "address" — so the record read as mapped while every one of its leaves reported as a spec gap. The naive fix (inherit from any covered ancestor) was rejected during sl-4qvp because ancestor prefixes make a record's flag true when any single descendant is covered.
Fix: closed by sl-r6b0 on top of sl-fmx0's direct/derived model and sl-0pun's tri-state. computeMappingCoverage now distinguishes directly-covered paths from ancestor prefixes, and expands a whole-structure arrow into its declared subtree at set-build time — so a leaf beneath a directly-covered record reports mapped=true while a leaf beneath a record that is merely a prefix of a covered descendant does not (asserted in coverage.test.js's 'whole-subtree arrows' suite). VS Code gutter behaviour reviewed: it buckets on `mapped`, which is now defined as state !== 'uncovered', so partly covered records still paint as before; the wire type in coverage-logic.ts carries the new `state` and the deliberate choice not to render it is documented there. See ADR-037.

**2026-08-02T15:44:02Z**

Duplicate of the defect sl-r6b0 fixes: sl-r6b0 (PRD 38 R5, whole-subtree arrow coverage) already names this ticket in its description and carries 'this ticket closed with a note referencing that work' in its acceptance criteria. Linked and made dependent on sl-r6b0 rather than closed now — the defect is still live on main, so closing it before the fix ships would misreport coverage correctness. Close it when sl-r6b0 lands. Kept open deliberately; do not re-raise as a separate fix.

**2026-08-02T19:10:00Z**

Deferral condition met: sl-r6b0 landed on this branch, so the close recorded above stands. The two notes above were written minutes apart on separate branches — the earlier one closing this ticket with the fix, the later one (from the feature-archive branch, before the fix merged) deferring the close until sl-r6b0 shipped. Both are kept because each records a decision made on the evidence available at the time; this note reconciles them.
