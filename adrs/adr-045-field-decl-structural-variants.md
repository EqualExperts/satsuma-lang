# ADR-045 — FieldDecl Uses JSON-Compatible Structural Variants

**Status:** Accepted
**Date:** 2026-08-03 (cbdr-hqhh, feature 39 R8)

## Context

`FieldDecl` is the shared representation of a schema or fragment field after
tree-sitter extraction. It crosses every internal tooling boundary: core emits
it, the CLI and LSP index it, viz-backend adapts it, and coverage and spread
expansion recurse through it. The grammar permits four shapes — scalar, record,
scalar list, and record list — but `tooling/satsuma-core/src/types.ts` represented
all four as one interface whose `children`, `isList`, `hasSpreads`, and `spreads`
properties were optional.

That optional-property bag admitted states the grammar cannot produce. A scalar
could carry record children or spreads, and `list_of record` could omit its
children. Consumer code then inferred the intended shape independently from a
mixture of `type`, `isList`, and `children`, so TypeScript could neither reject
an invalid construction nor prove a four-way branch exhaustive. The weakness was
at the core boundary described by ADR-020: downstream consumers shared the type,
but not an enforceable definition of its valid states.

Three representations were considered. Keeping one interface and adding
documentation would preserve the invalid states. Adding a required `kind`
discriminator would create a conventional discriminated union, but it would also
change the runtime objects and every JSON, LSP, and VizModel payload that carries
their existing shape. A structural union over the existing properties preserves
those payloads while making the grammar's four variants explicit, at the cost of
requiring a classifier where code needs a transient discriminator.

## Decision

`FieldDecl` is a union of `ScalarFieldDecl`, `RecordFieldDecl`,
`ScalarListFieldDecl`, and `RecordListFieldDecl`. Record-bearing variants use
`type: "record"` and require `children`; list variants require `isList: true`;
scalar variants prohibit `children`, `hasSpreads`, and `spreads` with `never`.
`ScalarTypeExpression` is a runtime-erased branded string constructed through
`createScalarTypeExpression`, which prevents the reserved `record` keyword from
being used to manufacture a scalar variant without changing its serialized
value.

The union deliberately adds no serialized discriminator. Existing `type`,
`isList`, and `children` properties remain the runtime contract.
`classifyFieldDecl()` in `tooling/satsuma-core/src/field-decl.ts` converts the
structural union into a transient discriminated wrapper when a consumer needs an
exhaustive four-way switch, and shared helpers in that module own normalization
to and from rendered type strings. Exhaustive switches terminate through core's
`assertNever()` helper.

Core extraction constructs only the four public variants. Values entering from
consumer or protocol models pass through `fieldDeclFromRenderedType()` instead
of duplicating shape inference. Compile-only tests prove illegal constructions
are rejected, and runtime tests prove exact JSON output is unchanged. This
extends ADR-020's core-as-single-truth boundary; it does not alter the authored
form or reference-stage decisions in ADR-039 and ADR-044.

## Consequences

**Positive:**

- Invalid combinations of scalar, record, list, child, and spread state fail at
  compile time rather than reaching coverage or workspace indexing.
- Consumers share one normalization and classification rule in core, so adding
  or changing a field variant has one implementation boundary.
- Existing CLI JSON, LSP data, and VizModel payloads remain byte-compatible
  because the safety contract is erased at runtime.
- Exhaustive four-way handling is explicit and testable without storing a
  discriminator in every field object.

**Negative:**

- Boundary adapters must call core constructors and normalizers instead of
  assigning arbitrary strings directly to `FieldDecl.type`.
- Structural narrowing is less direct than switching on a stored `kind`, so
  exhaustive consumers need the transient `classifyFieldDecl()` wrapper.
- `ScalarTypeExpression` and the union are TypeScript guarantees only; JavaScript
  callers and deliberately unsafe assertions can bypass them.
- Adding a fifth grammar-level field shape requires coordinated updates to the
  union, classifier, normalization helpers, and compile-only exhaustiveness
  tests.
