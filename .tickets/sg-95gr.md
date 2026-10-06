---
id: sg-95gr
status: closed
deps: []
links: []
created: 2026-03-20T12:48:16Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [cli, docs, ux, nl, meta]
---
# Documented nl/meta field syntax does not match the implemented CLI contract

The published command examples for field-scoped nl and meta use a two-token form such as 'satsuma nl field mart_customer_360.email' and 'satsuma meta field loyalty_sfdc.Email'. The implementation only accepts a single <scope> token, so those documented invocations treat the field reference as the path argument and fail with ENOENT. This is a user-facing contract bug because the top-level docs and AI-AGENT-REFERENCE both advertise commands that do not run as written.

## Acceptance Criteria

1. Either the CLI accepts the documented two-token field form for nl/meta, or all published examples and help text are updated to the actual accepted syntax.
2. Running the documented field-scope examples from the docs no longer fails with path-resolution errors.
3. Add a smoke or integration test that exercises the supported field-scope invocation shown in the user-facing docs.

