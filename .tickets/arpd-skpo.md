---
id: arpd-skpo
status: open
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

