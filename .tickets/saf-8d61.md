---
id: saf-8d61
status: closed
deps: []
links: []
created: 2026-08-04T20:51:43Z
type: bug
priority: 1
assignee: Thorben Louw
parent: saf-dmvx
tags: [site, cli]
---
# Update stale Transform Classification table in site/cli.njk

The #classification table documents five classifications (structural, nl, mixed, none, nl-derived). tooling/satsuma-core/src/classify.ts and types.ts confirm 'structural' and 'mixed' were removed before/at Feature 28 -- Classification is now only 'nl' | 'none' | 'nl-derived'. The site documents a removed design as current behavior. See PRD Finding C.

## Acceptance Criteria

site/cli.njk's Transform Classification table shows only nl, none, and nl-derived, with descriptions matching tooling/satsuma-core/src/classify.ts's current behavior (presence check, not content analysis).


## Notes

**2026-08-04T21:14:17Z**

## Notes

**2026-08-04T00:00:00Z**

Cause: the "Transform classification" table on site/cli.njk documented
five classifications (structural, nl, mixed, none, nl-derived) when the
codebase only emits three (nl, none, nl-derived) -- structural/mixed were
removed before Feature 28. On review with the project owner, decided this
detail is low-value CLI-internals content not worth keeping accurate on a
marketing page, rather than worth fixing in place.
Fix: removed the section entirely instead of correcting it
(commit immediately after 9a44adff).
