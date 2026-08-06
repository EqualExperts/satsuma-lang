---
id: sc-wspp
status: closed
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


## Notes

**2026-08-06T17:31:01Z**

Cause: the site's '40-60% smaller than YAML' claim cites 'our v3', a YAML design that predates this repo and exists nowhere in it, so 'equivalent YAML' had to be designed - and the design sets the answer (a naive projection dump measures 1602 tokens on sfdc-to-snowflake where the committed design measures 814, which would have 'proved' 49%).
Fix: commissioned three independent designs (terse-maximalist, idiomatic/dbt-style, flat-relational), scored each by three judges on totality, terseness and author plausibility, and synthesised a name-keyed design governed by three rules (open vocabulary keys, a sequence escape for repeated keys, two mandatory quoting rules). Committed as evals/static-compactness/SERIALISATION-DESIGN.md BEFORE the measurement ran, with every declined saving named and priced. Key finding: the entire span of defensible YAML encodings is under 7% of the file, against a claim needing 67-150%, so the design choice cannot decide the result. (commit immediately after d5a2c6b3)
