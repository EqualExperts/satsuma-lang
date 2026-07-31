/**
 * coverage-rollup.ts — Rolling per-mapping coverage up to schema, namespace, and workspace.
 *
 * coverage.ts answers "which fields does *this mapping* touch?". This module
 * answers the question reviewers actually ask: "across the whole workspace,
 * which fields does *no* mapping populate?" — and the percentages that follow
 * from it.
 *
 * The two answers are different claims about the same field, and confusing them
 * is the failure mode this module exists to prevent: a target field that
 * mapping A populates and mapping B ignores is *uncovered by B* and *covered in
 * the aggregate*. The returned types keep them apart by construction — an
 * aggregate figure never appears in a per-mapping shape or vice versa — so a
 * consumer cannot render one under the other's label by accident.
 *
 * Owns: the union rule across mappings, the counting rule, and the
 * schema/namespace/workspace rollups.
 * Does not own: the per-mapping walk (coverage.ts), path expansion
 * (coverage-paths.ts), or how any of it is rendered.
 */

import type { FieldCoverageEntry, MappingCoverageResult } from "./coverage.js";

// ── Inputs ──────────────────────────────────────────────────────────────────

/** One mapping's coverage result, labelled with the mapping that produced it. */
export interface MappingCoverageInput {
  /**
   * Mapping identifier as shown to the user: `ns::name` for a namespaced
   * mapping, the bare name otherwise. Used to report which mappings reference a
   * schema, so it must match what other commands print.
   */
  mappingId: string;
  /** Per-schema field coverage for this mapping, from `computeMappingCoverage`. */
  result: MappingCoverageResult;
}

// ── Outputs ─────────────────────────────────────────────────────────────────

/**
 * Covered/total counts and the percentage derived from them.
 *
 * **Counting rule: only leaf fields count, on their own coverage flag.** A
 * `record` field is structure, not data — counting it alongside its children
 * would count the same data twice and let a schema's nesting depth move the
 * percentage on its own. `total` is therefore the number of leaves.
 *
 * Records are excluded rather than treated as covering their subtree, because a
 * record's `mapped` flag cannot distinguish the two cases that matter:
 * `addPathAndPrefixes` registers ancestor prefixes, so a record reads as mapped
 * when *any single descendant* is covered just as it does when the whole record
 * is copied by one arrow. Inheriting from it would turn "one of twelve address
 * fields is mapped" into "all twelve are" — a large, silent overstatement.
 * Excluding it instead under-counts the rarer whole-record arrow
 * (`address -> address` leaves its leaves unmapped, see 3cc-iedv), which errs
 * toward reporting a gap that is not there rather than hiding one that is.
 */
export interface CoverageTotals {
  /** Leaf fields whose own entry is marked covered. */
  covered: number;
  /** Leaf fields declared. Zero for a schema with no leaves. */
  total: number;
  /** covered/total as a whole-number percentage; 0 when `total` is 0. */
  pct: number;
}

/**
 * Aggregate coverage for one schema in one role, unioned across every mapping
 * that references it.
 *
 * "Aggregate" is the whole point of this shape: `fields[].mapped` means
 * *at least one* mapping covers the field. A false here is the strong claim —
 * no mapping in the workspace touches this field.
 */
export interface AggregateSchemaCoverage {
  /** Identifier of the schema (bare name or ns::name). */
  schemaId: string;
  /** Side of the mappings this schema appears on. A schema can appear in both. */
  role: "source" | "target";
  /** Mapping ids referencing this schema in this role, in encounter order. */
  mappings: string[];
  /** One entry per declared field; `mapped` is the union across `mappings`. */
  fields: FieldCoverageEntry[];
  /** Leaf counts for this schema and role, per the {@link CoverageTotals} rule. */
  totals: CoverageTotals;
}

/** Source and target subtotals for one grouping (a namespace, or the workspace). */
export interface RoleTotals {
  /** Source-side consumption: leaves read by at least one mapping. */
  source: CoverageTotals;
  /** Target-side population: leaves written by at least one mapping. */
  target: CoverageTotals;
}

/** Subtotals for the schemas declared in one namespace. */
export interface NamespaceCoverage extends RoleTotals {
  /** Namespace name, or null for schemas declared at file scope. */
  namespace: string | null;
}

/**
 * Workspace-wide aggregate coverage: every participating schema counted once,
 * however many mappings reference it.
 */
export interface AggregateCoverage {
  /** One entry per (schema, role) pair referenced by any mapping. */
  schemas: AggregateSchemaCoverage[];
  /** Per-namespace subtotals, ordered as namespaces are first encountered. */
  namespaces: NamespaceCoverage[];
  /** Totals across every schema in {@link schemas}. */
  workspace: RoleTotals;
}

// ── Counting ────────────────────────────────────────────────────────────────

/**
 * Summarise a flat field-coverage list into leaf counts.
 *
 * Applies the {@link CoverageTotals} counting rule, and is the *only* place it
 * is applied — per-mapping tables and aggregate rollups both call this, so a
 * per-mapping percentage and an aggregate percentage are always computed the
 * same way and remain comparable.
 *
 * `fields` must be a whole schema's entries in declaration order, as
 * `computeMappingCoverage` emits them: a record's entry immediately precedes
 * its descendants', and paths are dotted from the schema root.
 */
