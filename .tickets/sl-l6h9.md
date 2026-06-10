---
id: sl-l6h9
status: in_progress
deps: [sl-ncu9]
links: []
created: 2026-06-09T21:15:33Z
type: task
priority: 3
assignee: Thorben Louw
tags: [live-editor, docs]
---
# Feature 33 — documentation updates for the live editor

Document the shipped playground. Update: tooling/satsuma-viz-harness/README.md (the harness's dual role as Playwright host AND source of the public playground, the static build target, the client-side model pipeline, and the localStorage document library); docs/product-owner/PROJECT-OVERVIEW.md (the browser playground as a first-class product surface + the client-only/privacy guarantee); docs/product-owner/ROADMAP.md (move this item to in-progress/shipped); docs/using-satsuma-without-cli.md (add 'Try it Live in the browser' as a zero-install path); HOW-DO-I.md (add 'How do I try Satsuma without installing anything?' -> the playground).

## Acceptance Criteria

harness README documents the dual role, static build target, client-side pipeline, and localStorage library; PROJECT-OVERVIEW adds the playground + privacy guarantee; ROADMAP reflects shipped status; using-satsuma-without-cli and HOW-DO-I each gain a zero-install 'Try it Live' entry.

