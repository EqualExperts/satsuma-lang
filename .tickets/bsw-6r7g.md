---
id: bsw-6r7g
status: open
deps: []
links: [bsw-pv7a, bsw-h3qg]
created: 2026-10-06T20:07:50Z
type: task
priority: 3
assignee: Thorben Louw
tags: [bug-sweep-2026-10, lsp]
---
# lsp: actionContext still splits and strips resolved paths by hand

bsw-pv7a moved `satsuma/actionContext` onto core's container resolution, but the steps after it still munge text. In `tooling/satsuma-lsp/src/action-context.ts`, `inferSchemaFromPath` takes `fullPath.split(".")[0]` as the schema, and `stripPathDecorators` deletes every backtick. A schema or field whose backtick name contains a dot (`` `a.b` ``) therefore yields an ambiguous or wrong `fieldPath`, which feeds VS Code's "Trace field lineage".

## Acceptance Criteria

- actionContext derives the schema and field path from segments (core's `resolveFieldEndpoint` / `arrowPathParts`), not by splitting or stripping joined text; `stripPathDecorators` is gone.
- A test with a backtick field name containing a dot, inside an `each`, returns the correct schema and field path.
