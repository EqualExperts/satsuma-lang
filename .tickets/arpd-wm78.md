---
id: arpd-wm78
status: open
deps: [arpd-skpo]
links: []
created: 2026-08-05T09:56:50Z
type: task
priority: 2
assignee: Thorben Louw
parent: arpd-6iis
---
# Docs: describe --section/--profile/--list and the generated-file contract

Update SATSUMA-CLI.md's agent-reference entry, AI-AGENT-REFERENCE.md's own framing note (now that it's generated), HOW-DO-I.md, and site/cli.njk's description of agent-reference to cover the new flags and state the back-compat guarantee (bare invocation unchanged).

## Acceptance Criteria

all four docs updated and internally consistent with the shipped flags; no dangling references to the old single-string baking mechanism.

