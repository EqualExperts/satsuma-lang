---
id: arpd-s1tt
status: closed
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


## Notes

**2026-08-05T10:12:11Z**

## Notes

**2026-08-05T11:00:00Z**

Cause: AI-AGENT-REFERENCE.md had no regeneration mechanism, so nothing would keep it in sync with reference/*.md once those became the source of truth.
Fix: added scripts/regenerate-agent-reference.mjs (writes AI-AGENT-REFERENCE.md via reference/compose.mjs's composeFull) and an npm alias `regenerate:agent-reference`; the drift guard itself already existed from arpd-pa0u's scripts/agent-reference-compose.test.mjs, which runs under `npm run test:scripts` in run-repo-checks.sh. Confirmed regeneration is currently a no-op (git diff empty). Deviation from the ticket's own acceptance text: did not add an in-file "this file is generated" header, because that would make AI-AGENT-REFERENCE.md diverge byte-for-byte from composeFull(sections) and break both the drift test and the CLI's byte-identical bare-invocation contract — the generated-file notice instead belongs in SATSUMA-CLI.md/CLAUDE.md's description of the file (arpd-wm78), not inside the composed content itself (commit immediately after 80bce810).
