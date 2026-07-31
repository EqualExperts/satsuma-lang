---
id: sl-npi6
status: open
deps: []
links: []
created: 2026-07-31T13:14:15Z
type: task
priority: 1
assignee: Thorben Louw
parent: sl-iffm
tags: [feature-37, core, cli]
---
# core+cli: satsuma.config.yaml YAML config loader (lint suppression, type aliases, strict mode)

User decision from PRD 37 review: introduce a workspace config file, default path ./satsuma.config.yaml (YAML), with a lint section supporting: global rule suppression (list of rule ids), type alias groups consumed by the type-mismatch rule (e.g. a group declaring STRING/TEXT/VARCHAR equivalent), and a strict flag escalating warnings to a failing exit code. CLI gains a --config <path> override.

## Design

Loader and config types live in @satsuma/core (the LSP will need the same config when it mirrors these diagnostics). Missing file is not an error (all defaults); malformed YAML or unknown structure fails loudly with a clear message. Document the schema with commented examples. Run npm audit after adding any YAML dependency per the security policy.

File name settled in doc review 2026-07-31: satsuma.config.yaml, not the originally proposed .satsumacfg. `.satsuma` is a first-class Satsuma source extension (SATSUMA_FILE_EXTENSIONS = [".stm", ".satsuma"], core/source-files.ts:18), so a dotfile named .satsumacfg sits one character from a source-file glob and gets no editor YAML association or schema support.

Suppression precedence — deliberately simple (user: "go for simplicity"). lint.suppress is the persistent form of the existing --ignore <rules> flag (SATSUMA-CLI.md:104), not a parallel mechanism. One rule: flags win over config, and the union of --ignore and lint.suppress is suppressed. --select keeps meaning "run exactly these", so an explicitly selected rule runs even when the config suppresses it — naming a rule is an unambiguous instruction to run it. Reuse the existing rule-id validation so a typo in lint.suppress is reported the way a typo in --ignore is.

Malformed-config exit code is 3, not 2, per the lint exit-code table established in sl-1u6r (2 now means "lint errors found"; 3 means "lint could not run").

## Acceptance Criteria

Config loads from default path ./satsuma.config.yaml and from a --config override; lint.suppress removes a rule from output; --select on a config-suppressed rule still runs it; --ignore and lint.suppress union correctly; alias groups and strict flag parse into typed config; an invalid rule id in lint.suppress is reported like an invalid --ignore id; missing file yields defaults silently; malformed file exits 3 with an actionable message; unknown top-level keys warn; core and CLI tests pass locally; npm audit clean.

