---
id: bsw-01mb
status: closed
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-sweep-2026-10, docs]
---
# EBNF field_path omits the ADR-053 ^. and $. prefixes in four docs

`field_path = ["."] [label "::"] segment {"." segment} ;` has no `^.` / `$.` alternatives, while each doc's own path cheat-sheet a few lines later lists them, and `grammar.js:377-384` defines `parent_path` / `root_path`. Locations: `reference/grammar.md:69` (source), `AI-AGENT-REFERENCE.md:69`, `skills/satsuma-language/SKILL.md:94`, `useful-prompts/excel-to-stm-prompt.md:65`.

## Acceptance Criteria

- All four EBNF copies include the parent (`^.`, repeatable) and root (`$.`) prefixes, matching grammar.js.

## Notes

**2026-10-06T10:08:33Z**

Cause: The EBNF field_path was not updated when ADR-053 added parent_path and root_path to grammar.js.
Fix: PR #611 added the ("^." {"^."} | "$.") alternative to all four copies (commit 4897076a).
