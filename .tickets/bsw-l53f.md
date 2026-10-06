---
id: bsw-l53f
status: open
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-sweep-2026-10, vscode, textmate, adr-053]
---
# vscode: TextMate grammar does not scope the ^ and $ path prefixes

Tokenising `^.id -> order_ref` with vscode-textmate gives `^` only `meta.arrow-body.satsuma`; `.id` is `variable.other.field`. Same for `$`. The prefix is uncoloured until semantic tokens arrive. `syntaxes/satsuma.tmLanguage.json` has no rule for them and no golden test covers them; `highlights.scm` does.

## Acceptance Criteria

- `^.` (repeated) and `$.` get the same scope as the path they prefix; TextMate golden test added.
