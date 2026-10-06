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

Adopt the existing `fieldEndpointSchema` / `fieldEndpointPath` helpers (tooling/satsuma-core/src/reference-stages.ts, exported from core's index) at the four remaining copies; no new helper is needed:

- tooling/satsuma-core/src/validate.ts (~line 540): replace only the structural fallback branch. The longest-existing-prefix loop ahead of it stays, because swapping it would change `nl-ref-not-in-source`, which Feature 46 R2's generated properties watch.
- tooling/satsuma-cli/src/lint-engine.ts (~line 126, `hidden-source-in-nl`).
- tooling/satsuma-cli/test/generated-edge-invariants.test.ts (~line 109) and generated-inverse-relations.test.ts (~line 222).

coverage-rollup.ts is not a copy and is left alone. Before adopting at either production site, establish that `resolution.resolvedTo.name` survives `createCanonicalFieldEndpoint`; a bare `s0.field_0` must not turn a silent wrong answer into a thrown TypeError. scenario-gen's copy stays independent and gains a comment saying why. A test covers the namespaced case the naive first-dot split gets wrong.


## Notes

**2026-08-06T19:02:06Z**

**2026-08-06** — findings note from Feature 46's closing sweep, not a closing note. Four things this ticket gets wrong, each of which changes the work.

**1. The helper already exists, and is already exported.** `fieldEndpointSchema(endpoint)` and `fieldEndpointPath(endpoint)` live in `tooling/satsuma-core/src/reference-stages.ts` beside `fieldEndpointOf`, both exported from core's index, and `fieldEndpointSchema`'s own doc-comment says it "replaces splitting an endpoint string on its first dot at each consumer (`sl-jyee`)". Its private `endpointPathStart` implements exactly the after-the-`::` rule this ticket describes. So the work is *adopt the helper at four call sites*, not *write one*.

**2. There is a fifth copy the ticket does not list**: `tooling/satsuma-cli/src/lint-engine.ts:126`, in the `hidden-source-in-nl` rule. Purely structural, and the closest match to the helper.

**3. `coverage-rollup.ts` is not one of the copies.** The line the ticket cites is `namespaceOf`, which splits a schema id at `::` — a different question. The nearby dot-walking loop enumerates every ancestor path, also different. Nothing in that file needs this helper.

**4. The two production copies do not agree with each other, so this is not a pure refactor.** `validate.ts`'s tries the *longest* prefix that exists in `index.schemas` first and falls back to the structural split; `lint-engine.ts`'s always takes the first dot after `::`. Replacing the first wholesale would change `nl-ref-not-in-source` behaviour, which Feature 46 R2's generated properties now watch — so only its fallback branch may be swapped, and the existence-based loop has to stay ahead of it.

**One further hazard.** The helper takes a *branded* `CanonicalFieldEndpoint`, so a caller holding a plain string must go through `createCanonicalFieldEndpoint`, which validates. Both production sites pass `resolution.resolvedTo.name`, whose canonicality is not established at that point — a bare `s0.field_0` with no `::` may not survive `canonicalNameOf`. Check that before adopting, or the refactor turns a silent wrong answer into a thrown TypeError. The two CLI *test* copies are safe: graph endpoints are canonical (`::s0.field_0`).

Left open deliberately at the end of Feature 46 rather than rushed: it is not a child of the epic and does not block it.

**2026-10-06T09:01:33Z**

Acceptance criteria rewritten in the 2026-10-06 ticket audit to match the 2026-08-06 findings note: adopt the existing helper at four sites rather than write a new one. The original description above is kept as history.
