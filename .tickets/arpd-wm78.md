---
id: arpd-wm78
status: closed
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


## Notes

**2026-08-05T11:00:19Z**

## Notes

**2026-08-05T14:00:00Z**

Cause: SATSUMA-CLI.md, AI-AGENT-REFERENCE.md's own CLI-section framing note, HOW-DO-I.md, and site/cli.njk all still described bare agent-reference only, with no mention of --section/--profile/--list or the back-compat guarantee, and no note that AI-AGENT-REFERENCE.md is now generated.
Fix: updated SATSUMA-CLI.md's Agent Setup table and back-compat/generated-file note; updated reference/cli-index.md's own framing blockquote (regenerating AI-AGENT-REFERENCE.md and the skill, and re-baking the CLI, so the note change flowed through every envelope and updated its own measured token cost); added a HOW-DO-I.md sentence on task-scoped slicing; added a "Only need part of it?" callout to site/cli.njk. Refreshed reference/token-costs.md and both PRDs' cited figures for the cli-index size change (6,728 tokens whole document, up from 6,653). All acceptance criteria checked off in features/45-agent-reference-progressive-disclosure/PRD.md after a full scripts/run-repo-checks.sh pass (commit immediately after 2eaad2f3).
