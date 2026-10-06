---
id: bsw-y65l
status: open
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-sweep-2026-10, lsp, completion, adr-053]
---
# lsp: completion inside each/flatten offers the schema's top-level fields, not the container's

After `.`, `^.` or `$.` inside `flatten transects.sightings`, completion offers `survey_id`, `tr ref`, `transects`, the schema's top level. Accepting `.survey_id` then produces `field-not-in-schema`. `tooling/satsuma-lsp/src/completion.ts` has no container awareness.

## Acceptance Criteria

- `.` offers the container's fields, `^.` the parent container's, `$.` the root's; tests for each.
