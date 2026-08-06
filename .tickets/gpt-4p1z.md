---
id: gpt-4p1z
status: open
deps: []
links: []
created: 2026-08-06T15:21:07Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [cli, arrows, json]
---
# arrows --json prints prose and exits 1 when there are no matches, while find --json emits []

tooling/satsuma-cli/src/commands/arrows.ts:280-283 prints the human 'No arrows found' prose and exits EXIT_NOT_FOUND even under --json, so a caller parsing stdout as JSON gets a syntax error rather than an empty result. tooling/satsuma-cli/src/commands/find.ts:86-101 emits `[]` in the same situation, so the two commands disagree about what --json means for an empty answer.

Found by Feature 46 R6 (gpt-clpj). Its property currently depends on that prose to tell an empty answer apart from a resolution failure — 'Schema not found', 'Field not found in schema' and 'no arrows' all share EXIT_NOT_FOUND — so a fix must also update NO_ARROWS_PROSE at tooling/satsuma-cli/test/generated-inverse-relations.test.ts:155.

## Acceptance Criteria

arrows --json emits [] and the exit code choice is deliberate and documented, consistent with find --json. Decide explicitly whether an empty match keeps EXIT_NOT_FOUND or becomes 0, and state the reason — a caller distinguishing 'no arrows' from 'schema does not exist' needs SOME signal, so if the prose goes, that signal must be provided another way (a distinct exit code, or an error field in the JSON). The R6 property is updated to use it.

