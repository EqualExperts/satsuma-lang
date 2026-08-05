---
id: arpd-zp4u
status: closed
deps: [arpd-skpo, arpd-p10c]
links: []
created: 2026-08-05T09:56:50Z
type: task
priority: 1
assignee: Thorben Louw
parent: arpd-6iis
---
# Real-tokenizer measurement: per-section/profile/envelope costs + MCP schema comparison

Replace every bytes/4 estimate in the Feature 45 PRD with measured token counts using a real tokenizer (tiktoken o200k_base at minimum; Anthropic count-tokens endpoint too if ANTHROPIC_API_KEY is available). Report per section, per profile, and per envelope (CLI/portable-blob/skill) with the resident-vs-loaded distinction made explicit. Also generate JSON-schema for the CLI's 23 commands and count their resident token cost as an MCP-tool-schema comparison point (no MCP server built).

## Acceptance Criteria

a script/tool produces measured counts per tokenizer for: whole document, each of the 8 sections, each profile, each envelope's resident vs loaded cost; MCP schema resident-cost figure recorded; --list (from the previous ticket) is wired to real measured numbers, not estimates; results committed somewhere reviewable (e.g. a RESULTS section in the PRD or a generated report file).


## Notes

**2026-08-05T12:00:00Z**

Cause: every ≈-token figure in the Feature 45 PRD was a bytes/4 estimate, `--list` had no real cost to report, and the PRD's MCP-server non-goal asserted a resident-cost comparison without measuring it.
Fix: added reference/token-cost.mjs (o200k_base via js-tiktoken, one counter shared by prebuild.js and the new measurement script); prebuild.js now bakes a measured tokenCost per section, and satsuma agent-reference --list prints it; added scripts/measure-agent-reference-tokens.mjs, which measures whole-document/per-section/per-profile costs, each envelope's resident-vs-loaded cost (cli/portable-blob/skill), and builds real MCP-tool-style JSON schemas from the CLI's 23 live command registrations to measure that comparison point (2,253 tokens resident, always, vs 0 for the CLI and 164 for the skill's frontmatter); results committed as reference/token-costs.json and reference/token-costs.md; PRD's Background/Requirements/Non-goals sections updated with the measured numbers and a link to the report (commit immediately after 39e7a2ad).
