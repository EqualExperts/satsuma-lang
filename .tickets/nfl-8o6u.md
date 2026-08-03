---
id: nfl-8o6u
status: closed
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

## Notes

**2026-08-03T11:18:02Z**

Cause: Nested container extraction prefixes child targets with the authored bare schema name, but qualifyField treated that as fully qualified and discarded the mapping endpoint namespace; validation likewise recognized only canonical namespaced keys as schema-root targets.
Fix: Restored the namespace from the resolved mapping endpoint for bare-schema-prefixed paths, accepted bare namespaced schema roots in validation, and added the multi-file seabird regression example and cross-consumer tests. (commit 7944ce71)
