---
id: sl-iffm
status: open
deps: []
links: []
created: 2026-07-31T13:14:15Z
type: epic
priority: 1
assignee: Thorben Louw
tags: [feature-37, cli, core]
---
# Feature 37 epic: structural lint rules (type mismatch, lineage cycles) and lint config

Implement features/37-lint-structural-rules/PRD.md: two new warning-severity lint rules — type-mismatch-direct-arrow (bare arrows between fields of different declared types) and lineage-cycle (schema-level cycles, self-mappings exempt per the recorded roadmap decision) — with detection logic in @satsuma/core. Open questions resolved by user review 2026-07-31: add a YAML config file (default ./satsuma.config.yaml) with a type-alias mapping section and global lint rule suppression; warnings stay advisory but can be escalated to a failing exit code.

Doc review 2026-07-31 settled four further points. (1) Config file is satsuma.config.yaml, not .satsumacfg — .satsuma is a first-class source extension. (2) Config suppression is the persistent form of the existing --ignore flag, not a parallel mechanism; flags win over config. (3) lineage-cycle reports one finding per strongly-connected component rather than per elementary cycle, which removes the need for a truncation cap. (4) Strict mode forced lint's exit codes to be pinned down: lint currently returns 2 for error findings where 2 is documented as "parse error", so lint gets its own documented table (0/1/2/3) — a breaking change for CI consumers.

