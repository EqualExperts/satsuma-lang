/**
 * reference-stages.ts — Nominal stages for field paths and entity references.
 *
 * Owns the runtime-erased vocabulary that separates authored text from values
 * which have passed container qualification, schema localization, or workspace
 * canonicalization. It also owns the canonical endpoint spelling in both
 * directions — composing an endpoint from a schema and a path, and taking it
 * back apart — so no consumer has to re-derive an owning schema from a string.
 *
 * It does not resolve schemas or decide coverage: callers supply workspace
 * identity, `canonical-ref.ts` decides which schema an authored arrow token
 * belongs to, and the coverage modules consume the resulting stage types.
 */

// This symbol is deliberately module-private. Consumers can obtain branded
// values only from the validating constructors and semantic transitions below.
declare const referenceStage: unique symbol;

// ── Canonical spelling ───────────────────────────────────────────────────────
// The two separators that make up canonical identity. Named because this module
// both composes and decomposes that spelling, and a stray literal in either
// direction is a silent identity bug rather than a compile error.

/** Divides a namespace from an entity name. Empty namespace means global scope. */
export const NAMESPACE_SEPARATOR = "::";

/** Divides path segments inside one schema. */
export const PATH_SEPARATOR = ".";

/** A string whose semantic normalization stage is tracked by TypeScript. */
type ReferenceAt<Stage extends string> = string & { readonly [referenceStage]: Stage };

/** Field expression exactly as authored on an arrow. */
export type AuthoredFieldRef = ReferenceAt<"authored-field-ref">;

/** Field expression made absolute against all enclosing mapping containers. */
export type ContainerQualifiedFieldRef = ReferenceAt<"container-qualified-field-ref">;

/** Dotted path relative to one declared schema root. */
export type SchemaLocalPath = ReferenceAt<"schema-local-path">;

/** Entity reference exactly as authored in a source, target, or spread. */
export type AuthoredEntityRef = ReferenceAt<"authored-entity-ref">;

/** Unique workspace entity id, including `::` for the global namespace. */
export type CanonicalEntityRef = ReferenceAt<"canonical-entity-ref">;

/**
 * Unique workspace identity of one arrow endpoint: a {@link CanonicalEntityRef}
 * for the owning schema, optionally followed by a path into that schema's
 * fields (`crm::customers.address.city`).
 *
 * This is the last stage in the field family and the spelling `graph`,
 * `lineage` and `field-lineage` emit. It differs from
 * {@link ContainerQualifiedFieldRef} in naming its owning schema, and from
 * {@link SchemaLocalPath} in not being relative to anything.
 */
export type CanonicalFieldEndpoint = ReferenceAt<"canonical-field-endpoint">;

/**
 * Validate and brand one external string at a semantic boundary.
 *
 * Extraction removes backticks before values reach core models. Consequently,
 * punctuation, dots, namespace separators, and whitespace may all be literal
 * identifier content and cannot be rejected here. The one representation that
 * no valid Satsuma name or path can produce is the empty string.
 *
 * This is the module's sole unsafe assertion. Brands have no runtime
 * representation, so after validation TypeScript must be told that the plain
 * string carries the stage tracked by the return type.
 */
function validatedReference<Reference extends string>(value: string, stageName: string): Reference {
  if (value.length === 0) {
    throw new TypeError(`${stageName} must not be empty`);
  }
  return value as Reference;
}

/** Validate a field expression entering the typed domain from authored data. */
export function createAuthoredFieldRef(value: string): AuthoredFieldRef {
  return validatedReference<AuthoredFieldRef>(value, "Authored field reference");
}

/** Validate an already container-qualified field expression at a boundary. */
export function createContainerQualifiedFieldRef(value: string): ContainerQualifiedFieldRef {
  return validatedReference<ContainerQualifiedFieldRef>(
    value,
    "Container-qualified field reference",
  );
}

/** Validate a dotted path known to be relative to one schema. */
export function createSchemaLocalPath(value: string): SchemaLocalPath {
  return validatedReference<SchemaLocalPath>(value, "Schema-local path");
}

/** Validate an entity name entering the typed domain from authored data. */
export function createAuthoredEntityRef(value: string): AuthoredEntityRef {
  return validatedReference<AuthoredEntityRef>(value, "Authored entity reference");
}

