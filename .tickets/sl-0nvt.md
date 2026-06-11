---
id: sl-0nvt
status: open
deps: []
links: []
created: 2026-06-11T02:43:01Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-hunt, grammar]
---
# grammar: inconsistent trailing-comma policy; zero-width MISSING nodes trap downstream consumers

Trailing commas accepted in metadata_block, enum, slice, and map literals but not import/target ("target { t, }" -> ERROR; "source { s, }" is fine). Recovery shapes are traps: "import { a, b, } from x" and "import { } from x" produce a zero-width import_name containing MISSING identifier; "source { }" produces a zero-width source_ref — downstream consumers reading .text without checking MISSING get empty-string names.

## Acceptance Criteria

Comma policy consistent across list constructs (documented in spec); no zero-width named nodes in recovery for these cases, or core extraction guards against MISSING; corpus tests.

