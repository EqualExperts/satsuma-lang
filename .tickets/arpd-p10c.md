---
id: arpd-p10c
status: open
deps: [arpd-pa0u]
links: []
created: 2026-08-05T09:56:50Z
type: task
priority: 2
assignee: Thorben Louw
parent: arpd-6iis
---
# Ship a satsuma language skill wrapper (lazy-loading envelope)

Add an 8th skills/ entry — a thin satsuma-language skill whose SKILL.md frontmatter is the ~50-100 token resident cost and whose body lazily loads canonical reference/ sections (composed, not hand-restated) matching the agentskills.io format the other 7 skills already use.

## Acceptance Criteria

skills/satsuma-language/SKILL.md exists, follows the same structure as an existing skill (e.g. skills/excel-to-satsuma), its body content is composed from reference/ sections (checked by the envelope-drift test in the next ticket) rather than hand-restated, and it is wired into whatever mechanism keeps the other skills' slash-command symlinks working.

