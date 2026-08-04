---
id: mbt-i81o
status: open
deps: [mbt-45v2]
links: []
created: 2026-08-04T11:08:48Z
type: task
priority: 2
assignee: Thorben Louw
parent: mbt-5l7g
---
# R6: Update docs for workspaces + Turborepo install/build flow

Update AGENTS.md, HOW-DO-I.md, and docs/developer/AGENT-CONTRIBUTIONS.md worktree setup instructions to reflect the new single-command workspaces install and Turborepo-driven build/test flow. Remove references to the old per-package install:all chain and the --ignore-scripts workaround.

## Acceptance Criteria

- AGENTS.md's worktree setup / install:all instructions match the new commands
- AGENT-CONTRIBUTIONS.md's worktree checklist (npm run install:all step) matches the new flow
- HOW-DO-I.md updated if it references the old install/build process
- No remaining doc references to the removed --ignore-scripts workaround or the old hand-sequenced build order

