---
id: nfl-8o6u
status: in_progress
deps: []
links: []
created: 2026-08-03T11:06:19Z
type: bug
priority: 1
assignee: Thorben Louw
---
# Fix nested field lineage through namespaced flatten targets

CLI graph and field-lineage drop the target namespace when an each/flatten child path is prefixed by the bare target schema name. Coverage remains correct, so the VS Code lineage panel can disagree with the viz coverage overlay. Add a canonical multi-file seabird example and lock cross-namespace nested lineage and coverage.

## Acceptance Criteria

A parser-valid multi-file namespaced seabird example demonstrates nested flatten/each and a two-hop lineage chain. satsuma coverage reports the expected leaf counts and paths. satsuma field-lineage and graph retain qualified schema names through both hops. Shared canonical-ref tests cover bare-schema-prefixed paths for namespaced schemas. Relevant core, CLI, viz-backend, LSP, viz, and VS Code tests pass.
