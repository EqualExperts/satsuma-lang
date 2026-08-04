---
id: saf-z30z
status: open
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

