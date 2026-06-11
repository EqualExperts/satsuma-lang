---
id: sl-w1dr
status: open
deps: []
links: []
created: 2026-06-11T02:43:30Z
type: chore
priority: 3
assignee: Thorben Louw
tags: [bug-hunt, docs]
---
# docs: CLI command count drift — 22 commands, nl-refs undocumented in SATSUMA-CLI.md, stale 16-command claims

The CLI now exposes 22 commands. SATSUMA-CLI.md documents 21 — nl-refs is missing entirely (it appears in AI-AGENT-REFERENCE.md:331,407). CLAUDE.md (lines 5 and 13) and README.md:249 still say "16-command CLI"/"16 commands". Replace hardcoded counts or update them, and add nl-refs to the CLI reference.

## Acceptance Criteria

nl-refs documented in SATSUMA-CLI.md; all command-count claims accurate (or de-numbered); doc check covers the count.

