---
id: sg-3xof
status: closed
deps: []
links: []
created: 2026-03-20T12:48:02Z
type: bug
priority: 1
assignee: Thorben Louw
parent: stm-7rz4
tags: [cli, nl, namespaces, field-resolution]
---
# satsuma nl field scope ignores schema qualifier when collecting mapping NL

satsuma nl <schema.field> validates the schema-qualified field reference, but when it scans mapping arrows it matches on the bare leaf field name only. In examples/ns-platform.stm, satsuma nl ecom::customers.email examples/ns-platform.stm returns NL from mart::build dim_contact about vault::sat_contact_details.email instead of only NL associated with ecom::customers.email. This makes field-scoped NL extraction unsafe in any workspace where multiple schemas share a field name such as email, id, or status.

## Acceptance Criteria

1. satsuma nl ecom::customers.email examples/ns-platform.stm does not return NL items attached only to vault::sat_contact_details.email or any other unrelated schema field with the same leaf name.
2. Field-scoped NL extraction uses the resolved schema-qualified field identity when matching mapping arrows, not just the leaf field token.
3. Existing field-scope behavior for unique field names continues to work.
4. Add regression coverage with at least two schemas that share the same field name and different NL-bearing arrows.

