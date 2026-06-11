---
id: sl-hjx1
status: closed
deps: []
links: []
created: 2026-06-11T02:43:01Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, grammar]
---
# grammar: adjacent typeless fields silently merge into one field_decl

schema s { customer_id\\n email } parses CLEANLY as a single field_decl with field_name customer_id and type_expr email — newlines are extras and _scalar_field joins across lines. Spec 3.3 marks TYPE optional in the unified pattern NAME [TYPE] [(metadata)] [{body}], so a bare-name field list is spec-plausible; the failure mode is a wrong-but-clean tree. Related asymmetry: "customer { id STRING }" (NAME + body, no record keyword — implied legal by the same 3.3 pattern) is rejected with ERROR.

## Acceptance Criteria

Decide and enforce: either newline terminates a field (typeless fields parse as two decls) or typeless fields are invalid with a loud error; NAME+body asymmetry resolved; spec and corpus updated.


## Notes

**2026-06-11T22:49:32Z**

Cause: newlines are extras, so _scalar_field joined a bare field name and the next line's bare name into one clean field_decl (name + type across the newline). Spec 3.3's positional pattern gives no other separator.
Fix: type_expr replaced by a line-aware external token (INLINE_TYPE aliased to type_expr) that only matches on the field name's line; bare typeless fields and NAME {body} without 'record' are now loud errors. Decision and rules documented in spec 3.3 ('Line and omission rules'); corpus tests pin the three traps. (commit 9ac193d)
