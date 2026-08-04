---
id: mbt-5l7g
status: closed
deps: []
links: []
created: 2026-08-04T11:08:06Z
type: epic
priority: 2
assignee: Thorben Louw
---
# Feature 42: npm workspaces + Turborepo build orchestration

Cut CI wall-clock time and local full-suite execution time by consolidating the 10 tooling/* packages onto npm workspaces (single lockfile, hoisted deps) and layering Turborepo on top for dependency-graph build ordering and local content-hash caching. See features/42-monorepo-build-tooling/PRD.md and ADR-049.


## Notes

**2026-08-04T20:35:02Z**

Feature delivered. All six rollout tickets closed; PRD moved to
archive/features/42-monorepo-build-tooling/ and Feature 42 recorded in ROADMAP's
Shipped table.

| Ticket | What landed | PR |
|---|---|---|
| mbt-foes (R1) | hoisting audit, install-order inventory, CI baseline | — |
| mbt-pumv (R2) | npm workspaces, one root lockfile, no `file:../X` specs | #478 |
| mbt-0f7t (R3) | extension packaging verified under hoisting | #478 |
| mbt-npy0 (R4) | turbo.json; build order derived from the manifests | #482 |
| mbt-45v2 (R5) | persisted content-hash cache, CI routed through turbo | #483 |
| mbt-i81o (R6) | fourteen docs corrected | #484 |

**Measured, all like-for-like main runs:** 4m35s (R1 baseline) -> 4m37s (R2/R3)
-> 4m18s (R4) -> **1m56s warm / 3m36s cold** (R5). 58% off the baseline. Twelve
lockfiles became one. The cross-package build order, previously written down in
three places that nothing kept in sync, is now derived from the dependency
declarations and written down nowhere.

Three bugs were found and fixed along the way that were not in scope and were not
hypothetical:

1. `@satsuma/lsp`'s test suite runs satsuma-cli's *built* entry point and nothing
   ordered that build. CI had been papering over it with a step named "Build
   satsuma-cli (needed by LSP formatting provider)".
2. `@satsuma/viz` and `@satsuma/viz-backend` read satsuma-cli's test fixtures
   without Turborepo hashing them — a changed parity fixture served a cache hit and
   a green run. Ordering and hashing are separate questions and I had only asked
   the first.
3. The hook's `check:cst-symbols` gate could no longer fail, because the workspace
   build regenerated the file the check then compared against fresh output.

Two guards now exist that did not before, both mutation-tested: every sibling whose
build output a package reaches must be declared, and every sibling committed file a
package reads must be hashed. Both live in
scripts/workspace-build-graph.test.mjs, which replaced a narrower guard asserting
the same property against the `prebuild` chains this feature deleted.

Follow-ups, none blocking, tracked independently of this epic: mbt-oy6n (the LSP's
bundle and tsc output share dist/server.js, which is why one turbo task is
uncached), mbt-14vo (detection forms the build-graph guard cannot see), mbt-1s1s
(pre-existing CI-WORKFLOWS drift about release.yml).
