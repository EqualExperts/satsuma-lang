---
id: saf-dmvx
status: closed
deps: []
links: []
created: 2026-08-04T20:51:12Z
type: epic
priority: 1
assignee: Thorben Louw
tags: [site, docs]
---
# Marketing site audit fixes

Fix correctness issues found by an exhaustive audit of site/ (fabricated example snippets, self-contradicting claims, stale docs, dead link, numeric drift). See features/43-site-audit-fixes/PRD.md for full findings.


## Notes

**2026-08-04T21:33:51Z**

## Notes

**2026-08-04T00:00:00Z**

Cause: exhaustive audit of site/ found fabricated example snippets, two
self-contradicting claims, a stale internals table, a dead link, stats
drift, an undersold real Kimball/SCD example, and internals-flavoured
CLI/VS Code pages the project owner asked to be redesigned around
workflows rather than feature inventories.
Fix: all 11 child tickets closed across 4 commits on feat/site-audit-fixes
(PR #485): fabricated snippets corrected against real fixtures, both
self-contradictions resolved, low-value classification table removed
outright, dead link fixed, stats.json synced, a real Kimball SCD-2 example
added to the gallery, and both cli.njk and vscode.njk restructured around
user/agent workflows instead of internals listings. Left open per the
project owner: a UK-English copy pass and the "Diaries" nav placement
question, neither scoped into this epic (commit immediately after
9693dec1).