/**
 * Validate a unique workspace entity id.
 *
 * Canonical ids always include the namespace separator. A global entity uses
 * an empty namespace (`::customers`); a namespaced one uses its declared
 * namespace (`crm::customers`).
 */
export function createCanonicalEntityRef(value: string): CanonicalEntityRef {
  if (canonicalNameOf(value).length === 0) {
    throw new TypeError("Canonical entity reference must have [namespace]::name form");
  }
  return validatedReference<CanonicalEntityRef>(value, "Canonical entity reference");
}

/**
 * The entity-name portion of a canonical spelling, or the empty string when the
 * value has no namespace separator at all.
 *
 * Shared by the entity and endpoint constructors so both agree on what makes a
 * canonical value well-formed. For an endpoint the result still carries the
 * field path; callers that need the name alone stop at the first
 * {@link PATH_SEPARATOR}.
 */
function canonicalNameOf(value: string): string {
  const separator = value.indexOf(NAMESPACE_SEPARATOR);
  if (separator < 0) return "";
  return value.slice(separator + NAMESPACE_SEPARATOR.length);
}

// ── Field endpoints ──────────────────────────────────────────────────────────

/**
 * Validate a canonical field endpoint arriving from a serialized boundary.
 *
 * Endpoints travel as plain strings in JSON, VizModel and LSP payloads, so a
 * consumer that needs the typed form re-enters the domain here rather than
 * asserting. The shape rule is the entity rule plus one relaxation: a path may
 * follow the schema name, and may also be absent — an endpoint is allowed to
 * name a schema root.
 */
export function createCanonicalFieldEndpoint(value: string): CanonicalFieldEndpoint {
  const name = canonicalNameOf(value);
  if (name.length === 0 || name.startsWith(PATH_SEPARATOR)) {
    throw new TypeError("Canonical field endpoint must have [namespace]::schema[.path] form");
  }
  return validatedReference<CanonicalFieldEndpoint>(value, "Canonical field endpoint");
}

/**
 * Compose the endpoint identity of one field within one schema.
 *
 * Passing `null` for the path yields the schema root, which is a legal endpoint
 * spelling; whether any *authored* form should resolve to it is a separate and
 * still-open question (`r0-7w76`).
 */
export function fieldEndpointOf(
  schema: CanonicalEntityRef,
  path: SchemaLocalPath | null,
): CanonicalFieldEndpoint {
  const spelling = path === null ? schema : `${schema}${PATH_SEPARATOR}${path}`;
  return createCanonicalFieldEndpoint(spelling);
}

/**
 * The schema that owns an endpoint.
 *
 * This is the named accessor that replaces splitting an endpoint string on its
 * first dot at each consumer (`sl-jyee`). Decomposition lives beside
 * {@link fieldEndpointOf} so one module owns the spelling in both directions.
 */
export function fieldEndpointSchema(endpoint: CanonicalFieldEndpoint): CanonicalEntityRef {
  const pathStart = endpointPathStart(endpoint);
  return createCanonicalEntityRef(pathStart < 0 ? endpoint : endpoint.slice(0, pathStart));
}

/** The endpoint's path within its owning schema, or null when it names the root. */
export function fieldEndpointPath(endpoint: CanonicalFieldEndpoint): SchemaLocalPath | null {
  const pathStart = endpointPathStart(endpoint);
  if (pathStart < 0) return null;
  return createSchemaLocalPath(endpoint.slice(pathStart + PATH_SEPARATOR.length));
}

/**
 * Offset of the separator between an endpoint's schema and its path, or -1.
 *
 * The search starts after the namespace separator so that a namespace can never
 * be mistaken for the start of a field path.
 */
function endpointPathStart(endpoint: CanonicalFieldEndpoint): number {
  const separator = endpoint.indexOf(NAMESPACE_SEPARATOR);
  return endpoint.indexOf(PATH_SEPARATOR, separator + NAMESPACE_SEPARATOR.length);
}

// ── Container-relative path resolution (ADR-053) ─────────────────────────────
//
// The three path-prefix semantics an authored arrow path can carry, in one
// place. Every consumer that qualifies a nested arrow calls this — extraction's
// `qualifyChildArrowPath`, NL-ref target qualification, and the branded
// transition below — so the rule cannot drift across the four consumers
// (extraction, coverage, lineage, viz) that rely on it.

