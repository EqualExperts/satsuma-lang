---
id: sl-hjx1
status: open
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

