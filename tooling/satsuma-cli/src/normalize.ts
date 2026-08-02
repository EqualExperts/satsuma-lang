/**
 * normalize.ts — Field-level name matching for source-to-target alignment
 *
 * Provides fuzzy field matching: two field names are considered equivalent
 * when their normalised forms (see normalizeName in @satsuma/core) are
 * identical.  Match is binary — no scoring, no partial credit.
 *
 * normalizeName itself lives in @satsuma/core so other tooling packages can
 * reuse it without depending on the CLI.  It is re-exported here so existing
 * callers within satsuma-cli can import from either location.
 */

export { normalizeName } from "@satsuma/core";
import { normalizeName } from "@satsuma/core";
import type { FieldDecl, FieldMatch, MatchResult } from "./types.js";

/**
 * Flatten nested fields into dotted path names for matching.
 * e.g. a field "city" nested under "address" becomes "address.city".
 */
function flattenFields(fields: FieldDecl[], prefix = ""): { name: string }[] {
  const result: { name: string }[] = [];
  for (const f of fields) {
    const fullName = prefix ? `${prefix}.${f.name}` : f.name;
    result.push({ name: fullName });
    if (f.children && f.children.length > 0) {
      result.push(...flattenFields(f.children, fullName));
    }
  }
  return result;
}

/**
 * Match fields between source and target schemas by normalized name.
 * Recurses into nested records, matching by leaf name across nesting levels.
 */
export function matchFields(sourceFields: FieldDecl[], targetFields: FieldDecl[]): MatchResult {
  const flatSource = flattenFields(sourceFields);
  const flatTarget = flattenFields(targetFields);

  const targetByNorm = new Map<string, string>();
  for (const f of flatTarget) {
    const norm = normalizeName(f.name);
    if (!targetByNorm.has(norm)) targetByNorm.set(norm, f.name);
    // Also index by leaf name for cross-level matching
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: split always produces at least one element
    const leaf = f.name.split(".").pop()!;
    const leafNorm = normalizeName(leaf);
    if (!targetByNorm.has(leafNorm)) targetByNorm.set(leafNorm, f.name);
  }

  const matched: FieldMatch[] = [];
  const matchedTargetNorms = new Set<string>();
  const sourceOnly: string[] = [];

  // Safe: split().pop() always returns a value; .get() calls are guarded by .has() checks
  /* eslint-disable @typescript-eslint/no-non-null-assertion */
  for (const f of flatSource) {
    const norm = normalizeName(f.name);
    const leaf = f.name.split(".").pop()!;
    const leafNorm = normalizeName(leaf);

    if (targetByNorm.has(norm)) {
      matched.push({
        source: f.name,
        target: targetByNorm.get(norm)!,
        normalized: norm,
      });
      matchedTargetNorms.add(norm);
    } else if (targetByNorm.has(leafNorm)) {
      matched.push({
        source: f.name,
        target: targetByNorm.get(leafNorm)!,
        normalized: leafNorm,
      });
      matchedTargetNorms.add(leafNorm);
    } else {
      sourceOnly.push(f.name);
    }
  }

  const targetOnly = flatTarget
    .filter((f) => {
      const norm = normalizeName(f.name);
      const leaf = f.name.split(".").pop()!;
      return !matchedTargetNorms.has(norm) && !matchedTargetNorms.has(normalizeName(leaf));
    })
    /* eslint-enable @typescript-eslint/no-non-null-assertion */
    .map((f) => f.name);

  return { matched, sourceOnly, targetOnly };
}
