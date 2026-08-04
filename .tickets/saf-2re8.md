---
id: saf-2re8
status: open
deps: []
links: []
created: 2026-08-04T20:51:43Z
type: bug
priority: 1
assignee: Thorben Louw
parent: saf-dmvx
tags: [site, learn, links]
---
# Fix dead PROJECT-OVERVIEW.md link in site/learn.njk

Links to https://github.com/EqualExperts/satsuma-lang/blob/main/PROJECT-OVERVIEW.md which 404s -- the file actually lives at docs/product-owner/PROJECT-OVERVIEW.md. See PRD Finding D.

## Acceptance Criteria

The link in site/learn.njk's documentation-hub Tutorials card points to blob/main/docs/product-owner/PROJECT-OVERVIEW.md and resolves (spot check against the real repo path).

