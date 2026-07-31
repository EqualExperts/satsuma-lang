---
id: sl-tdfx
status: closed
deps: [sl-oqsj, sl-3ms0, sl-268g]
links: []
created: 2026-07-31T13:13:05Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-ce11
tags: [feature-35, docs]
---
# docs: coverage command reference, JSON contract, agent-reference update

PRD 35 R5. Add coverage to the SATSUMA-CLI.md extractors table plus a section documenting the JSON contract as stable (consumed by feature 36) and the per-mapping vs aggregate distinction. Update AI-AGENT-REFERENCE.md: the composed coverage-assessment workflow is replaced by the single command, retained only to explain semantics.

## Design

Added in doc review 2026-07-31: `fields --unmapped-by` is retained as a convenience alias (user decision), so the docs must position the two commands rather than silently leave both. Say plainly which to reach for: `fields --unmapped-by` for one schema against one mapping, `coverage` for anything workspace-wide or aggregated. The specific places that currently teach the composed workflow are AI-AGENT-REFERENCE.md:391 (the intersect-yourself recipe, now replaced by `coverage`), plus :329, :409 and :441, and SATSUMA-CLI.md:196.

Also document the coverage-specific exit code table from sl-268g (0/1/2/3), following the fmt precedent at SATSUMA-CLI.md:86.

## Acceptance Criteria

SATSUMA-CLI.md documents flags, the coverage-specific exit code table, and the full JSON shape marked as a stable contract; the per-mapping vs aggregate distinction is explained, not just labelled; docs state when to use `fields --unmapped-by` versus `coverage`; AI-AGENT-REFERENCE.md:391 composed recipe replaced (semantics retained as explanation) and lines 329/409/441 updated; agent-reference output regenerated and includes the new command; HOW-DO-I.md index updated if it references coverage workflows.


## Notes

**2026-07-31T14:22:57Z**

Cause: coverage was documented only as a composed agent workflow (query fields, repeat per mapping, intersect yourself) across SATSUMA-CLI.md and AI-AGENT-REFERENCE.md.
Fix: SATSUMA-CLI.md gains coverage in the Structural Analysis table plus a full section — flags, the structural/leaf-counting semantics, an explicit per-mapping vs aggregate table explaining why the two are not interchangeable, the JSON shape marked as a stable contract, the coverage-specific 0/1/2/3 exit table with the reasoning for 3, and a 'which do I reach for' table positioning coverage against fields --unmapped-by. AI-AGENT-REFERENCE.md: the intersect-yourself recipe at :391 is replaced by a single command with the aggregation semantics retained as explanation of why not to compose it by hand; the 'no coverage command' claim at :299, the command reference at :329, the decision table at :409 and the authoring checklist at :441 all updated; agent-reference output regenerated at build time and contains the new command. HOW-DO-I.md gains two entries (finding unmapped fields, gating CI).

Added a docs test asserting every key coverage --json emits appears in the documented contract — a stable contract nobody checks is just a comment. 959 CLI tests pass; all four lints clean.
