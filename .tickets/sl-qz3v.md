---
id: sl-qz3v
status: open
deps: [sl-jdho, sl-x9m1, sl-3yzd]
links: []
created: 2026-08-05T09:29:10Z
type: epic
priority: 1
assignee: Thorben Louw
tags: [eval, feature-44]
---
# Feature 44 Phase 0.5 — insight-first eval probe

Run a cheap, hand-graded probe that returns a directional effect size for the Satsuma-vs-spreadsheet-vs-markdown comparison BEFORE building the Phase 1-3 machinery (MappingIntent, three renderers, totality test, blind pairing audit, deterministic graders).

See features/44-token-and-task-eval/PRD.md, section 'Phase 0.5 - the probe that decides whether to build the machinery'.

Blocked on Feature 45 (agent-reference progressive disclosure) shipping AND releasing, so the reference the probe charges against is the one that will actually be measured, and so F45's slicing design cannot be tuned against probe outcomes.

Budget ~$8. Results are explicitly NON-PUBLISHABLE - not evidence, not pre-registered, never quoted on the site or in RESULTS.md.

## Acceptance Criteria

- All child tickets closed
- A go/no-go decision recorded against the PRD's pre-committed kill thresholds
- Probe numbers absent from site copy and RESULTS.md

