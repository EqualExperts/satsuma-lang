---
id: sc-9xra
status: open
deps: [sc-pgih]
links: []
created: 2026-08-06T16:35:46Z
type: task
priority: 2
assignee: Thorben Louw
tags: [eval, feature-44, docs]
---
# site: correct the YAML compactness claim to the measured figure

The site states '40-60% smaller' than YAML and '3-8x less token usage' than spreadsheets in seven live locations (PRD table, lines 886-896; README.md:179 is already fixed). Replace the YAML/JSON claim with the measured figure from reference/static-compactness.md, and remove the spreadsheet claim rather than restating it, since no spreadsheet arm has run. The PRD's publishing commitment applies: 'the site copy follows the data'.

## Acceptance Criteria

All seven locations updated; the published figure matches reference/static-compactness.md exactly; the claim is scoped to YAML and JSON only, naming the tokeniser; the spreadsheet multiple is removed, not restated; the '>90% valid Satsuma' claim at site/learn.njk pulled per PRD open decision 6

