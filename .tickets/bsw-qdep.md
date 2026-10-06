---
id: bsw-qdep
status: open
deps: []
links: [bsw-iuzs]
created: 2026-10-06T17:50:48Z
type: task
priority: 3
assignee: Thorben Louw
tags: [bug-sweep-2026-10, lint, namespaces]
---
# lint: warn on the deprecated whole-name quoting `ns::name` in backticks

bsw-iuzs made `` ns::`name` `` (quote only the name after `::`) the documented form for a namespaced name that needs quoting, and marked the older form, backticks around the whole qualified name (`` `raw::crm_contacts` ``), as deprecated. The deprecated form still parses (it is a single `backtick_name`) and still resolves, because consumers split its text on `::`. Nothing tells an author to move off it.

Add a diagnostic, most likely a `satsuma lint` rule with a fix, that flags a `backtick_name` whose unquoted text contains `::` with a bare-identifier namespace before it, in imports, `source`/`target` entries, spreads and metadata values. The fix rewrites it to `ns::name`, or `` ns::`name` `` when the name side needs quoting.

Test fixtures that deliberately keep the deprecated form, so its continued support stays covered: tooling/satsuma-cli/test/fixtures/namespaces.stm, import-entry.stm, import-chain-entry.stm, and two cases in tooling/tree-sitter-satsuma/test/corpus/namespaces.txt.

## Acceptance Criteria

- A lint rule (or validate warning, if the user prefers) reports each deprecated whole-name quoting, with a fix producing the `ns::name` / `` ns::`name` `` form.
- A schema or field whose name genuinely contains `::` inside backticks in a position that is not a qualified-name reference is not flagged.
- Spec §2.2 says when the deprecated form will stop being accepted, if the user decides on a removal date.
