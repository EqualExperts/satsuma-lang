# ADR-044 — Opaque Reference Types Enforce Semantic Stage Order

**Status:** Accepted
**Date:** 2026-08-03 (cbdr-e6ft, cbdr-5r4d; feature 39 R5)

## Context

ADR-039 chose to preserve authored entity references in extracted models and to
resolve them only where workspace context is available. That decision made the
two representations explicit in prose: `customer` is authored text, while
`crm::customer` is a canonical workspace identity. Coverage has an analogous
sequence for fields: `city` as written inside a nested arrow, then
`home_address.city` after container qualification, then a path relative to one
schema after schema localization.

The implementation represented every stage as `string`. A function that needed
a schema-local path could therefore receive authored text, a container-qualified
path, or an entity name without TypeScript objecting. The same was true of
authored and canonical entity references. Correctness depended on call order and
reviewer memory rather than on the API contract.

That weakness was already implicated in the coverage defects which led to
feature 39. A path can be syntactically plausible at more than one stage:
`city` may be a correct top-level schema-local path, while the same text inside
`each home_address` still needs qualification. Runtime string validation cannot
distinguish those histories. The useful invariant is therefore not “this string
looks like a path”; it is “this value passed through the transition required at
this point in the algorithm.”

Adding stage-specific object wrappers would encode that invariant, but it would
also change every JSON, LSP, and VizModel payload and add allocation and
serialization work to values whose runtime representation is intentionally a
string. Conversely, leaving the distinction as documentation would preserve the
failure mode ADR-039 identified: two representations in flight with no type-level
enforcement.

## Decision

**Core defines opaque, runtime-erased string types for the semantic stages of
field paths and entity references.** The initial vocabulary is deliberately
narrow:

- `AuthoredFieldRef` — a field expression as written on an arrow;
- `ContainerQualifiedFieldRef` — that expression made absolute against its
  enclosing mapping containers;
- `SchemaLocalPath` — a dotted path relative to one declared schema root;
- `AuthoredEntityRef` — an entity reference as written in source, target, or
  spread syntax; and
- `CanonicalEntityRef` — a unique workspace identity, including `::` for the
  global namespace.

The shared representation is `string & { readonly [privateSymbol]: Stage }`.
The brand symbol remains private to `reference-stages.ts`, so consumers cannot
construct a staged value structurally. Public constructors validate strings at
external boundaries, and named core transitions advance values between stages.
The only unsafe assertion is inside the private constructor boundary, where it
documents the fact that TypeScript brands have no runtime representation.

**Construction and transition are separate concepts.** Constructors such as
`createAuthoredFieldRef` and `createCanonicalEntityRef` are for values entering
the typed domain from the CST, an existing model, or another protocol. They
validate the representation that can be known locally: references are non-empty,
and canonical entity ids have `[namespace]::name` form. Transitions such as
`qualifyContainerFieldRef`, `schemaLocalFieldPath`, and
`canonicalizeEntityRef` perform semantic work and expose that work in their
signatures. A consumer cannot pass an `AuthoredFieldRef` where a
`SchemaLocalPath` is required merely because both happen to contain `city`.

**The branded domain begins and ends at process and protocol boundaries.** CST
extraction, JSON, LSP, and VizModel contracts continue to carry strings.
Consumers must use a public constructor or transition when those strings enter
stage-sensitive core logic; they must not use casts to manufacture a brand.
Returning a branded value through a string protocol requires no conversion
because every stage remains assignable to `string`.

**Coverage APIs state the stage they consume.** Covered-path builders and probes
accept `SchemaLocalPath`, and schema localization returns
`SchemaLocalPath | null`. Entity resolution receives `AuthoredEntityRef` and
returns definitions whose identity is a `CanonicalEntityRef`. Intermediate arrow
models carry their current path stage rather than erasing it back to `string`.
This makes an omitted or reordered normalization step a compile error at the
point of use.

Compile-only tests are part of the contract. They prove that raw strings and
values from the wrong stage are rejected, while runtime tests cover boundary
validation and the actual normalization rules. Property and differential tests
remain necessary: a brand proves that a transition was called, not that its
algorithm produced the correct path.

Two broader alternatives were rejected. Branding every semantic string in core
would make the migration much larger without evidence that file URIs, namespace
ids, or natural-language text suffer the same cross-stage defects. The decision
therefore stops at reference normalization stages and treats this migration as
evidence for any future expansion. Encoding provenance in runtime wrapper
objects was also rejected because the invariant is internal to TypeScript and
does not justify breaking stable external payloads.

This **extends ADR-039**. Authored form is still preserved in models and
resolution still occurs at point of use; this ADR makes the stages surrounding
that resolution enforceable by the compiler. It does not supersede ADR-039.

## Consequences

**Positive:**

- Missing container qualification, schema localization, or entity
  canonicalization becomes a compile-time error at typed coverage boundaries.
- The API documents semantic order directly in its parameter and return types,
  so a reader can follow the normalization pipeline without reconstructing it
  from string operations.
- Core owns the transition rules once. CLI, LSP, viz-backend, and viz consumers
  call the same constructors and canonicalizer rather than duplicating casts or
  namespace lookup conventions.
- Existing JSON, LSP, and VizModel contracts remain byte-for-byte compatible;
  the safety has no runtime storage or serialization cost.
- The private brand and compile-only negative tests make accidental weakening
  visible. Adding `as SchemaLocalPath` in a consumer is recognizable as a breach
  of the architecture rather than an ordinary type conversion.

**Negative:**

- Boundary code is more explicit. Values coming from models and protocols need
  constructor calls even when the author already knows they are valid strings.
- The types provide stage safety, not proof of origin or semantic correctness.
  A faulty transition can still brand the wrong result, so runtime, property,
  and differential tests cannot be replaced by nominal typing.
- Brands are a TypeScript-only guarantee. JavaScript consumers and serialized
  payloads do not carry them, and any TypeScript consumer can deliberately evade
  the contract with an unsafe assertion.
- Public APIs which previously accepted arbitrary strings become source
  incompatible for TypeScript callers. Callers must identify the boundary or
  transition that establishes the required stage.
- The chosen vocabulary may need to grow if future defects reveal additional
  meaningful stages. Each addition should be justified by a real invariant,
  rather than turning every core string into a nominal type by default.
