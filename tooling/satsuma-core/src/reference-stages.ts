/**
 * reference-stages.ts — Nominal stages for field paths and entity references.
 *
 * Owns the runtime-erased vocabulary that separates authored text from values
 * which have passed container qualification, schema localization, or workspace
 * canonicalization. It does not resolve schemas or decide coverage; callers
 * supply workspace identity and the coverage modules consume the resulting
 * stage types.
 */

// This symbol is deliberately module-private. Consumers can obtain branded
// values only from the validating constructors and semantic transitions below.
declare const referenceStage: unique symbol;

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
  const separator = value.indexOf("::");
  if (separator < 0 || value.slice(separator + 2).length === 0) {
    throw new TypeError("Canonical entity reference must have [namespace]::name form");
  }
  return validatedReference<CanonicalEntityRef>(value, "Canonical entity reference");
}

/**
 * Advance an authored field expression through container qualification.
 *
 * Child paths are relative to the enclosing `each`, `flatten`, or nested-arrow
 * path. Mapping-body paths have no container and retain their string value;
 * their distinct return type records that qualification has still occurred.
 */
export function qualifyContainerFieldRef(
  ref: AuthoredFieldRef,
  container: ContainerQualifiedFieldRef | null,
): ContainerQualifiedFieldRef {
  const qualified = container ? `${container}.${ref.replace(/^\./, "")}` : ref;
  return createContainerQualifiedFieldRef(qualified);
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
