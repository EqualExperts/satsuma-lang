---
id: sl-mnya
status: closed
deps: []
links: [sl-13p5, sl-x9m1]
created: 2026-10-06T16:00:00Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [docs, adr]
---
# adrs: two ADRs share the number 052

`adr-052-git-derived-non-release-artifact-identity.md` (sl-13p5, merged 2026-08-10) and `adr-052-the-behavioural-eval-consumes-releases-and-lives-in-its-own-repository.md` (sl-x9m1, merged 2026-08-11) both use ADR-052, so every citation of "ADR-052" is ambiguous. Found while writing the diary backfill on 2026-10-06.

## Acceptance Criteria

- The later ADR (the eval record) is ADR-054 in its file name and heading; its Status line records the renumbering. No other body text changes.
- ADR-052 stays the non-release artifact identity record, which sl-13p5 already cites.
- A scripts test fails when two ADRs share a number, or when a heading's number differs from its file name.

## Notes

**2026-10-06T16:00:00Z**

Cause: two branches in flight on 10–11 Aug each took the next free ADR number; neither could see the other's file, and nothing checked the merged tree.
Fix: renamed the eval ADR to ADR-054 (file, heading, Status note) and added scripts/adr-numbers.test.mjs, run by test:scripts and so by the pre-commit hook; checked to fail with the duplicate restored. (commit immediately after d94b961d)