export function summarizeFieldCoverage(fields: FieldCoverageEntry[]): CoverageTotals {
  const paths = new Set(fields.map((f) => f.path));

  let covered = 0;
  let total = 0;
  for (const field of fields) {
    if (hasDescendant(field.path, paths)) continue; // a record, not a leaf
    total += 1;
    if (field.mapped) covered += 1;
  }
  return { covered, total, pct: percentage(covered, total) };
}

/** True when any entry's path sits below `path`, i.e. `path` is a record. */
function hasDescendant(path: string, paths: Set<string>): boolean {
  const prefix = `${path}.`;
  for (const candidate of paths) {
    if (candidate.startsWith(prefix)) return true;
  }
  return false;
}

/** Whole-number percentage, defined as 0 when there is nothing to cover. */
function percentage(covered: number, total: number): number {
  return total > 0 ? Math.round((covered / total) * 100) : 0;
}

/** Sum a set of totals, recomputing the percentage from the summed counts. */
function sumTotals(parts: Iterable<CoverageTotals>): CoverageTotals {
  let covered = 0;
  let total = 0;
  for (const part of parts) {
    covered += part.covered;
    total += part.total;
  }
  return { covered, total, pct: percentage(covered, total) };
}

// ── Aggregation ─────────────────────────────────────────────────────────────

/**
 * Union per-mapping coverage results into workspace-level coverage.
 *
 * **Union rule:** a target field counts as covered when *any* mapping populates
 * it; a source field counts as consumed when *any* mapping reads it. Both roles
 * are aggregated and reported separately — an unconsumed source field and an
 * unpopulated target field are different findings and must not be blended.
 *
 * Schemas are keyed by (schemaId, role), so a schema that is a target of one
 * mapping and a source of another yields two entries and is counted once in
 * each role's totals. Namespaces are taken from the *schema's* own id, not from
 * the referencing mapping's namespace: a subtotal answers "how well covered are
 * this namespace's schemas?", which is a property of where they are declared.
 *
 * Inputs whose mapping resolved to no schemas (an absent or empty mapping)
 * contribute nothing and are skipped.
 */
export function aggregateCoverage(inputs: MappingCoverageInput[]): AggregateCoverage {
  // Keyed by role + schemaId. Role is a two-value enum containing no spaces,
  // so the first space always separates the two parts — the key stays
  // unambiguous even for backtick-quoted schema names that contain spaces.
  const byRoleAndSchema = new Map<string, AggregateSchemaCoverage>();

  for (const { mappingId, result } of inputs) {
    for (const schema of result.schemas) {
      const key = `${schema.role} ${schema.schemaId}`;
      const existing = byRoleAndSchema.get(key);
      if (!existing) {
        byRoleAndSchema.set(key, {
          schemaId: schema.schemaId,
          role: schema.role,
          mappings: [mappingId],
          fields: schema.fields.map((f) => ({ ...f })),
          // Placeholder; every entry's totals are computed once all mappings
          // have been unioned in, below.
          totals: { covered: 0, total: 0, pct: 0 },
        });
        continue;
      }
      if (!existing.mappings.includes(mappingId)) existing.mappings.push(mappingId);
      unionInto(existing.fields, schema.fields);
    }
  }

  const schemas = [...byRoleAndSchema.values()];
  for (const schema of schemas) {
    schema.totals = summarizeFieldCoverage(schema.fields);
  }

  return {
    schemas,
    namespaces: rollUpByNamespace(schemas),
    workspace: {
      source: sumTotals(schemas.filter((s) => s.role === "source").map((s) => s.totals)),
      target: sumTotals(schemas.filter((s) => s.role === "target").map((s) => s.totals)),
    },
  };
}

/**
 * Merge one mapping's field entries into the accumulated aggregate list.
 *
 * `mapped` is OR-ed — that is the union rule. A field the accumulator has not
 * seen is appended, which only happens if two mappings resolved the same schema
 * id to different definitions; keeping it is safer than dropping a declared
 * field from the report.
 */
function unionInto(accumulated: FieldCoverageEntry[], incoming: FieldCoverageEntry[]): void {
  const byPath = new Map(accumulated.map((f) => [f.path, f]));
  for (const field of incoming) {
    const existing = byPath.get(field.path);
    if (!existing) {
      const copy = { ...field };
      accumulated.push(copy);
      byPath.set(copy.path, copy);
      continue;
    }
    existing.mapped = existing.mapped || field.mapped;
  }
}

/**
 * Group schema totals by the namespace their id declares them in.
 *
 * Bare (unqualified) schema ids belong to file scope and are grouped under a
 * null namespace, so a workspace with no namespaces yields exactly one group
 * whose totals equal the workspace totals.
 */
function rollUpByNamespace(schemas: AggregateSchemaCoverage[]): NamespaceCoverage[] {
  const groups = new Map<string | null, AggregateSchemaCoverage[]>();
  for (const schema of schemas) {
    const namespace = namespaceOf(schema.schemaId);
    const group = groups.get(namespace);
    if (group) group.push(schema);
    else groups.set(namespace, [schema]);
  }

  const result: NamespaceCoverage[] = [];
  for (const [namespace, group] of groups) {
    result.push({
      namespace,
      source: sumTotals(group.filter((s) => s.role === "source").map((s) => s.totals)),
      target: sumTotals(group.filter((s) => s.role === "target").map((s) => s.totals)),
    });
  }
  return result;
}

/** Namespace part of a schema id (`crm::orders` → `crm`), or null at file scope. */
function namespaceOf(schemaId: string): string | null {
  const separator = schemaId.indexOf("::");
  return separator === -1 ? null : schemaId.slice(0, separator);
}
