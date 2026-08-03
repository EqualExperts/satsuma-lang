---
id: sl-ay8a
status: closed
deps: [sl-j30s, sl-hysg, sl-1u6r]
links: []
created: 2026-07-31T13:14:15Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-iffm
tags: [feature-37, docs]
---
# docs: lint rules table, config file reference, agent-reference update

PRD 37 R6 (renumbered from R4 in doc review 2026-07-31, when the config file and lint exit-code table became R4 and R5). Add both rules to the SATSUMA-CLI.md lint rules table with severity and fixability, document the exemptions prominently (transform-bearing arrows never type-checked, with the design-principle rationale; self-mappings never cycles, with the roadmap citation), and document the satsuma.config.yaml schema (suppression, type aliases, strict). Update AI-AGENT-REFERENCE.md so agents drafting mappings know a bare arrow asserts type-preserving identity and a transform body suppresses the check.

## Design

Also document, added in doc review 2026-07-31: the lint exit-code table from sl-1u6r (0/1/2/3) as a lint-specific table following the fmt precedent at SATSUMA-CLI.md:86; that value maps are never type-checked because they classify as nl; the suppression precedence rule from sl-npi6 (flags win over config, --ignore and lint.suppress union, --select still runs a suppressed rule); and that lineage-cycle reports one finding per strongly-connected component rather than per elementary cycle, so a reviewer reading one finding knows it may cover several cycles.

## Acceptance Criteria

SATSUMA-CLI.md rules table, config-file section and lint exit-code table added; exemptions (transform bodies, value maps, self-mappings) documented with their rationale and citations; suppression precedence documented; SCC-per-finding behaviour explained; AI-AGENT-REFERENCE.md updated and regenerated into the CLI agent-reference output; HOW-DO-I.md updated if it indexes lint guidance.


## Notes

**2026-08-03T17:52:37Z**

**2026-08-03T17:52:37Z**

Cause: R6's documentation overlaps sl-1u6r's acceptance criteria — both require the lint exit-code table in SATSUMA-CLI.md — and documenting the table without the rules it governs would have shipped a half-consistent reference.
Fix: Landed with the three rule/exit-code tickets rather than after them. SATSUMA-CLI.md gained both rules in the table plus a per-rule subsection covering every exemption with its rationale and the roadmap citation, and a Lint exit codes table; the CLI-wide exit-code section now points at it. AI-AGENT-REFERENCE.md tells authors a bare arrow asserts type-preserving identity and a transform body suppresses the check (baked into satsuma agent-reference at build time, so no separate regeneration step). HOW-DO-I.md gained four lint questions. Suppression precedence was already documented by sl-npi6 and stands. (commit immediately after acbb3b96)
