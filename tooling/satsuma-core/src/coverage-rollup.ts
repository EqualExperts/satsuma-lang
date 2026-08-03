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

import type { CoverageTier, FieldCoverageEntry, MappingCoverageResult } from "./coverage.js";

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
 * **Counting rule (ADR-034): only leaf fields count, on their own coverage
 * flag.** A
 * `record` field is structure, not data — counting it alongside its children
 * would count the same data twice and let a schema's nesting depth move the
 * percentage on its own. `total` is therefore the number of leaves.
 *
 * Records are excluded rather than counted alongside their children: counting a
 * record would add a unit of "data" that is really structure, letting a schema's
 * nesting depth move the percentage without a single extra field being mapped.
 * The exclusion is now purely that — with the tri-state (PRD 38 R2) a record's
 * own state is *derived* from these same leaves, so counting it would be
 * double-counting them, not a hedge against an ambiguous flag as it once was.
 */
export interface CoverageTotals {
  /**
   * Leaf fields whose own entry is marked covered — the sum of the two tiers
   * below, and the figure `--fail-under` gates. ADR-036 splits the numerator
   * into tiers; it does not change what is counted.
   */
  covered: number;
  /** Of `covered`, the leaves a declared arrow references. */
  coveredDeclared: number;
  /**
   * Of `covered`, the leaves only a resolved NL `@ref` names.
   *
   * Disjoint from {@link coveredDeclared} by construction: a field covered both
   * ways is reported in the declared tier, so the two always sum to `covered`
   * and a consumer can render the split without risk of double counting.
   */
  coveredNl: number;
  /**
   * Leaf fields declared. Zero for a schema with no leaves — which includes a
   * schema of nothing but empty `record {}` fields, since those are structure
   * and carry no data to measure (`ccc-3vaw`).
   */
  total: number;
  /**
   * covered/total as a whole-number percentage, per
   * {@link coveragePercentage}'s rule: 100 and 0 mean *exactly* complete and
   * *exactly* nothing, and every state in between reports 1–99.
   */
  pct: number;
}

/**
 * How many of a schema's containers sit in each coverage state (PRD 38 R2).
 *
 * Reported *alongside* a percentage, never inside one: a record is structure,
 * so it is excluded from the ratio by ADR-034, but "two records are only partly
 * mapped" is exactly what a reviewer wants next to "9/12". The three counts sum
 * to the number of record and `list_of record` fields declared — **every one of
 * them**, an empty `record {}` included, which needs
 * {@link FieldCoverageEntry.container} to see (`ccc-3vaw`).
 */
export interface ContainerStateCounts {
  /** Containers every one of whose descendant leaves is covered. */
  covered: number;
  /** Containers with at least one covered and at least one uncovered leaf. */
  partial: number;
  /** Containers no leaf of which is covered. */
  uncovered: number;
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
  const leaves = leafFieldEntries(fields);
  const coveredLeaves = leaves.filter((f) => f.mapped);
  // Count from the per-field tier rather than re-deriving it, so a rendered
  // field list and the split printed beside it cannot disagree (ADR-036).
  const coveredNl = coveredLeaves.filter((f) => f.tier === "nl").length;
  return {
    covered: coveredLeaves.length,
    coveredDeclared: coveredLeaves.length - coveredNl,
    coveredNl,
    total: leaves.length,
    pct: coveragePercentage(coveredLeaves.length, leaves.length),
  };
}

/**
 * The leaf entries of a schema's coverage list — the fields that carry data,
 * and the unit every count and percentage is expressed in.
 *
 * Exported so that a rendered "uncovered fields" list and the `covered/total`
 * figure beside it are derived from the same definition of leaf. If they used
 * different ones, a report could show three uncovered paths next to a count
 * of two.
 */
export function leafFieldEntries(fields: FieldCoverageEntry[]): FieldCoverageEntry[] {
  const paths = new Set(fields.map((f) => f.path));
  return fields.filter((f) => !isContainerEntry(f, paths));
}

/**
 * The container entries of a schema's coverage list, tallied by state.
 *
 * The counterpart to {@link summarizeFieldCoverage}, and deliberately not part
 * of it: containers are excluded from the percentage (ADR-034) and this is the
 * shape that lets a consumer say so out loud. "9/12 leaves, 2 records partly
 * mapped" is review information a percentage cannot carry — a reviewer can see
 * that two records need attention without a number that double-counts their
 * children.
 *
 * Containers and leaves partition the list — every entry is counted here or by
 * {@link leafFieldEntries} and never by both — so the three counts sum to the
 * record and `list_of record` fields the schema declares, and a schema with no
 * records reports three zeroes.
 */
export function countContainerStates(fields: FieldCoverageEntry[]): ContainerStateCounts {
  const paths = new Set(fields.map((f) => f.path));
  const counts: ContainerStateCounts = { covered: 0, partial: 0, uncovered: 0 };
  for (const field of fields) {
    if (isContainerEntry(field, paths)) counts[field.state]++;
  }
  return counts;
}

