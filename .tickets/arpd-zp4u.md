---
id: arpd-zp4u
status: open
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

