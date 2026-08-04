---
id: saf-s2dw
status: open
deps: []
links: []
created: 2026-08-04T20:51:42Z
type: bug
priority: 2
assignee: Thorben Louw
parent: saf-dmvx
tags: [site, vscode]
---
# Reconcile '8 commands' claim with rendered command cards in site/vscode.njk

Stats bar and section heading both say '8 commands', but only 7 command cards render in that section (missing: Clear Mapping Coverage, a real 8th registered vscode command satsuma.clearCoverage). See PRD Finding B.2.

## Acceptance Criteria

The number of rendered command cards in the '8 commands at your fingertips' section equals the stated count of 8 (add the missing Clear Mapping Coverage card, or correct the stated number to match what's shown -- prefer adding the card since it's a real distinct command).

