---
id: sl-jdho
status: open
deps: [sl-6ips]
links: []
created: 2026-08-05T09:29:28Z
type: task
priority: 1
assignee: Thorben Louw
parent: sl-qz3v
tags: [eval, feature-44]
---
# Author the probe scenario and its answer keys

Hand-author one ~10-mapping scenario and express it in each probe representation: .xlsx at P0 and P2, markdown at M0, and .stm. Also author a 1-mapping variant (the cell designed to make S+ lose).

Write the T4 and T5 answer keys AT AUTHORING TIME, before any episode runs: T4 = the true downstream set for a chosen field; T5 = the list of planted ambiguities plus the unambiguous fields used for the false-positive rate.

Reuse archive/features/04-excel-to-stm-skill/test-data/generate_test_spreadsheets.py for P0/P2 workbook construction.

## Acceptance Criteria

- Five artifacts exist for the 10-mapping scenario (X-P0, X-P2, M0, .stm) plus the 1-mapping variant
- T4 and T5 answer keys committed, authored before any episode runs
- Planted ambiguities are genuine (underspecified rounding, target field with no stated source, value map missing a case, implicit timezone), not typos
- A note recording that the markdown arm is hand-authored and therefore at risk of summary drift - the reason probe results are non-publishable

