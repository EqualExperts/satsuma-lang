/**
 * canonical-ref.ts — Canonical field reference and entity resolution utilities
 *
 * Produces the canonical [ns]::schema.field form used across all CLI output.
 * When no namespace is present, the :: prefix is retained for unambiguous parsing.
 *
 * Owns the decision *which schema owns an authored arrow field* —
 * resolveFieldEndpoint — and reports the one case that decision cannot be made
 * in, rather than guessing. It does not own the endpoint spelling itself; that
 * belongs to reference-stages.ts, which this module composes with.
 *
 * Also exports resolveScopedEntityRef, the standard namespace-aware lookup
 * used by the validator and other workspace traversal code.
 */

import {
  NAMESPACE_SEPARATOR,
  PATH_SEPARATOR,
  createCanonicalEntityRef,
  createCanonicalFieldEndpoint,
  createSchemaLocalPath,
  fieldEndpointOf,
} from "./reference-stages.js";
import type {
  AuthoredFieldRef,
  CanonicalEntityRef,
  CanonicalFieldEndpoint,
} from "./reference-stages.js";

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

// ── Arrow endpoint resolution ────────────────────────────────────────────────

/**
 * What resolving an authored arrow field against a mapping's schemas concluded.
 *
 * Three variants rather than one string, because qualification is not always
 * decidable and the previous single-string form (`qualifyField`) emitted its
 * guess as though it were a fact — the mechanism behind `r0-7w76`. A caller now
 * has to acknowledge the fork it is standing on.
 */
export type FieldEndpointResolution =
  | {
      /** The token named a field, and the owning schema was determined. */
      readonly kind: "field";
      /** Canonical identity of that field. */
      readonly endpoint: CanonicalFieldEndpoint;
    }
  | {
      /**
       * The token is a bare name that is *also* one of the declared schemas on
       * this side of the mapping, so it reads two ways: as that schema's root
       * (what `flatten observations -> species_fact` means to a human) or as a
       * same-named field of the mapping's primary schema. Both readings are
       * offered because nothing at this layer can choose between them — the
       * decision is `r0-7w76`.
       */
      readonly kind: "schema-root-or-field";
      /** The schema whose name the token matched, read as a container root. */
      readonly schemaRoot: CanonicalEntityRef;
      /** The same token read as a field of the primary schema. */
      readonly asField: CanonicalFieldEndpoint;
    }
  | {
      /**
       * The mapping declares no schema on this side, so there is no owner to
       * qualify against and the authored text is the whole identity available.
       */
      readonly kind: "unqualifiable";
      readonly authored: AuthoredFieldRef;
    };

/**
 * Resolve one authored arrow field to the schema that owns it.
 *
 * `schemas` are the workspace index keys declared on the relevant side of the
 * mapping, in declaration order: a bare name for a global entity, `ns::name`
 * for a namespaced one. Order matters — an unqualified path attaches to the
 * first entry.
 *
 * The authored forms arrow and NL-ref extraction produce:
 * - `ns::schema.field` — already canonical, adopted unchanged;
 * - `.field` — relative to the primary schema, losing the synthetic dot;
 * - `schema.field` — owned by the matching declared schema, whose namespace is
 *   restored when the token names only its bare half;
 * - a bare token — a field of the primary schema, unless it also names a
 *   declared schema, which is the ambiguous case above.
 */
export function resolveFieldEndpoint(
  authored: AuthoredFieldRef,
  schemas: readonly string[],
): FieldEndpointResolution {
  const [primarySchema] = schemas;
  if (primarySchema === undefined) return { kind: "unqualifiable", authored };

  // A token carrying the namespace separator was qualified upstream; prefixing
  // it again would produce `crm::orders.crm::customers.id`.
  if (authored.includes(NAMESPACE_SEPARATOR)) {
    return { kind: "field", endpoint: createCanonicalFieldEndpoint(authored) };
  }

  if (authored.startsWith(PATH_SEPARATOR)) {
    return {
      kind: "field",
      endpoint: endpointIn(primarySchema, authored.slice(PATH_SEPARATOR.length)),
    };
  }

  const pathStart = authored.indexOf(PATH_SEPARATOR);
  if (pathStart > 0) {
    const owner = schemaNamed(authored.slice(0, pathStart), schemas);
    if (owner !== undefined) {
      return {
        kind: "field",
        endpoint: endpointIn(owner, authored.slice(pathStart + PATH_SEPARATOR.length)),
      };
    }
    return { kind: "field", endpoint: endpointIn(primarySchema, authored) };
  }

  const namedSchema = schemaNamed(authored, schemas);
  if (namedSchema !== undefined) {
    return {
      kind: "schema-root-or-field",
      schemaRoot: canonicalEntityRefOfIndexKey(namedSchema),
      asField: endpointIn(primarySchema, authored),
    };
  }

  return { kind: "field", endpoint: endpointIn(primarySchema, authored) };
}

/**
 * The declared schema an authored prefix names, if any.
 *
 * Two passes, exact index key before bare name: one mapping side may declare
 * both a global `customers` and a namespaced `crm::customers`, and the authored
 * text `customers` names the global one.
 */
function schemaNamed(prefix: string, schemas: readonly string[]): string | undefined {
  if (schemas.includes(prefix)) return prefix;
  return schemas.find((schema) => bareEntityName(schema) === prefix);
}

/** An index key with any namespace stripped: `crm::customers` → `customers`. */
function bareEntityName(indexKey: string): string {
  const separator = indexKey.indexOf(NAMESPACE_SEPARATOR);
  return separator === -1 ? indexKey : indexKey.slice(separator + NAMESPACE_SEPARATOR.length);
}

/** Endpoint identity of `path` inside the schema held under `indexKey`. */
function endpointIn(indexKey: string, path: string): CanonicalFieldEndpoint {
  return fieldEndpointOf(canonicalEntityRefOfIndexKey(indexKey), createSchemaLocalPath(path));
}

/**
 * Brand a workspace index key as canonical entity identity.
 *
 * Index maps key a global entity by its bare name and a namespaced one by
 * `ns::name`, while canonical identity always carries the separator so a global
 * entity cannot collide with authored bare text. Kept private: the CLI's
 * `canonicalKey` states the same rule for display keys, where an empty name is
 * tolerated and here it is not.
 */
function canonicalEntityRefOfIndexKey(indexKey: string): CanonicalEntityRef {
  return createCanonicalEntityRef(
    indexKey.includes(NAMESPACE_SEPARATOR) ? indexKey : `${NAMESPACE_SEPARATOR}${indexKey}`,
  );
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
