---
id: 3cc-t6uo
status: closed
deps: []
links: [3cc-iedv, sl-4qvp]
created: 2026-07-31T14:40:39Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [vscode, coverage, feature-35]
---
# vscode: status-bar coverage percentage uses a third counting rule, disagreeing with satsuma coverage

computeTargetCoverageStats() in tooling/vscode-satsuma/src/commands/coverage-logic.ts:82 counts only top-level target fields, filtering `!f.path.includes(".")`. ADR-034 establishes leaf-only counting on each field's own flag as the single rule, implemented in satsuma-core's summarizeFieldCoverage() and used by satsuma coverage, --fail-under, and (shortly) the viz overlay.

The two therefore disagree on any schema with nested records. For a target with `address record { line1 line2 ... }` plus two scalar fields, the status bar counts 3 units and reports a record with one mapped leaf as fully covered; `satsuma coverage` counts every leaf and reports the same schema far lower. A user with the extension open beside a terminal sees two different percentages for one mapping and cannot tell which is wrong.

Pre-existing — the status bar's rule predates feature 35, which is why it was left alone rather than changed inside that branch (ADR-034 records it as a known divergence rather than silently fixing it). Worth noting the divergence is confined to the *percentage*: the gutter decorations are per-field and already come from core, so they are correct.

Fix direction: delete computeTargetCoverageStats' own counting and call core's summarizeFieldCoverage() over the target schema's fields. The LSP's satsuma/mappingCoverage response already carries every field entry the function needs, so this is a delegation, not new plumbing. Check whether the status bar wants the target-role figure only (it currently does) or the aggregate now that one exists.

## Acceptance Criteria

computeTargetCoverageStats delegates to @satsuma/core summarizeFieldCoverage with no counting logic of its own; a nested-record fixture asserts the status-bar percentage equals what satsuma coverage reports for the same mapping and schema; existing vscode unit tests updated to the leaf-only expectations; the top-level-only rule and its 'nested paths would double-count' comment removed rather than left as a stale explanation.


## Notes

**2026-07-31T16:51:57Z**

Cause: computeTargetCoverageStats counted top-level target fields only (filtering !path.includes('.')), a third counting rule alongside ADR-034's leaf-only rule in core. It disagreed with satsuma coverage on any schema with nested records — the sample fixture reported 1/2 (50%) where core reports 2/3 (67%).

Fix: deleted the local counting and delegated to @satsuma/core summarizeFieldCoverage, per the fix direction in the description. The top-level-only rule and its stale 'nested paths would double-count' comment are removed rather than left as an explanation for code that no longer does that. TargetCoverageStats also gains mappedNl so the status-bar tooltip can report how much of the figure came from resolved @refs.

Fixed as part of sl-qxyl rather than separately: ADR-036 requires that a consumer computing its own coverage figure be reconciled rather than carried, because the tier split would have turned one disagreement into two. Status bar, satsuma coverage and (once feature 36 lands) the viz overlay now share one implementation.

vscode suite: 34 pass. The grouping test's marker count moved from 2 to 3 with the fixture — gutter decorations mark every entry including records, unlike the percentage, which counts leaves; that distinction is now stated in the test.
