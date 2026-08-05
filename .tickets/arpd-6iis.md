---
id: arpd-6iis
status: closed
deps: []
links: []
created: 2026-08-05T09:56:13Z
type: epic
priority: 1
assignee: Thorben Louw
---
# Feature 45 epic: progressive disclosure for the AI agent reference

Restructure AI-AGENT-REFERENCE.md into canonical reference/ sections composed at build time; add satsuma agent-reference --section/--profile/--list; keep bare invocation byte-identical. See features/45-agent-reference-progressive-disclosure/PRD.md. Closes gate sl-6ips when merged and released.


## Notes

**2026-08-05T15:56:02Z**

Epic complete. All 9 arpd-* children closed, and the gate condition on this epic's description ('Closes gate sl-6ips when merged and released') is now satisfied: merged in PR #492, released in v0.13.0 (tag -> 69296bd6, 2026-08-05). sl-6ips closed alongside this. (commit immediately after 1aa47896)
