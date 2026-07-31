---
id: sl-ay8a
status: open
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

