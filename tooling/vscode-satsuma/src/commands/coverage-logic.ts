/**
 * coverage-logic.ts — pure shaping of mapping-coverage results (no vscode).
 *
 * The LSP's satsuma/mappingCoverage response is a flat list of fields per
 * schema; the editor overlay needs them grouped per file with hover text, and
 * the status bar needs a target-coverage percentage. This module owns those
 * two transformations so they stay unit-testable in plain Node; decoration
 * types, editors, and the status bar live in coverage.ts (sl-89id).
 */

/** One schema's fields from the LSP satsuma/mappingCoverage response. */
export interface CoverageSchema {
  /** Identifier of the schema, as reported by the LSP. */
  schemaId: string;
  /** Whether the mapping reads from (source) or writes to (target) this schema. */
  role: "source" | "target";
  /** Every declared field with its location and whether the mapping touches it. */
  fields: Array<{ path: string; uri: string; line: number; mapped: boolean }>;
}

/** A single gutter marker: where it goes and what its hover says. */
export interface CoverageMarker {
  /** Zero-based line of the field declaration. */
  line: number;
  /** Markdown hover text, e.g. `**customer.id** — used as source`. */
  hoverMessage: string;
}

/** All gutter markers for one file, split by the icon they get. */
export interface FileCoverageMarkers {
  mapped: CoverageMarker[];
  unmapped: CoverageMarker[];
}

/**
 * Group coverage fields by the file they live in, with role-appropriate
 * hover labels (source fields are "used / not used as source"; target
 * fields are "mapped / unmapped"). Keys are the URIs reported by the LSP.
 */
export function groupCoverageByUri(
  schemas: CoverageSchema[],
): Map<string, FileCoverageMarkers> {
  const byUri = new Map<string, FileCoverageMarkers>();
  for (const schema of schemas) {
    const mappedLabel = schema.role === "source" ? "used as source" : "mapped";
    const unmappedLabel =
      schema.role === "source" ? "not used as source" : "unmapped";
    for (const f of schema.fields) {
      let bucket = byUri.get(f.uri);
      if (!bucket) {
        bucket = { mapped: [], unmapped: [] };
        byUri.set(f.uri, bucket);
      }
      const label = f.mapped ? mappedLabel : unmappedLabel;
      const marker = { line: f.line, hoverMessage: `**${f.path}** — ${label}` };
      (f.mapped ? bucket.mapped : bucket.unmapped).push(marker);
    }
  }
  return byUri;
}

/** Status-bar summary of how much of the target schema the mapping fills. */
export interface TargetCoverageStats {
  /** Count of top-level target fields the mapping writes. */
  mapped: number;
  /** Count of all top-level target fields. */
  total: number;
  /** Whole-number percentage (mapped/total), 0 when the schema has no fields. */
  pct: number;
}

/**
 * Compute the target-coverage percentage shown in the status bar, counting
 * only top-level fields (nested paths contain "." and would double-count
 * their parent). Returns undefined when the result has no target schema.
 */
export function computeTargetCoverageStats(
  schemas: CoverageSchema[],
): TargetCoverageStats | undefined {
  const target = schemas.find((s) => s.role === "target");
  if (!target) return undefined;
  const topLevel = target.fields.filter((f) => !f.path.includes("."));
  const mapped = topLevel.filter((f) => f.mapped).length;
  const total = topLevel.length;
  return { mapped, total, pct: total > 0 ? Math.round((mapped / total) * 100) : 0 };
}
