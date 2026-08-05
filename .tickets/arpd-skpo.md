---
id: arpd-skpo
status: closed
deps: [arpd-rf7q]
links: []
created: 2026-08-05T09:56:50Z
type: task
priority: 1
assignee: Thorben Louw
parent: arpd-6iis
---
# Implement --section, --profile, --list on satsuma agent-reference

Add --section <id>, --profile write|read, --list flags to the agent-reference command. Bare invocation with no flags must remain byte-identical to today's output.

## Acceptance Criteria

satsuma agent-reference (no flags) byte-identical to current output, proven by a test comparing to the full section concatenation; --section <id> prints exactly that section; --profile write and --profile read print the documented slice; --list prints section ids (+ token costs, wired once T4 lands); invalid --section/--profile name errors clearly; CLI test suite green.


## Notes

**2026-08-05T10:08:28Z**

## Notes

**2026-08-05T10:45:00Z**

Cause: satsuma agent-reference had no way to print less than the whole document, so every consumer paid the full ~6.9k-token cost regardless of task shape.
Fix: added --section/--profile/--list to commands/agent-reference.ts, reading the section map baked by arpd-rf7q; bare invocation unchanged (proven byte-identical against AI-AGENT-REFERENCE.md by a new CLI test); added test/agent-reference.test.ts covering slicing, --list, and the not-found/mutual-exclusion error paths (commit immediately after eb22b2f8).
