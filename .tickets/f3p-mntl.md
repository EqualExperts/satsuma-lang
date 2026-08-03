---
id: f3p-mntl
status: in_progress
deps: []
links: []
created: 2026-08-03T09:55:46Z
type: task
priority: 2
assignee: Thorben Louw
tags: [feature-39, docs]
---
# Revise Feature 39 correctness-by-default PRD

Review and revise features/39-correctness-by-default/PRD.md against the current implementation and repository architecture. Correct overclaims and unsound type assumptions, separate core delivery from optional research spikes, make sequencing and acceptance criteria independently actionable, and preserve the draft's evidence-backed motivation.

## Acceptance Criteria

The PRD accurately accounts for tree-sitter ERROR/recovery nodes; requirements distinguish compile-time kind safety from grammar coverage; property claims include explicit preconditions; production type hardening is separated from lint/tooling rollout and optional research; sequencing reflects current Feature 38 ticket state; ticket map is implementable; markdown and repository checks pass.

