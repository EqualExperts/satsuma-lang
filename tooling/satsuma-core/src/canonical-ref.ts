/**
 * canonical-ref.ts — Canonical field reference and entity resolution utilities
 *
 * Produces the canonical [ns]::schema.field form used across all CLI output.
 * When no namespace is present, the :: prefix is retained for unambiguous parsing.
 *
 * Also exports resolveScopedEntityRef, the standard namespace-aware lookup
 * used by the validator and other workspace traversal code.
 */

/**
 * Build a canonical reference string.
 *
 * | namespace | schema | field | result |
 * |-----------|--------|-------|--------|
 * | undefined | "s"    | "f"   | "::s.f" |
 * | "ns"      | "s"    | "f"   | "ns::s.f" |
 * | undefined | "s"    | undefined | "::s" |
 * | "ns"      | "s"    | undefined | "ns::s" |
 */
export function canonicalRef(
  namespace: string | null | undefined,
  schema: string,
  field?: string | null,
): string {
  const ns = namespace ?? "";
  const base = `${ns}::${schema}`;
  if (field) return `${base}.${field}`;
  return base;
}

/**
 * Canonical display name for an entity record with namespace and name fields.
 * Consolidates the repeated `canonicalKey(entity.namespace ? ...)` pattern.
 *
 *   canonicalEntityName({ namespace: "crm", name: "customers" })  → "crm::customers"
 *   canonicalEntityName({ name: "customers" })                     → "::customers"
 *   canonicalEntityName({ name: null })                            → "::"
 */
export function canonicalEntityName(entity: {
  namespace?: string | null;
  name: string | null;
}): string {
  return canonicalRef(entity.namespace, entity.name ?? "");
}

/**
 * Qualify a raw mapping field path by prepending the mapping's primary schema.
 *
 * Handles the field forms emitted by arrow and NL-ref extraction:
 * - `.field` paths inherit the first schema and drop the leading dot.
 * - `schema.field` paths inherit a namespace from the matching mapping schema.
 * - `ns::schema.field` paths are already fully qualified.
 * - Bare fields are attached to the first schema in the mapping side.
 */
export function qualifyField(field: string, schemas: string[]): string {
  if (schemas.length === 0) return field;
  if (field.includes("::")) return field;

  if (field.startsWith(".")) {
    return `${schemas[0]}.${field.slice(1)}`;
  }

  const dotIdx = field.indexOf(".");
  if (dotIdx > 0) {
    const prefix = field.slice(0, dotIdx);
    if (schemas.includes(prefix)) return field;
    for (const schema of schemas) {
      const nsIdx = schema.indexOf("::");
      const bare = nsIdx !== -1 ? schema.slice(nsIdx + 2) : schema;
      if (bare === prefix) return `${schema}${field.slice(dotIdx)}`;
    }
  }

  return `${schemas[0]}.${field}`;
}

/**
 * Resolve an entity reference against a namespace-keyed entity map.
 *
 * Resolution order:
 *   1. If `ref` already contains "::", treat it as fully qualified and check directly.
 *   2. Try `${currentNs}::${ref}` when a current namespace is provided.
 *   3. Try `ref` as a bare (global-scope) name.
 *
 * Returns the canonical key that exists in the map, or null when unresolvable.
 */
export function resolveScopedEntityRef(
  ref: string,
  currentNs: string | null,
  entityMap: Map<string, unknown>,
): string | null {
  if (ref.includes("::")) {
    return entityMap.has(ref) ? ref : null;
  }
  if (currentNs) {
    const nsKey = `${currentNs}::${ref}`;
    if (entityMap.has(nsKey)) return nsKey;
  }
  if (entityMap.has(ref)) return ref;
  return null;
}
