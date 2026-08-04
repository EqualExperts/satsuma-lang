---
id: saf-s2dw
status: closed
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


## Notes

**2026-08-04T21:01:39Z**

## Notes

**2026-08-04T00:00:00Z**

Cause: site/vscode.njk stated "8 commands" (stats tile and section heading)
but only 7 command cards were rendered in that section -- the real 8th
registered command, satsuma.clearCoverage, had no card of its own (it was
only mentioned in prose on the Show Mapping Coverage card).
Fix: added a "Clear Mapping Coverage" card so the rendered count matches the
stated count of 8 (commit immediately after e9fae41a).
