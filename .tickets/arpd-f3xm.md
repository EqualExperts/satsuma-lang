---
id: arpd-f3xm
status: open
deps: [arpd-skpo, arpd-s1tt, arpd-p10c]
links: []
created: 2026-08-05T09:56:50Z
type: task
priority: 1
assignee: Thorben Louw
parent: arpd-6iis
---
# Cross-envelope drift tests + CLI-flag drift guard for cli-index.md

Add tests asserting: every canonical section appears in at least one envelope (CLI full doc, portable blob, skill) with no orphans; every id --list reports resolves via --section; every satsuma CLI flag named in reference/cli-index.md actually exists on the corresponding command (so the index can't drift from real flags).

## Acceptance Criteria

three new/updated test cases exist and pass: no-orphan-sections, --list-names-resolve, cli-index-flags-exist; CI-relevant package test suite green.

