---
id: cbdr-e6ft
status: closed
deps: [sl-46wr, sl-csrs]
links: []
created: 2026-08-03T16:26:40Z
type: task
priority: 1
assignee: Thorben Louw
parent: gcsc-qka8
tags: [feature-39, r5, core, types]
---
# core: define opaque path and entity-reference stages

Introduce the runtime-erased core vocabulary for authored field refs, container-qualified field refs, schema-local paths, authored entity refs, and canonical entity refs. Add validating public constructors and the named semantic transitions for container qualification and workspace-aware entity canonicalization, with the brand key private to the module.

## Design

Keep the underlying representation as string so public JSON and protocol shapes do not change. Constructors reject empty or structurally invalid stage values; transitions are the only place that advances a value between stages. The sole type assertion belongs in the module-private validated representation boundary and is documented. Preserve existing string-returning helpers until the dependent migration ticket tightens their signatures.

## Acceptance Criteria

All five opaque types and their validating constructors are exported from @satsuma/core; container qualification accepts AuthoredFieldRef and returns ContainerQualifiedFieldRef; entity canonicalization accepts AuthoredEntityRef and returns CanonicalEntityRef or null after namespace-aware lookup; global canonical ids retain the :: prefix; the brand symbol is not exported and no assertion appears outside the module; runtime tests cover valid, invalid, qualified, unqualified, and unresolved values; compile-only tests prove raw strings and wrong-stage values cannot cross the new transitions; npm --prefix tooling/satsuma-core test passes.


## Notes

**2026-08-03T16:30:01Z**

Cause: Authored refs, container-qualified refs, schema-local paths, and canonical entity ids were all represented as interchangeable strings, so TypeScript could not reject a transition at the wrong normalization stage. Fix: Added five opaque core reference types, validating constructors, and named container-qualification/entity-canonicalization transitions with runtime and compile-only coverage (commit immediately after bc967469).
