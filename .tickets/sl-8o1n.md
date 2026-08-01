---
id: sl-8o1n
status: closed
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


## Notes

**2026-08-01T19:05:38Z**

Cause: addPathAndPrefixes stripped v1 bracket notation on the build side while isCoveredFieldPath never stripped it on the probe side — dead code in v2, where bracket paths are a parse error (iteration is each/flatten).
Fix: deleted the normalization rather than making it symmetric; a parser test pins that bracket paths do not parse, and the [] coverage-path tests were replaced with one pinning verbatim registration (commit 32579a9).
