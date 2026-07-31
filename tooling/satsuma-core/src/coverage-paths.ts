/**
 * coverage-paths.ts — Field-path set helpers for nested field coverage.
 *
 * Owns the *path* half of coverage: turning the dotted paths an arrow
 * references into a set that can answer "is this declared field covered?".
 * Every consumer needs identical nested-path semantics — if an arrow
 * references `customer.email`, both `customer` and `customer.email` count as
 * covered — so those rules live here rather than in each UI layer.
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
 * paths like `"items[].id"` are registered as `"items"`, `"items.id"`, and `"id"`.
 *
 * Registering ancestors means a top-level field `"address"` is considered
 * covered when an arrow targets the nested path `"address.city"` — a consumer
 * that checks `coveredPaths.has(f.name)` will correctly find the parent covered.
 *
 * Example: addPathAndPrefixes(set, "orders.item_id")
 *   → set now contains "orders", "orders.item_id", "item_id"
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
    set.add(part); // bare leaf so "city" matches even if the full path is "address.city"
  }
}

/**
 * Expand a collection of field paths into a coverage set containing the full
 * path, its ancestor prefixes, and the leaf segment for each entry.
 */
export function buildCoveredFieldSet(paths: Iterable<string>): Set<string> {
  const covered = new Set<string>();
  for (const path of paths) addPathAndPrefixes(covered, path);
  return covered;
}

/**
 * Return true when a schema-local field path is covered by the expanded set.
 *
 * The caller must pass the schema-local path (`customer.email`, not
 * `orders.customer.email`). Matching is intentionally exact because
 * buildCoveredFieldSet() already registers prefixes and leaves.
 */
export function isCoveredFieldPath(path: string, coveredPaths: Set<string>): boolean {
  return coveredPaths.has(path);
}
