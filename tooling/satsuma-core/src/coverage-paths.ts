/**
 * coverage-paths.ts — The covered-path model for nested field coverage.
 *
 * Owns the *path* half of coverage: turning the dotted paths an arrow
 * references into a model that can answer "is this declared field covered?" —
 * and, just as importantly, "*why* is it covered?". Every consumer needs
 * identical nested-path semantics, so those rules live here rather than in
 * each UI layer.
 *
 * The model ({@link CoveredFieldPaths}) distinguishes two claims that a flat
 * set of strings cannot (PRD 38 R1, sl-fmx0):
 *
 *  - **direct** — an arrow (or resolved NL `@ref`) referenced exactly this
 *    path. "An arrow wrote THIS."
 *  - **ancestor** — the path is a proper prefix of a direct path. "Something
 *    INSIDE this container was written."
 *
 * Both count as covered today ({@link isCoveredPath}), which is why the two
 * were conflated in one set for so long. They diverge the moment coverage has
 * to reason about *containers*: a record that is directly covered by a
 * whole-record arrow (`addr -> address`) has had its entire subtree asserted
 * across, while a record that is merely the ancestor of one covered leaf has
 * not (3cc-iedv). Only a model that keeps the two apart can express that —
 * see {@link hasDirectlyCoveredAncestor} for the query and its current limits.
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

// ── The covered-path model ───────────────────────────────────────────────────

/**
 * Why each covered path is covered — the public contract of the model
 * (PRD 38 R1).
 *
 * The two sets may overlap: when arrows write both `address` and
 * `address.city`, `address` is direct (an arrow named it exactly) *and* an
 * ancestor (of `address.city`). Direct membership is always the stronger
 * claim, and queries treat it that way.
 *
 * The ancestor set is derivable from the direct set — it is materialised at
 * build time only so probes stay O(1). Nothing may be added to it except by
 * {@link buildCoveredFieldPaths}.
 */
export interface CoveredFieldPaths {
  /** Paths an arrow or resolved NL `@ref` referenced exactly. */
  direct: Set<string>;
  /** Proper ancestor prefixes of direct paths — containers something was written *into*. */
  ancestors: Set<string>;
}

/**
 * Build the covered-path model from the schema-local paths a mapping's arrows
 * reference.
 *
 * Each path enters `direct` verbatim, and every proper prefix of it enters
 * `ancestors` — so for `"orders.item_id"`, `direct` gains `"orders.item_id"`
 * and `ancestors` gains `"orders"`. Empty paths (from malformed arrows) are
 * ignored rather than registered as `""`.
 *
 * **Qualified paths only — never bare segments (sl-joeq).** An earlier version
 * also registered each segment on its own (`"city"` for `"address.city"`) so a
 * consumer could probe by local field name. That made coverage resolve by NAME
 * rather than by PATH: any field whose qualified path happened to equal a
 * segment of some other covered path read as mapped. Leaf-name reuse across
 * depths (`id`, `sku`, `code`, `city`, `BIC`) is normal in nested schemas, so
 * the collision rate rose with exactly the schemas coverage analysis is for —
 * and it failed in the dangerous direction, silently reporting an incomplete
 * spec as complete. Callers must pass the schema-local qualified path.
 */
export function buildCoveredFieldPaths(paths: Iterable<string>): CoveredFieldPaths {
  const direct = new Set<string>();
  const ancestors = new Set<string>();
  for (const path of paths) {
    if (!path) continue;
    direct.add(path);
    for (const prefix of properPrefixesOf(path)) ancestors.add(prefix);
  }
  return { direct, ancestors };
}

/**
 * True when the path is covered at all — directly or as the ancestor of a
 * direct path. This is the boolean every current consumer renders as "mapped",
 * and it is exactly what the flat-set probe has always answered.
 *
 * Same-named sibling: {@link isCoveredFieldPath} answers the identical question
 * over the flat `Set<string>` view for consumers that never build the model.
 * This one takes the model; that one takes the set.
 */
export function isCoveredPath(path: string, covered: CoveredFieldPaths): boolean {
  return covered.direct.has(path) || covered.ancestors.has(path);
}

/**
 * True when an arrow or resolved `@ref` referenced exactly this path — the
 * strong claim. A container that is only in `ancestors` returns false.
 */
export function isDirectlyCovered(path: string, covered: CoveredFieldPaths): boolean {
  return covered.direct.has(path);
}

/**
 * True when some proper ancestor of `path` is *directly* covered — the query
 * behind whole-subtree arrow semantics (PRD 38 R5): a leaf beneath a record
 * that an arrow wrote wholesale (`addr -> address`) is covered, while a leaf
 * beneath a record that is merely the ancestor of one covered sibling is not.
 * That second half is the trap 3cc-iedv documents: inheriting from *any*
 * covered ancestor would turn "one of twelve address fields is mapped" into
 * "all twelve are".
 *
 * **Not yet consulted by computeMappingCoverage.** The direct set is currently
 * kind-blind: an `each`/`flatten` header registers its iteration subject as a
 * direct path ("iterating a list consumes it"), so this query cannot yet tell
 * `addr -> address` (asserts the whole subtree) from `each items -> lines { }`
 * (opens an iteration scope and asserts nothing about unmentioned leaves).
 * Wiring it in without that distinction would manufacture coverage from every
 * each header. sl-r6b0 makes the direct set kind-aware and flips the
 * behaviour; until then this is a model-level query with model-level tests.
 */
export function hasDirectlyCoveredAncestor(path: string, covered: CoveredFieldPaths): boolean {
  for (const prefix of properPrefixesOf(path)) {
    if (covered.direct.has(prefix)) return true;
  }
  return false;
}

/** Proper dotted prefixes of a path, shortest first: "a.b.c" → ["a", "a.b"]. */
function properPrefixesOf(path: string): string[] {
  const prefixes: string[] = [];
  let prefix = "";
  for (const part of path.split(".").slice(0, -1)) {
    prefix = prefix ? `${prefix}.${part}` : part;
    prefixes.push(prefix);
  }
  return prefixes;
}

// ── Flat-set compatibility view ──────────────────────────────────────────────
//
// Consumers that only need the "covered at all?" boolean (the viz card, the
// LSP gutter) work over a flat Set<string>. That view is now *defined* as the
// union of the model's two sets, so the splitting rules exist once.

/**
 * Expand a collection of field paths into a flat coverage set — the union of
 * the model's direct and ancestor sets, for consumers that only need the
 * "covered at all?" boolean and none of the why. The registration rules
 * (qualified paths only, never bare segments; no bracket normalisation) are
 * the model's — see {@link buildCoveredFieldPaths} for the rules and their
 * history (sl-joeq, sl-8o1n).
 */
export function buildCoveredFieldSet(paths: Iterable<string>): Set<string> {
  const { direct, ancestors } = buildCoveredFieldPaths(paths);
  return new Set([...direct, ...ancestors]);
}

/**
 * Return true when a schema-local field path is covered by the expanded set.
 *
 * The caller must pass the schema-local *qualified* path (`customer.email`, not
 * `orders.customer.email` and not the bare leaf `email`). Matching is exact:
 * buildCoveredFieldSet() registers ancestor prefixes, so a record whose
 * descendant is covered matches on its own path, but a field is never matched
 * by local name alone (sl-joeq).
 *
 * Same-named sibling: {@link isCoveredPath} answers the identical question over
 * the {@link CoveredFieldPaths} model. This one takes the flat `Set<string>`
 * view (the viz card's shape); that one takes the model. Consumers moving onto
 * the model should prefer it — this set-based probe exists for call sites that
 * only ever see the flat view.
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
