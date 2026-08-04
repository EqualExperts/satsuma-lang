---
id: sl-5m9x
status: in_progress
deps: [sl-gsxu, sl-4qvp]
links: []
created: 2026-07-31T13:13:41Z
type: task
priority: 1
assignee: Thorben Louw
parent: sl-3de8
tags: [feature-36, viz]
---
# viz: coverage overlay toggle on the overview

PRD 36 R1. User-facing toggle (default off) switching the overview into coverage mode: each schema card shows mapped/total count and percentage from the core aggregate coverage function (same semantics as the satsuma coverage schema-level rollup), with a percentage badge and proportional header fill.

## Design

Overlay is paint-only: card sizes and ELK layout identical between modes so toggling never reshuffles the diagram. Use the existing token/theming system; respect light and dark themes; not colour-alone (dataviz accessibility conventions already used by the component). Component also accepts a host-supplied coverage model (user decision: VS Code reuses LSP computation).

## Acceptance Criteria

Toggle renders correct percentages on a fixture with one fully-mapped and one half-mapped schema, matching satsuma coverage --json values; layout geometry unchanged between modes (snapshot comparison); works from both self-computed (core in browser) and host-supplied models; light+dark rendering verified; unit tests pass locally.