/** Root escape prefix: resolve absolute from the schema root, container ignored. */
const ROOT_ESCAPE = "$.";
/** Parent escape prefix: one occurrence pops one segment off the container. */
const PARENT_ESCAPE = "^.";

/** Strip the authored leading-dot relativity marker (spec §4.4). */
function stripRelativityMarker(path: string): string {
  return path.replace(/^\./, "");
}

/**
 * Resolve an authored arrow path against the container it was written inside.
 *
 * Applies the three path-prefix semantics from ADR-053, in order:
 *
 *  - `$.field`  — root escape: enclosing containers are ignored; the path is
 *    taken absolute from the schema root.
 *  - `^.field`  — parent escape: each `^.` pops one segment off the container
 *    path before the field is appended. `^.^.field` pops two; popping past the
 *    root resolves root-relative.
 *  - `.field` or `field` — the original prefixing rule: the container path is
 *    prefixed and the leading relativity dot is stripped.
 *
 * The escapes are additive: a path either carries one or it does not, and they
 * never interact with the relativity marker, so the existing dot semantics are
 * untouched.
 *
 * @param path      Path as authored, with or without an escape / relativity
 *                  marker. An empty path stays empty.
 * @param container Absolute path of the enclosing container, or null at
 *                  mapping-body level, where the mapping root is the frame.
 * @returns The path relative to the schema root, never carrying an escape or
 *          relativity marker.
 */
export function resolveAuthoredPathAgainstContainer(
  path: string,
  container: string | null,
): string {
  if (!path) return path;

  // Root escape — absolute from the schema root; the container is irrelevant.
  if (path.startsWith(ROOT_ESCAPE)) {
    return stripRelativityMarker(path.slice(ROOT_ESCAPE.length));
  }

  // Parent escape — pop one container segment per `^.`.
  if (path.startsWith(PARENT_ESCAPE)) {
    let rest = path;
    let levels = 0;
    while (rest.startsWith(PARENT_ESCAPE)) {
      levels += 1;
      rest = rest.slice(PARENT_ESCAPE.length);
    }
    const relative = stripRelativityMarker(rest);
    if (!container) return relative;
    const segments = container.split(".");
    const popped = segments.slice(0, Math.max(0, segments.length - levels));
    return popped.length ? `${popped.join(".")}.${relative}` : relative;
  }

  // Default — the original prefixing rule, relativity marker stripped.
  const relativeToFrame = stripRelativityMarker(path);
  return container ? `${container}.${relativeToFrame}` : relativeToFrame;
}

/**
 * Advance an authored field expression through container qualification.
 *
 * Child paths are relative to the enclosing `each`, `flatten`, or nested-arrow
 * path, and may carry an ADR-053 escape prefix (`^.` / `$.`). Mapping-body
 * paths have no container and retain their string value; their distinct return
 * type records that qualification has still occurred.
 */
export function qualifyContainerFieldRef(
  ref: AuthoredFieldRef,
  container: ContainerQualifiedFieldRef | null,
): ContainerQualifiedFieldRef {
  return createContainerQualifiedFieldRef(resolveAuthoredPathAgainstContainer(ref, container));
}

/**
 * Resolve an authored entity name to the canonical id present in a workspace.
 *
 * Resolution order mirrors Satsuma's namespace binding rule: an explicitly
 * qualified name, then the current namespace, then the global namespace. Maps
 * store global entities under their bare key, but the returned identity keeps
 * the canonical leading `::` so it cannot collide with authored bare text.
 */
export function canonicalizeEntityRef(
  ref: AuthoredEntityRef,
  currentNamespace: string | null,
  entities: ReadonlyMap<string, unknown>,
): CanonicalEntityRef | null {
  if (ref.includes("::")) {
    const lookupKey = ref.startsWith("::") ? ref.slice(2) : ref;
    if (!entities.has(lookupKey)) return null;
    return createCanonicalEntityRef(ref.startsWith("::") ? ref : `${ref}`);
  }

  if (currentNamespace) {
    const namespacedKey = `${currentNamespace}::${ref}`;
    if (entities.has(namespacedKey)) return createCanonicalEntityRef(namespacedKey);
  }

  if (entities.has(ref)) return createCanonicalEntityRef(`::${ref}`);
  return null;
}
