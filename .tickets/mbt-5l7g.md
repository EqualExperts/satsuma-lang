---
id: mbt-5l7g
status: open
deps: []
links: []
created: 2026-08-04T11:08:06Z
type: epic
priority: 2
assignee: Thorben Louw
---
# Feature 42: npm workspaces + Turborepo build orchestration

Cut CI wall-clock time and local full-suite execution time by consolidating the 10 tooling/* packages onto npm workspaces (single lockfile, hoisted deps) and layering Turborepo on top for dependency-graph build ordering and local content-hash caching. See features/42-monorepo-build-tooling/PRD.md and ADR-049.

