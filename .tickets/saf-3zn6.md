---
id: saf-3zn6
status: open
deps: []
links: []
created: 2026-08-04T20:51:42Z
type: bug
priority: 2
assignee: Thorben Louw
parent: saf-dmvx
tags: [site, learn]
---
# Remove false SCD Type 2 / Kimball star schema claim from site/learn.njk

The Data & ML Engineers pathway's Example Walkthroughs blurb claims the examples gallery includes 'multi-source joins, SCD Type 2, Kimball star schemas, and more' -- only the multi-source-joins part is true; grep of site/examples.njk finds zero matches for 'scd' or 'kimball'. See PRD Finding B.4.

## Acceptance Criteria

site/learn.njk's Example Walkthroughs blurb only names patterns that actually exist in site/examples.njk (e.g. multi-source joins, namespace/platform modelling, governance metadata, merge strategies), or the missing patterns are added as real example cards instead (out of scope for this ticket unless trivial).

