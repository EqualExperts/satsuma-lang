---
id: gpt-o0fk
status: open
deps: []
links: [gpt-uazn, gpt-pwze]
created: 2026-08-06T13:54:33Z
type: task
priority: 3
assignee: Thorben Louw
tags: [feature-46, testing, lint, docs]
---
# cli: pin the registered lint rule set against the docs, like docs.test.ts does for commands

satsuma-cli/src/lint-engine.ts RULES mixes literal id strings with ids imported as constants (TYPE_MISMATCH_RULE_ID, LINEAGE_CYCLE_RULE_ID from core). The registry therefore cannot be read reliably by eye or by grep: while planning Feature 46 an audit for literal `id: "..."` strings found four rules and concluded the other two were exported from core but never registered. They were registered all along. The mistake was caught before a bug was filed, but only by reading the file line by line. Nothing in the suite would have contradicted it: lint-command.test.ts's --rules test asserts only that two named rules appear, not that the list is exactly the registered set.

## Design

Apply the sl-w1dr pattern that satsuma-cli/test/docs.test.ts already uses for commands ('documents every command the CLI registers') to lint rules. Two assertions: (a) the id set that `lint --rules` prints equals the id set in SATSUMA-CLI.md's rule table — both directions, so a rule registered but undocumented and a rule documented but dropped from the registry each fail; (b) the printed set equals RULES.map(r => r.id), so --rules cannot drift from the engine. Prefer extending docs.test.ts over a new file — the suite header already states this is the place living docs are checked. Whether to also require every rule id be declared as an exported constant is out of scope: this ticket makes the registry AUDITABLE, it does not restyle it.

## Acceptance Criteria

Removing a rule from RULES fails the test naming the documented-but-unregistered id. Adding a rule to RULES without a SATSUMA-CLI.md table row fails the test naming the registered-but-undocumented id. Both mutation checks run and recorded in the closing note. The test reads the rule table from SATSUMA-CLI.md rather than hardcoding the six ids, so adding a rule needs no test edit.