/**
 * True when an entry is structure rather than data, and so belongs in the
 * container tally and out of the denominator.
 *
 * The declared flag decides it. The structural test behind it is the fallback for
 * entries from a producer older than {@link FieldCoverageEntry.container} — right
 * for every record with children, and blind to `record {}`, which is the bug the
 * flag exists to fix (`ccc-3vaw`). Keeping the fallback means a cached viz payload
 * (ADR-042) still classifies its non-empty records correctly instead of reporting
 * every record as a leaf.
 */
function isContainerEntry(entry: FieldCoverageEntry, paths: Set<string>): boolean {
  return entry.container === true || hasDescendant(entry.path, paths);
}

/** True when any entry's path sits below `path`, i.e. `path` is a record. */
function hasDescendant(path: string, paths: Set<string>): boolean {
  const prefix = `${path}.`;
  for (const candidate of paths) {
    if (candidate.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * The whole-number percentage every consumer reports and `--fail-under` gates.
 *
 * **Rule: 100 and 0 are reserved for the exact endpoints; everything between
 * them floors into 1–99.** Rounding to nearest is what a gate cannot survive
 * (`sl-8ba4`): 200 of 201 leaves rounds to 100, so `--fail-under 100` passed a
 * spec with an unmapped field — failing open in the one direction a merge gate
 * must not. Flooring alone fixes the gate but introduces the mirror-image lie at
 * the bottom, where 1 of 201 reports 0% and reads as "nothing is mapped".
 *
 * So the two endpoints are decided by the counts, not by arithmetic on them:
 *
 * - `covered === total` → 100. The only way to print 100.
 * - `covered === 0` → 0. The only way to print 0 (with `total === 0`, below).
 * - otherwise → `floor`, clamped up to 1, so partial work never reports as none.
 *
 * A reviewer and CI therefore read the same number, which is why the gate reads
 * `pct` rather than re-deriving a ratio of its own.
 *
 * `total === 0` reports 0: a schema with no leaves has nothing to cover, and
 * calling that complete would let an empty schema satisfy any threshold.
 */
export function coveragePercentage(covered: number, total: number): number {
  if (total <= 0) return 0;
  if (covered >= total) return 100;
  if (covered <= 0) return 0;
  // Floor, then hold the bottom off 0 — a covered leaf must be visible.
  return Math.max(1, Math.floor((covered / total) * 100));
}

/** Sum a set of totals, recomputing the percentage from the summed counts. */
function sumTotals(parts: Iterable<CoverageTotals>): CoverageTotals {
  let covered = 0;
  let coveredDeclared = 0;
  let coveredNl = 0;
  let total = 0;
  for (const part of parts) {
    covered += part.covered;
    coveredDeclared += part.coveredDeclared;
    coveredNl += part.coveredNl;
    total += part.total;
  }
  return { covered, coveredDeclared, coveredNl, total, pct: coveragePercentage(covered, total) };
}

// ── Union ───────────────────────────────────────────────────────────────────

/**
 * Union several field-coverage lists for the *same schema* into one.
 *
 * **Union rule:** a leaf is covered when any input covers it, under the
 * strongest tier any input claims; every container is then re-derived from the
 * unioned leaves. Entries are returned in the order the first input declared
 * them, with fields only later inputs know about appended.
 *
 * Exported because three questions reduce to this one operation and must not
 * answer it differently: "does any mapping in the workspace cover this field?"
 * ({@link aggregateCoverage}), "does this mapping cover it on either side?" (a
 * schema can appear in both `source{}` and `target{}`), and "does anything in
 * this file touch it?" — the viz overview card's index. Each of those was, or
 * would have become, its own re-implementation of the same three rules.
 *
 * The inputs are not mutated; the result is a fresh list of fresh entries.
 *
 * Why containers cannot simply be OR-ed: two mappings that each cover half of
 * `address` both report it `partial`, but between them every leaf is written,
 * so the union is `covered`. Taking the strongest per-input state would say
 * `partial` and understate the union — see {@link recomputeContainerStates}.
 */
export function unionFieldCoverage(lists: Iterable<FieldCoverageEntry[]>): FieldCoverageEntry[] {
  const accumulated: FieldCoverageEntry[] = [];
  for (const list of lists) unionInto(accumulated, list);
  recomputeContainerStates(accumulated);
  return accumulated;
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
  const byRoleAndSchema = new Map<
    string,
    {
      schemaId: string;
      role: "source" | "target";
      mappings: string[];
      lists: FieldCoverageEntry[][];
    }
  >();

  for (const { mappingId, result } of inputs) {
    for (const schema of result.schemas) {
      const key = `${schema.role} ${schema.schemaId}`;
      const existing = byRoleAndSchema.get(key);
      if (!existing) {
        byRoleAndSchema.set(key, {
          schemaId: schema.schemaId,
          role: schema.role,
          mappings: [mappingId],
          lists: [schema.fields],
        });
        continue;
      }
      if (!existing.mappings.includes(mappingId)) existing.mappings.push(mappingId);
      existing.lists.push(schema.fields);
    }
  }

  const schemas: AggregateSchemaCoverage[] = [];
  for (const { schemaId, role, mappings, lists } of byRoleAndSchema.values()) {
    const fields = unionFieldCoverage(lists);
    schemas.push({ schemaId, role, mappings, fields, totals: summarizeFieldCoverage(fields) });
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
 * Merge one input's field entries into the accumulated list, copying rather
 * than aliasing so the caller's entries are never mutated.
 *
 * `mapped` is OR-ed — that is the union rule. A field the accumulator has not
 * seen is appended, which only happens when two inputs resolved the same schema
 * id to different definitions; keeping it is safer than dropping a declared
 * field from the report.
 *
 * `state` is re-derived from the OR-ed `mapped` rather than merged, because a
 * merged state would be the *first* input's answer to a question the union has
 * since changed: a leaf mapping A ignores and mapping B writes is covered, and
 * leaving `state: "uncovered"` on it beside `mapped: true` contradicts the
 * documented invariant that the two always agree. The binary form applied here
 * is right for a leaf and provisional for a container, whose real unioned state
 * can only be read off the unioned *leaves* — which is why
 * {@link recomputeContainerStates} runs once afterwards, overwriting it. Both
 * happen inside {@link unionFieldCoverage}, the only caller.
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
    existing.state = existing.mapped ? "covered" : "uncovered";
    // Tier unions toward the stronger claim: a field one mapping declares and
    // another only mentions in prose is declared-covered in the aggregate
    // (ADR-036). Without this the aggregate could report a declared field as
    // merely inferred, purely on mapping order.
    const tier = strongerTier(existing.tier, field.tier);
    if (tier !== undefined) existing.tier = tier;
    else delete existing.tier;
  }
}

/**
 * Recompute every container's tri-state from the unioned leaves beneath it.
 *
 * A container's state cannot be unioned the way a leaf's can. Two inputs that
 * each cover half of `address` both report it `partial`; the union must
 * report `covered`, because between them every leaf is written. Taking the
 * strongest per-input state would say `partial`, understating the union;
 * OR-ing `mapped` alone would lose the distinction entirely. So the union
 * happens on leaves, where it is well defined, and containers are derived from
 * the result — the same rule `coverageForField` applies per mapping, restated
 * over a flat list because that is the shape the union holds.
 *
 * Mutates `fields` in place. Leaf entries are left exactly as unioned.
 *
 * The units rolled up are the entries with nothing declared beneath them, which
 * is **not** the same set as {@link leafFieldEntries}: an empty `record {}` has
 * no descendants and so is a unit here, while being a container for counting.
 * Its state is decided on its own path (`coverageForField`), so it unions like a
 * leaf and must carry its verdict upward — a record whose children are all empty
 * records would otherwise have no units at all and keep the OR-ed state
 * `unionInto` left behind, reporting `covered` where one of two children is a gap.
 */
function recomputeContainerStates(fields: FieldCoverageEntry[]): void {
  const paths = new Set(fields.map((f) => f.path));
  const units = new Set(fields.filter((f) => !hasDescendant(f.path, paths)).map((f) => f.path));

  // Tally each unit against every container it sits beneath, so one pass over
  // them settles every ancestor at every depth.
  const tallies = new Map<string, { total: number; covered: number; tier?: CoverageTier }>();
  for (const field of fields) {
    if (!units.has(field.path)) continue;
    for (let dot = field.path.indexOf("."); dot !== -1; dot = field.path.indexOf(".", dot + 1)) {
      const container = field.path.slice(0, dot);
      const tally = tallies.get(container) ?? { total: 0, covered: 0 };
      tally.total += 1;
      if (field.mapped) {
        tally.covered += 1;
        tally.tier = strongerTier(tally.tier, field.tier);
      }
      tallies.set(container, tally);
    }
  }

  for (const field of fields) {
    const tally = tallies.get(field.path);
    if (!tally) continue; // a unit: a leaf, or an empty record judged on its own path
    field.state =
      tally.covered === tally.total ? "covered" : tally.covered === 0 ? "uncovered" : "partial";
    field.mapped = field.state !== "uncovered";
    if (tally.tier !== undefined) field.tier = tally.tier;
    else delete field.tier;
  }
}

/** `declared` beats `nl` beats absent — see {@link CoverageTier}. */
function strongerTier(
  a: CoverageTier | undefined,
  b: CoverageTier | undefined,
): CoverageTier | undefined {
  if (a === "declared" || b === "declared") return "declared";
  if (a === "nl" || b === "nl") return "nl";
  return undefined;
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
