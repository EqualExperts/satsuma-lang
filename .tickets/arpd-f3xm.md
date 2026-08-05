---
id: arpd-f3xm
status: closed
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


## Notes

**2026-08-05T10:47:02Z**

## Notes

**2026-08-05T12:30:00Z**

Cause: nothing verified that the three shipped envelopes (CLI, portable blob, skill) actually carried every canonical section, that --list's ids all resolved via --section, or that cli-index.md's documented flags still existed on the real commands after a rename.
Fix: added a no-orphan-sections test to scripts/agent-reference-compose.test.mjs checking each section's content is present in all three envelopes; added a --list-names-resolve test to agent-reference.test.ts looping every listed id through --section; added tooling/satsuma-cli/test/cli-index-flags.test.ts, which parses satsuma <command> --flag examples out of reference/cli-index.md and checks each flag against the command's real Commander registration loaded from dist/ (commit immediately after b367f08a).
