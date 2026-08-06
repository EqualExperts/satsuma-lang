---
id: sc-9xra
status: closed
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


## Notes

**2026-08-06T17:39:04Z**

Cause: seven live locations carried '40-60% smaller than YAML' and '3-8x less token usage than mapping spreadsheets', neither of which anyone could check; site/learn.njk also carried the '>90% valid Satsuma' claim that the PRD's own location table had missed.
Fix: replaced the YAML/JSON claims with the measured figures (median 9% vs YAML, 36% vs JSON, o200k_base, 21 specs), each linking reference/static-compactness.md. Removed the spreadsheet multiple rather than restating it - no spreadsheet arm has run, and arms X/M/C still need MappingIntent. Rewrote the index.njk FAQ, whose 'one Satsuma line becomes 5-7 lines of YAML' the measurement disproves, around the two claims that do hold up: a fixed grammar instead of per-author conventions, and an oracle in validate/lint. Pulled >90% from the site per PRD open decision 6 and marked it a target in PROJECT-OVERVIEW. (commit immediately after f215d7a4)
