---
id: saf-z30z
status: closed
deps: []
links: []
created: 2026-08-04T20:51:42Z
type: bug
priority: 1
assignee: Thorben Louw
parent: saf-dmvx
tags: [site, cli]
---
# Resolve self-contradicting 'coverage' command claim in site/cli.njk

The Structural Primitives section lists a real 'coverage' command with --fail-under CI-gating behavior, but the Design Boundaries section on the same page claims 'There are no impact, coverage, or audit commands.' See PRD Finding B.1.

## Acceptance Criteria

site/cli.njk no longer states that no coverage command exists, while still accurately noting there is no impact or audit command. The page is internally consistent when read start to end.


## Notes

**2026-08-04T21:01:39Z**

## Notes

**2026-08-04T00:00:00Z**

Cause: site/cli.njk's Design Boundaries section claimed "There are no impact,
coverage, or audit commands," while the Structural Primitives section on the
same page documents a real coverage command with its own --fail-under flag --
a direct self-contradiction.
Fix: removed coverage from the "does not exist" list and added a clause
clarifying that coverage is a real primitive (reports one schema's
mapped/unmapped fields) that doesn't itself compose into impact analysis or
an audit, which is still true and is why those two remain absent
(commit immediately after e9fae41a).
