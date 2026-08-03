---
id: sqdsp-00kv
status: open
deps: []
links: []
created: 2026-08-03T06:09:18Z
type: task
priority: 3
assignee: Thorben Louw
parent: sl-j6g9
tags: [feature-38, lint, validate, core]
---
# lint: warn when a fragment spread redeclares an explicitly declared field

sl-qead settled the semantics: a spread contributes only the names the body has not already declared, and an explicit declaration shadows the fragment's field of the same name. That is now the rule in docs/developer/SATSUMA-V2-SPEC.md §5.1 ("Redeclaring a spread field").

The author gets no signal that it happened. A redeclaration is legal but rarely deliberate — a reader has to know the fragment's contents to see that `...meta` adds less than it appears to, and the shadowed field silently loses whatever the fragment said about its type, constraints and note.

satsuma validate reports nothing here today.

## Design

A warning-severity diagnostic, raised where the shadowing decision is made — core's expandEntityFields knows the colliding name and the fragment it came from, but it returns fields rather than diagnostics, so the reporting site needs choosing (validate's field-alignment pass is the natural home).

Message should name both sides, e.g. `field 'load_ts' is declared here and also by fragment 'meta'; the fragment's copy is ignored`.

The shipped corpus relies on the permissive reading and would warn on day one: examples/namespaces/ns-platform.stm (vault::sat_contact_details declares load_ts at line 85 and spreads ...standard_metadata) and tooling/satsuma-cli/test/fixtures/platform.stm. Decide whether to clean those up in the same change or accept the warnings — a sweep found no other cases.

Warning, not error: the ruling on sl-qead was explicitly that redeclaration stays legal.

## Acceptance Criteria

A schema that declares a field and spreads a fragment declaring the same name produces one warning-severity diagnostic naming the field and the fragment. The LSP surfaces it on the redeclaring line. Nothing is reported when the names do not collide. Corpus files that warn are either cleaned up or listed in the ticket notes as accepted. Coverage counts are unchanged — sl-qead already fixed those.

