---
id: gpt-o0fk
status: closed
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


## Notes

**2026-08-06T15:31:00Z**

**2026-08-06T00:00:00Z**

Cause: nothing pinned the CLI's lint registry. `lint-command.test.ts`'s `--rules` case asserted only that two named ids appear in the printed list, not that the printed list *is* the registry, and nothing checked it against `SATSUMA-CLI.md`'s rule table. Two of the six rules are registered through core's `TYPE_MISMATCH_RULE_ID` and `LINEAGE_CYCLE_RULE_ID` constants rather than as literal strings, so auditing `RULES` by eye misses them.
Fix: added a lint-registry suite to `test/docs.test.ts` (the established sl-w1dr docs-drift pattern) with two cases — `lint --rules` prints exactly the engine's `RULES`, and that set equals the documented table's, in both directions. Rule ids come from the table rather than a hardcoded list, so adding a rule needs no test edit. (commit immediately after 40c100c1)

Both parsers were proved to see real data rather than trusted: `lint --rules` through the test's own regex yields all six ids, and the table at SATSUMA-CLI.md:120-127 yields the same six, so neither side can be silently empty. Case 2 also gained its own sanity floors, because it was the only case in the file relying on a *different* case to notice a broken parser — if both parsers matched nothing, both direction checks would compare `[]` to `[]` and pass.

The docs table already agreed with reality, so no documentation fix was needed. Verified rather than assumed: both core-detected rules are `warning` and `fixable: false` at `lint-type-mismatch.ts:199` and `lint-lineage-cycle.ts:398`.

Also removed: `lint-command.test.ts`'s "lists both structural rules in --rules" case. It is now strictly weaker than the new set equality — two `assert.match` calls versus equality in both directions — and unlike the new case it could not fail when a rule was registered and left undocumented. Keeping a weaker duplicate of a stronger check is what the no-redundant-tests rule is about; the two constant-registered rules stay pinned via their rows in the table. CLI count 1084 -> 1083.

Not a core concern, checked: core's `unknownRuleIds` takes `knownRuleIds` as a parameter rather than holding a second list, and the LSP has no rule registry, so `RULES` is the single registry and the guard belongs in the CLI's own test tree.

Two limits, filed as `gpt-mcw4`:

- A **third** hand-maintained listing survives. `addHelpText("after", ...)` at `src/commands/lint.ts:149-155` prints all six ids with their severities on `satsuma lint --help`, unchecked — the same drift class this ticket exists to close. Rule descriptions are a third variant of the same problem (three different prose spellings of one rule).
- The ticket's "include each rule's severity or default-enabled state" is unsatisfiable as written: `LintRule` is `{ id, description, check }` and severity lives as a literal inside each check function, so pinning the table's Severity column to the registry needs a production change. Only the id sets are compared, which is what the ticket's own "makes the registry auditable, nothing more" scope allows.
