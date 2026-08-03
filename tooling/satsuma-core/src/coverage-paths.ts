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
 * not (3cc-iedv). Keeping the two apart is what lets coverage.ts expand the
 * first without ever inheriting from the second.
 *
 * The distinction is consumed at *set-build* time, not at probe time: coverage
 * expands a whole-structure arrow into its declared subtree before building the
 * model (`expandWholeStructureRefs` in coverage.ts, ADR-037), so the probes here
 * stay the single "covered at all?" question every consumer already asks. A
 * probe-time variant — "is some proper ancestor of this path *directly*
 * covered?" — existed briefly as scaffolding for that work and was removed with
 * it: the direct set alone cannot tell `addr -> address` from
 * `each items -> lines { }`, so no caller holding only this model can decide
 * subtree coverage safely.
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
  direct: ReadonlySet<string>;
  /** Proper ancestor prefixes of direct paths — containers something was written *into*. */
  ancestors: ReadonlySet<string>;
}

/**
 * Build the covered-path model from the schema-local paths a mapping's arrows
 * reference.
 *
 * Each path enters `direct` verbatim, and every proper prefix of it enters
 * `ancestors` — so for `"orders.item_id"`, `direct` gains `"orders.item_id"`
 * and `ancestors` gains `"orders"`. Empty paths (from malformed arrows) are
 * ignored rather than registered as `""`. (A dot-leading path like `".line1"`
 * would still register `""` as an ancestor — harmless, since no declared field
 * has an empty path, and unreachable today because extraction qualifies
 * relative paths before coverage sees them.)
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
 * direct path. This is the boolean every consumer renders as "mapped", reached
 * through the `FieldCoverageEntry` list coverage.ts builds from it.
 */
export function isCoveredPath(path: string, covered: CoveredFieldPaths): boolean {
  return covered.direct.has(path) || covered.ancestors.has(path);
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

// ── No flat-set view ─────────────────────────────────────────────────────────
//
// There was one — `buildCoveredFieldSet(paths)` returning the union of the two
// sets above, plus `isCoveredFieldPath(path, set)` to probe it — for consumers
// that only wanted the "covered at all?" boolean. It is gone, with its last
// consumer (sl-46wr, sl-csrs).
//
// It has to stay gone. A flat set of paths cannot express either of the two
// rules coverage has gained since: which tier covered a field (ADR-036) and
// whether an arrow's declaration confers its whole subtree (ADR-037). Both are
// properties of the *arrow*, not of the path it names, so a consumer holding
// only paths cannot apply them — and, worse, cannot tell that it is failing to.
// The viz card held such a set and under-reported twelve of the shipped examples
// while looking entirely plausible. A consumer with real coverage to report goes
// through `computeMappingCoverage`, which has the arrows and the resolved refs;
// one that merely needs a denominator uses `uncoveredFieldCoverage`.

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
