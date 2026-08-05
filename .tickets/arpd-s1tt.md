---
id: arpd-s1tt
status: open
deps: [arpd-rf7q]
links: []
created: 2026-08-05T09:56:50Z
type: task
priority: 1
assignee: Thorben Louw
parent: arpd-6iis
---
# Regenerate AI-AGENT-REFERENCE.md as the portable-blob envelope + drift guard

AI-AGENT-REFERENCE.md becomes a generated artifact: the full concatenation of reference/*.md, produced by the same shared composer used by the CLI prebuild. Add a repo check (wired into scripts/run-repo-checks.sh) that fails if AI-AGENT-REFERENCE.md drifts from what reference/ would generate.

## Acceptance Criteria

AI-AGENT-REFERENCE.md content is identical before/after this change; a documented command regenerates it from reference/; run-repo-checks.sh (or an equivalent CI-covered check) fails on drift; a header note in the file states it is generated and points at reference/.

