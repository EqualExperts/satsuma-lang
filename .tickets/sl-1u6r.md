---
id: sl-1u6r
status: open
deps: [sl-npi6]
links: []
created: 2026-07-31T13:14:15Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-iffm
tags: [feature-37, cli]
---
# cli: lint exit-code escalation (strict mode)

PRD 37 open question 3, resolved YES (exit code) in user review: warnings remain advisory by default, but CI users can make lint exit non-zero on warnings via the strict flag in satsuma.config.yaml or a --strict CLI flag (flag wins over config).

## Design

Lint gets its own documented exit-code table (user decision, doc review 2026-07-31). lint already contradicts the CLI-wide table: commands/lint.ts:114 returns EXIT_PARSE_ERROR (2) when there are error-severity findings, where 2 is documented as "parse error or filesystem error" (SATSUMA-CLI.md:164-169). Adding strict mode on top would make 1 — documented as "not found / no results" — mean "warnings present", giving all three codes a third meaning. So pin the table down before strict mode ships, following the fmt precedent at SATSUMA-CLI.md:86:

  0  no findings, or warnings only without --strict
  1  warnings present and --strict active
  2  error-severity findings present
  3  parse or filesystem error (lint could not run)

This moves lint's "could not run" case off 2 and leaves 2 meaning "the workspace has lint errors" — the meaning it already has in practice. It is a breaking change for any CI job keying off lint's current codes, so it must be called out in CHANGELOG.md.

## Acceptance Criteria

Full exit-code matrix tested: clean 0; warnings without --strict 0; warnings with --strict 1; error findings 2; unparseable workspace 3; --strict flag overrides config strict false; suppressed rules do not trigger strict failure; lint exit-code table documented in command help and SATSUMA-CLI.md; the code change for error findings (2) and parse failures (3) called out in CHANGELOG.md as breaking for CI consumers; CLI tests pass locally.

