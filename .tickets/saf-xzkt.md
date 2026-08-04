---
id: saf-xzkt
status: closed
deps: []
links: []
created: 2026-08-04T20:51:43Z
type: bug
priority: 1
assignee: Thorben Louw
parent: saf-dmvx
tags: [site, data]
---
# Sync site/_data/stats.json with root test-stats.json

site/_data/stats.json has drifted from the authoritative root test-stats.json: satsuma-core (689 vs 697), satsuma-cli (1049 vs 1061), satsuma-viz-model (6 vs 7), satsuma-viz-backend (186 vs 190), satsuma-viz (137 vs 145), and integration-tests (3) is missing entirely from the site's packages object. cliCommands, parserCorpusTests, satsuma-lsp, and vscode-satsuma are already correct. See PRD Finding E.

## Acceptance Criteria

site/_data/stats.json's packages object matches test-stats.json's packages object exactly, field for field, including adding integration-tests. Consider whether a build step should generate site/_data/stats.json from test-stats.json automatically to prevent future drift (note as a follow-up if out of scope for this ticket).


## Notes

**2026-08-04T21:14:17Z**

## Notes

**2026-08-04T00:00:00Z**

Cause: site/_data/stats.json had drifted from the authoritative root
test-stats.json across 5 package test counts and was missing the
integration-tests package entirely.
Fix: overwrote site/_data/stats.json's packages object to match
test-stats.json exactly. No script yet regenerates this automatically --
noted as a good follow-up (not scoped here) to stop future drift
(commit immediately after 9a44adff).
