/**
 * coverage-paths.ts — Field-path set helpers for nested field coverage.
 *
 * Owns the *path* half of coverage: turning the dotted paths an arrow
 * references into a set that can answer "is this declared field covered?".
 * Every consumer needs identical nested-path semantics — if an arrow
 * references `customer.email`, both `customer` and `customer.email` count as
 * covered — so those rules live here rather than in each UI layer.
 *
 * It also owns the rule that turns an arrow's *authored* field reference into a
 * schema-local path: in a multi-source mapping arrows name their schema
 * (`crm_customers.email -> email`), and every consumer must strip that prefix
 * the same way before matching against declared fields.
 *
 * Does not own the CST walk that produces those paths, nor the per-field
 * result shape: both live in coverage.ts, which builds on this module. The
 * dependency runs one way (coverage.ts → coverage-paths.ts) so the two
 * modules can be reasoned about independently.
 */

/**
 * Register a path and all its ancestor prefixes in the covered-paths set.
 *
 * Strips array-notation brackets (`[]`) before splitting so that list-traversal
 * paths like `"items[].id"` are registered as `"items"` and `"items.id"`.
 *
 * Registering ancestors means a top-level field `"address"` is considered
 * covered when an arrow targets the nested path `"address.city"` — a consumer
 * checking the record's own path will correctly find the parent covered.
 *
 * **Qualified paths only — never bare segments (sl-joeq).** An earlier version
 * also registered each segment on its own (`"city"` for `"address.city"`) so a
 * consumer could probe by local field name. That made coverage resolve by NAME
 * rather than by PATH: any field whose qualified path happened to equal a
 * segment of some other covered path read as mapped. Leaf-name reuse across
 * depths (`id`, `sku`, `code`, `city`, `BIC`) is normal in nested schemas, so
 * the collision rate rose with exactly the schemas coverage analysis is for —
 * and it failed in the dangerous direction, silently reporting an incomplete
 * spec as complete. Consumers must pass the schema-local qualified path.
 *
 * Example: addPathAndPrefixes(set, "orders.item_id")
 *   → set now contains "orders" and "orders.item_id"
 */
export function addPathAndPrefixes(set: Set<string>, path: string): void {
  if (!path) return;
  // Strip array notation: "items[].id" → "items.id"
  const normalised = path.replace(/\[\]/g, "");
  const parts = normalised.split(".");
  let prefix = "";
  for (const part of parts) {
    prefix = prefix ? `${prefix}.${part}` : part;
    set.add(prefix);
  }
}

/**
 * Expand a collection of field paths into a coverage set containing the full
 * path and its ancestor prefixes for each entry.
 */
export function buildCoveredFieldSet(paths: Iterable<string>): Set<string> {
  const covered = new Set<string>();
  for (const path of paths) addPathAndPrefixes(covered, path);
  return covered;
}

/**
 * Return true when a schema-local field path is covered by the expanded set.
 *
 * The caller must pass the schema-local *qualified* path (`customer.email`, not
 * `orders.customer.email` and not the bare leaf `email`). Matching is exact:
 * buildCoveredFieldSet() registers ancestor prefixes, so a record whose
 * descendant is covered matches on its own path, but a field is never matched
 * by local name alone (sl-joeq).
 */
export function isCoveredFieldPath(path: string, coveredPaths: Set<string>): boolean {
  return coveredPaths.has(path);
}

// ── Schema-qualified arrow references ───────────────────────────────────────

/**
 * Every prefix a reference may legitimately use to name one schema.
 *
 * Three spellings of the same schema circulate, and coverage matches references
 * from sources that use different ones:
 *
 *  - `crm::customers` — the namespace-qualified id, written from outside the
 *    namespace and used as the index key.
 *  - `customers` — the bare name, written from inside the namespace. Arrows keep
 *    whichever form the author wrote, so matching only the qualified form would
 *    miss every bare-prefixed reference in a namespaced mapping (sl-iqud).
 *  - `::customers` — the *canonical* form of a schema in no namespace, which is
 *    what `resolveRef` returns for a resolved NL `@ref` (sl-qxyl). A resolved ref
 *    is always fully canonical, so without this a global schema's NL coverage
 *    would never match.
 */
export function schemaRefPrefixes(schemaRef: string): string[] {
  const namespaceEnd = schemaRef.lastIndexOf("::");
  if (namespaceEnd < 0) return [schemaRef, `::${schemaRef}`];
  return [schemaRef, schemaRef.slice(namespaceEnd + 2)];
}

/**
 * Reduce an arrow's authored field reference to a path local to one schema, or
 * null when the reference belongs to a different schema in the same mapping.
 *
 * Multi-source mappings qualify their arrows by schema — see
 * `examples/filter-flatten-governance/governance.stm`, whose every source arrow
 * reads `crm_customers.email -> email`. Coverage compares against paths declared
 * *within* a schema, so the prefix has to come off first; before sl-joeq the
 * qualified form only matched by accident, via bare-segment registration.
 *
 * The rules, in order:
 *  1. The reference *is* a schema name with no field part → null. It names the
 *     schema, not a field in it. Spec §4.6's top-level flatten writes exactly
 *     this — `flatten contacts -> tgt` targets the target *schema* — so without
 *     this rule `tgt` would enter the covered set as if it were a field.
 *  2. The reference names *this* schema and continues into a path → strip the
 *     prefix and return the rest.
 *  3. The reference names a *different* schema in the same block → null; that
 *     schema's own pass will claim it.
 *  4. Otherwise the reference is already schema-local → return it unchanged.
 *
 * Rules 1 and 2 are both skipped when the schema declares a top-level field of
 * that name: a schema and a field sharing a name resolves to the concrete field
 * rather than to a prefix that only looks like one.
 *
 * @param fieldRef         Path as authored on the arrow, already container-qualified.
 * @param schemaRefs       Every form this schema may be named by — the reference
 *                         as written in the mapping and, when it differs, the
 *                         resolved canonical id.
 * @param otherSchemaRefs  The other schemas referenced on this side of the mapping.
 * @param declaresTopLevel True when this schema declares a top-level field of the
 *                         given name. Supply it to disambiguate rules 1 and 2.
 */
export function schemaLocalFieldPath(
  fieldRef: string,
  schemaRefs: readonly string[],
  otherSchemaRefs: readonly string[],
  declaresTopLevel?: (name: string) => boolean,
): string | null {
  const firstSegment = fieldRef.split(".")[0] ?? fieldRef;
  const shadowedByOwnField = declaresTopLevel?.(firstSegment) ?? false;

  if (!shadowedByOwnField) {
    for (const prefix of schemaRefs.flatMap(schemaRefPrefixes)) {
      if (fieldRef === prefix) return null;
      if (fieldRef.startsWith(`${prefix}.`)) return fieldRef.slice(prefix.length + 1);
    }
  }

  const namesAnotherSchema = otherSchemaRefs
    .flatMap(schemaRefPrefixes)
    .some((prefix) => fieldRef === prefix || fieldRef.startsWith(`${prefix}.`));
  if (namesAnotherSchema) return null;

  return fieldRef;
}
