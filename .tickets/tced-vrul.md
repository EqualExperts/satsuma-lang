---
id: tced-vrul
status: open
deps: []
links: [tced-ewd4]
created: 2026-08-07T11:35:16Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [scenario-gen, testing]
---
# scenario-gen: no generated container block writes a dotted header target, so the top-level each form is unreachable

`satsuma-scenario-gen` cannot render a container block whose *header* target carries the authored leading dot — `each parties -> .rows` at mapping-body level, or `each lines -> .items` nested. Every generated header goes through `authoredEndpoint` (`src/workspace-render.js:45`, called at `:105` and `:109` and composed into the header at `:123`), which emits `schema.path` or bare `path` and never a dot. Only *child* arrows inside a block get the dot, via `relativeEndpoint` (`:57`).

Both spellings are legal and mean the same thing (spec §4.6, line 473: "a leading `.` documents the relativity, but it does not decide it"), so the generator currently explores only half of a real authoring choice.

This is how tced-ewd4 escaped every property suite. `satsuma coverage` crashed outright on the top-level dotted form — `Unhandled error: Schema-local path must not be empty` — and the generated coverage oracle and inverse-relation sweeps could not produce an input that would have caught it. `examples/` has the same blind spot: it writes the dotted header only nested, never at mapping-body level.

Raised from tced-ewd4's acceptance criteria, which asked for this gap to be filed rather than left unstated.

## Acceptance Criteria

- A generated container block can render its header target either dotted or undotted, chosen by the arbitrary rather than fixed, at mapping-body level and nested.
- The choice is ground-truth-neutral: the two spellings resolve to the same field, so the scenario's stated ground truth must not change with it. A property asserting that the two renderings of one scenario produce identical downstream results is the natural way to pin it.
- The generated coverage oracle reaches the top-level dotted header, so a regression of tced-ewd4 would fail a property suite rather than only the targeted unit test.

