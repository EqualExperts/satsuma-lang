---
id: gpt-ek0e
status: open
deps: []
links: []
created: 2026-08-06T15:21:52Z
type: task
priority: 3
assignee: Thorben Louw
tags: [core, refactor]
---
# core: export the owning-schema split for a canonical field endpoint

Splitting a canonical endpoint (`[ns]::schema.path`) into its owning schema and its schema-local path is implemented four times: tooling/satsuma-core/src/validate.ts:532, tooling/satsuma-core/src/coverage-rollup.ts:522, and privately in two CLI test files (tooling/satsuma-cli/test/generated-edge-invariants.test.ts:106 and tooling/satsuma-cli/test/generated-inverse-relations.test.ts:224). A fifth copy exists in @satsuma/scenario-gen's scenarioSchemaProjection, which must stay separate — that package may not depend on core, and its copy being independent is what makes it an oracle.

The rule is not trivial to get right: the split is at the first '.' AFTER the '::' separator, not the first '.' in the string, which is wrong for a namespaced key. Four hand-maintained copies of one parsing rule is the duplication CLAUDE.md's core-vs-consumer section exists to prevent.

Raised by Feature 46 R6's review (gpt-clpj).

## Acceptance Criteria

One exported helper in @satsuma/core next to resolveFieldEndpoint, taking a CanonicalFieldEndpoint and returning its owning CanonicalEntityRef (and, if callers need it, the schema-local path). The two production call sites and the two CLI test copies use it. scenario-gen's copy is left alone and gains a comment saying why it must stay independent. A test covers the namespaced case that the naive first-dot split gets wrong.

