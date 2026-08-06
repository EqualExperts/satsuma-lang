---
id: sc-wspp
status: in_progress
deps: []
links: [sl-qz3v]
created: 2026-08-06T16:35:23Z
type: task
priority: 2
assignee: Thorben Louw
tags: [eval, feature-44]
---
# eval: design and commit the equivalent-YAML/JSON serialisation shapes

Feature 44's static-compactness arms Y and J need an 'equivalent YAML' design, because there is no YAML mapping spec anywhere in this repo - the site's '40-60% smaller than YAML' claim cites 'our v3', a design predating the repository. The design decides the measured answer, so it must be committed before the measurement runs and must be charitable to YAML (as terse as a competent author plausibly would write), making the resulting ratio a lower bound on Satsuma's advantage.

## Acceptance Criteria

evals/static-compactness/SERIALISATION-DESIGN.md committed, defining the YAML and JSON shapes key by key; a worked total rendering of examples/sfdc-to-snowflake/pipeline.stm included; every .stm construct's encoding stated, or listed as unrepresentable with its handling; an explicit charity argument that survives a sceptic; committed before any measurement is run

