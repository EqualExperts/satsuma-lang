---
id: sl-8o1n
status: open
deps: []
links: []
created: 2026-07-31T14:44:15Z
type: chore
priority: 3
assignee: Thorben Louw
parent: sl-j6g9
tags: [feature-38, core]
---
# core: make [] path normalization symmetric or delete it

PRD 38 R7, hygiene. addPathAndPrefixes strips [] when BUILDING the covered set but isCoveredFieldPath does not strip it when PROBING, so a probe containing [] never matches. Note this is dead code for current syntax: [] was removed from all paths in v2 (grammar.js:429-431, 'iteration is expressed via each/flatten') and bracket paths cannot parse. Either make the normalization symmetric via one shared named helper used by both sides, or delete it and keep a test asserting bracket paths do not parse. Do not leave it asymmetric and undocumented.

## Acceptance Criteria

Either one shared normalization helper used on both the build and probe sides with a test asserting both directions match, or the normalization removed with a test asserting bracket paths are a parse error; the existing core tests that assert [] stripping (coverage.test.js, coverage-paths.test.js) updated to match whichever is chosen, with a comment citing the v2 syntax decision.

