---
id: bsw-wvvv
status: open
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: task
priority: 3
assignee: Thorben Louw
tags: [bug-sweep-2026-10, spec, adr-053]
---
# spec: which source does $. mean inside each in a multi-source mapping?

In `mapping { source { a, b } ... each b.items -> rows { $.id -> .x } }`, `$.id` resolves to bare `id`: `field-lineage` attributes it to `a.id` (the first source), while coverage marks both `a.id` and `b.id` covered. `^.id` resolves to `b.id`, and the gh-525 hint suggests `$.b.id`. Neither the spec nor ADR-053 says which root `$.` names when there are several sources.

## Acceptance Criteria

- Decide the rule (the each's own source root, ambiguity error, or require `$.b.id`), record it in the spec / ADR-053 follow-up, and file the implementation ticket.
