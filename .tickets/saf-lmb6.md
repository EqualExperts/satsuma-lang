---
id: saf-lmb6
status: open
deps: []
links: []
created: 2026-08-04T20:51:42Z
type: bug
priority: 2
assignee: Thorben Louw
parent: saf-dmvx
tags: [site, examples, seo]
---
# Fix stale example/category counts in site/examples.njk front-matter

Front-matter description and og_description say 'Explore 16 canonical Satsuma examples' across 5 named categories; the rendered hero correctly says 20 examples / 6 categories (verified: 20 example-item cards, 6 distinct data-category values). The front-matter is stale from an earlier gallery size. See PRD Finding B.3.

## Acceptance Criteria

site/examples.njk front-matter description and og_description state 20 examples and list all 6 real categories (database migration, legacy modernization, enterprise integration, platform modelling, conventions, governance), matching the rendered hero exactly.

