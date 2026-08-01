/**
 * coverage.ts — Mapping field coverage: which declared fields does a mapping touch?
 *
 * Owns the single definition of coverage semantics for the whole toolchain.
 * Given a parsed file and a mapping name, {@link computeMappingCoverage} reads
 * every source and target path the mapping's arrows reference and reports
 * covered/uncovered status for every field of every participating schema.
 *
 * "Covered" means:
 *   - source field: its qualified path from the schema root — or a path that
 *     starts with it — appears as a src_path in at least one arrow anywhere in
 *     the mapping, **or** is named by a resolved NL `@ref` in that mapping.
 *   - target field: the same, as a tgt_path.
 *
 * The two are reported as distinct tiers over one denominator (ADR-036): a
 * resolved `@ref` carries the same lineage weight as a declared source field
 * (ADR-013), which `arrows`, `graph`, `lineage`, `field-lineage` and `lint` have
 * always honoured and coverage alone did not. See {@link CoverageTier}.
 *
 * Matching is by path, never by local field name: two records under one schema
 * routinely declare the same leaf name, and treating a name match as coverage
 * silently reported unmapped fields as mapped (sl-joeq). The corollary is that
 * an arrow's schema prefix has to be resolved away before matching, which is
 * what {@link coverageForSchema} does.
 *
 * **This module does not walk the CST for arrows.** It asks extract.ts, via
 * `extractMappingArrowRecords()`, and resolves what comes back. It used to keep
 * its own walk, and that duplication produced four defects — relative dots
 * unstripped (sc-xnxp), `flatten` inside `each` and `nested_arrow` never visited
 * (sl-qzy3), and schema prefixes never resolved (sl-joeq) — every one of them a
 * rule extraction already applied, every one found by inspection rather than by
 * a test. Coverage owns *what counts as covered*; extraction owns *what the
 * arrows say* — ADR-020's principle applied inside core, and the decision
 * recorded under PRD 38 R4. Adding a construct to the grammar or a new source of
 * references (spec §5's resolved NL @refs, ADR-036) is then one change, in
 * extract.ts, rather than two that can disagree.
 *
 * Coverage follows *explicit references only*. Resolving `@net_amount` to a
 * declared field is structural resolution of a reference the author marked with
 * a sigil — it reads no surrounding prose, which is why counting it does not
 * make coverage an NL interpreter (ADR-036). A field that prose merely describes
 * without an `@ref`, and a ref that resolves to nothing, both remain uncovered:
 * unresolved refs are `lint`'s `unresolved-nl-ref`, and letting them count would
 * make coverage rise when a spec breaks. Policy judgements ("optional fields
 * shouldn't count") still belong to lint.
 *
 * This module does not own an index either. Callers supply a
 * {@link CoverageSchemaResolver} that adapts their own workspace model — the
 * LSP's `WorkspaceIndex`, the CLI's `ExtractedWorkspace`, or a browser-side viz
 * model — to the minimal field-tree shape the walk needs. That keeps the
 * semantics here and the plumbing there.
 *
 * Path-set expansion and schema-prefix rules live in coverage-paths.ts.
 */

import { child, children, labelText, sourceRefStructuralText } from "./cst-utils.js";
import { buildCoveredFieldPaths, isCoveredPath, schemaLocalFieldPath } from "./coverage-paths.js";
import type { CoveredFieldPaths } from "./coverage-paths.js";
import { extractMappingArrowRecords } from "./extract.js";
import type { ResolvedNLRef } from "./nl-ref.js";
import type { SyntaxNode, Tree } from "./types.js";

// ── Resolver input contract ─────────────────────────────────────────────────

/**
 * The minimum a consumer must expose about one declared field.
 *
 * Deliberately narrower than either the CLI's `FieldDecl` or the LSP's
 * `FieldInfo`: coverage needs a name to build the path, children to recurse,
 * and (optionally) a declaration row so downstream UIs can offer a jump link.
 */
export interface CoverageField {
  /** Field name as declared, with Satsuma backtick quoting already stripped. */
  name: string;
  /** Nested declarations for record / list_of record fields. */
  children?: CoverageField[];
  /**
   * 0-indexed declaration row within the file identified by
   * {@link CoverageSchemaDefinition.uri}. Omit it when the consumer has no
   * trustworthy position — never substitute 0, which reads as "line 1" and
   * sends editor-jump links to the wrong place.
   */
  line?: number;
}

/** One schema resolved for coverage: where it is declared and what it declares. */
export interface CoverageSchemaDefinition {
  /** File URI (LSP) or absolute path (CLI) of the declaring file. */
  uri: string;
  /** Top-level fields, in declaration order; nested fields hang off `children`. */
  fields: CoverageField[];
  /**
   * Canonical id to report for this schema, when it differs from the reference
   * as written in the mapping. Defaults to the written reference.
   *
   * Resolving a reference is the consumer's job, and the canonical id is an
   * output of that resolution: a namespaced workspace can name the same schema
   * `orders` inside its own namespace and `crm::orders` from outside. Reporting
   * both forms would split one schema into two entries when results are rolled
   * up across mappings, so a consumer that resolves references should report the
   * resolved key here.
   */
  schemaId?: string;
}

/**
 * Resolve a schema reference as written in a `source {}` / `target {}` block
 * (bare name or `ns::name`) to its definition, or null when it cannot be
 * resolved. Unresolvable schemas are skipped rather than reported: coverage
 * is not a validation pass, and `validate` already flags missing refs.
 */
export type CoverageSchemaResolver = (schemaId: string) => CoverageSchemaDefinition | null;

// ── Public result types ─────────────────────────────────────────────────────

/**
 * How a field came to be covered (ADR-036).
 *
 * `declared` — an arrow in the mapping references the field's path.
 * `nl` — a resolved NL `@ref` in the mapping names it, and no arrow does.
 *
 * The two are tiers over one denominator, not separate denominators: ADR-034
 * still governs what is counted. `declared` is the stronger claim and wins when
 * a field is covered both ways, so the tiers never double-count.
 *
 * Consumers must render the distinction rather than reconstruct it — an NL-derived
 * hop is inferred from prose, not declared, and a reviewer has to be able to see
 * which is which.
 */
export type CoverageTier = "declared" | "nl";

/**
 * Coverage status for a single field (leaf or record) in a schema.
 */
export interface FieldCoverageEntry {
  /** Qualified path from the schema root, e.g. "address" or "address.line1". */
  path: string;
  /** URI of the file where the schema is defined. */
  uri: string;
  /**
   * 0-indexed line number of the field declaration, propagated from
   * {@link CoverageField.line}. Absent when the consumer could not supply a
   * trustworthy position; consumers rendering jump links must handle that
   * rather than assume 0.
   */
  line?: number;
  /** True when an arrow or a resolved `@ref` in the mapping covers this field. */
  mapped: boolean;
  /**
   * Which tier covered it. Absent exactly when `mapped` is false — the two
   * always agree, so a consumer may branch on either.
   */
  tier?: CoverageTier;
}

/**
 * Coverage results for all fields in one schema participating in a mapping.
 */
export interface SchemaCoverageResult {
  /** Identifier of the schema (bare name or ns::name). */
  schemaId: string;
  /** Whether this schema appears on the source or target side of the mapping. */
  role: "source" | "target";
  /** One entry per field (leaf and record nodes), in declaration order. */
  fields: FieldCoverageEntry[];
}

/**
 * Top-level coverage result for a named mapping — all participating schemas.
 */
export interface MappingCoverageResult {
  /** One entry per schema referenced in source{} or target{} blocks. */
  schemas: SchemaCoverageResult[];
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Compute per-field coverage for one named mapping in one parsed file.
 *
 * Returns `{ schemas: [] }` when the mapping is not found in this tree or has
 * no body — callers scoping by mapping name should check for that rather than
 * treat an empty result as "nothing is covered". A schema the resolver cannot
 * resolve is omitted from the result entirely.
 *
 * @param tree         Parse tree of the file declaring the mapping.
 * @param mappingName  Mapping label to report on; matched against top-level
 *                     and namespaced `mapping` blocks in this tree.
 * @param resolveSchema Adapter from the caller's index to field trees.
 * @param nlRefs       Resolved NL `@refs` for the workspace, from
 *                     `resolveAllNLRefs()`. Those belonging to this mapping
 *                     contribute `nl`-tier coverage (ADR-036). Omit — or pass an
 *                     empty array — for declared-tier coverage only; note that
 *                     omitting it under-reports any mapping whose sources appear
 *                     only in prose, which is the whole reason the tier exists.
 */
export function computeMappingCoverage(
  tree: Tree,
  mappingName: string,
  resolveSchema: CoverageSchemaResolver,
  nlRefs: readonly ResolvedNLRef[] = [],
): MappingCoverageResult {
  const found = findMappingBlock(tree, mappingName);
  if (!found) return { schemas: [] };

  const body = child(found.node, "mapping_body");
  if (!body) return { schemas: [] };

  const sourceIds = getSchemaIdsFromBlock(body, "source_block");
  const targetIds = getSchemaIdsFromBlock(body, "target_block");

  // Arrow references as authored: absolute (extraction has already applied every
  // enclosing container's prefix and stripped element-relative dots) but still
  // carrying any schema prefix, which can only be stripped once we know which
  // schema we are reporting on. Resolution therefore happens per schema below.
  //
  // The `each`/`flatten`/`nested_arrow` container itself yields a record too, so
  // a container's own source and target are registered as touched: iterating a
  // list consumes it, and writing into one populates it.
  const arrows = extractMappingArrowRecords(found.node);
  const declaredSrc = arrows.flatMap((a) => a.sources);
  const declaredTgt = arrows.map((a) => a.target).filter((t): t is string => t !== null);

  const nl = nlRefFieldPaths(nlRefs, found.mappingKey);

  const schemas: SchemaCoverageResult[] = [];

  for (const schemaId of sourceIds) {
    const def = resolveSchema(schemaId);
    if (!def) continue;
    schemas.push(coverageForSchema(def, schemaId, "source", sourceIds, declaredSrc, nl.anyContext));
  }

  for (const schemaId of targetIds) {
    const def = resolveSchema(schemaId);
    if (!def) continue;
    schemas.push(coverageForSchema(def, schemaId, "target", targetIds, declaredTgt, nl.arrowBodyOnly));
  }

  return { schemas };
}

// ── Resolved NL @ref paths (ADR-036) ────────────────────────────────────────

/**
 * The canonical field paths a mapping's resolved `@refs` name, split by whether
 * a target schema may claim them.
 *
 * Only `kind: "field"` resolutions are field references at all — a ref naming a
 * schema, fragment or transform covers no field. Only *resolved* refs count:
 * letting an unresolved ref count would make coverage rise when a spec breaks,
 * and reporting one is `lint`'s `unresolved-nl-ref` (ADR-036).
 */
interface NLRefPaths {
  /**
   * Every resolved field ref in the mapping. Source schemas may claim any of
   * them: a ref in a join condition demonstrates the mapping reads that field.
   */
  anyContext: string[];
  /**
   * Refs from arrow bodies and note blocks only — `context: "source_block"`
   * excluded. A join condition or filter names no *target* field, so it can
   * never contribute target coverage (ADR-036).
   */
  arrowBodyOnly: string[];
}

function nlRefFieldPaths(nlRefs: readonly ResolvedNLRef[], mappingKey: string): NLRefPaths {
  const anyContext: string[] = [];
  const arrowBodyOnly: string[] = [];

  for (const ref of nlRefs) {
    if (ref.mapping !== mappingKey) continue;
    if (!ref.resolved || ref.resolvedTo?.kind !== "field") continue;
    anyContext.push(ref.resolvedTo.name);
    if (ref.context !== "source_block") arrowBodyOnly.push(ref.resolvedTo.name);
  }

  return { anyContext, arrowBodyOnly };
}

/**
 * Report one schema, resolving the mapping's references into paths local to it
 * before matching them against its declared fields.
 *
 * Declared and NL references are resolved separately and kept in separate sets,
 * because the tier a field is reported under depends on which set matched.
 */
function coverageForSchema(
  def: CoverageSchemaDefinition,
  writtenRef: string,
  role: "source" | "target",
  participatingRefs: readonly string[],
  declaredRefs: readonly string[],
  nlRefPaths: readonly string[],
): SchemaCoverageResult {
  // A reference may name this schema by the form written in the mapping or by the
  // id the resolver canonicalised it to, so both must resolve.
  const canonicalRef = def.schemaId ?? writtenRef;
  const ownRefs = canonicalRef === writtenRef ? [writtenRef] : [writtenRef, canonicalRef];
  const otherRefs = participatingRefs.filter((ref) => ref !== writtenRef);

  const topLevelNames = new Set(def.fields.map((f) => f.name));
  const declaresTopLevel = (name: string): boolean => topLevelNames.has(name);
  const toLocal = (ref: string): string | null =>
    schemaLocalFieldPath(ref, ownRefs, otherRefs, declaresTopLevel);

  const declaredLocal: string[] = [];
  for (const ref of declaredRefs) {
    const local = toLocal(ref);
    if (local !== null) declaredLocal.push(local);
  }

  // A resolved @ref is always fully schema-qualified, so it belongs to this
  // schema only if the prefix actually came off. Requiring that — rather than
  // accepting the fall-through — keeps another schema's refs out of this set
  // instead of parking unmatchable paths in it.
  const nlLocal: string[] = [];
  for (const ref of nlRefPaths) {
    const local = toLocal(ref);
    if (local !== null && local !== ref) nlLocal.push(local);
  }

  return {
    schemaId: canonicalRef,
    role,
    fields: buildFieldCoverage(def.fields, def.uri, "", {
      declared: buildCoveredFieldPaths(declaredLocal),
      nl: buildCoveredFieldPaths(nlLocal),
    }),
  };
}

// ── Field coverage building ─────────────────────────────────────────────────

/** The covered-path models for one schema, one per tier (ADR-036). */
interface TieredCoveredPaths {
  declared: CoveredFieldPaths;
  nl: CoveredFieldPaths;
}

/**
 * Recursively build the FieldCoverageEntry list for a schema's fields.
 * `prefix` is the path from the schema root to the current level; record
 * fields emit an entry of their own *and* entries for every descendant.
 *
 * A field in both models is reported as `declared`: declared coverage is the
 * stronger claim, and reporting the weaker one would let a field that an arrow
 * genuinely writes read as merely inferred from prose (ADR-036).
 *
 * Probes ask {@link isCoveredPath} — direct or ancestor-of-direct, the same
 * boolean the flat set always answered. The model's stronger query (a leaf
 * inheriting from a *directly* covered record, `hasDirectlyCoveredAncestor`)
 * is deliberately not consulted yet: the direct set still records each/flatten
 * iteration subjects as direct paths, and inheriting through those would
 * manufacture coverage from every `each` header. sl-r6b0 makes the direct set
 * kind-aware and turns the query on (PRD 38 R5, 3cc-iedv).
 */
function buildFieldCoverage(
  fields: CoverageField[],
  uri: string,
  prefix: string,
  covered: TieredCoveredPaths,
): FieldCoverageEntry[] {
  const result: FieldCoverageEntry[] = [];
  for (const f of fields) {
    const path = prefix ? `${prefix}.${f.name}` : f.name;
    const tier: CoverageTier | undefined = isCoveredPath(path, covered.declared)
      ? "declared"
      : isCoveredPath(path, covered.nl)
        ? "nl"
        : undefined;
    const entry: FieldCoverageEntry = { path, uri, mapped: tier !== undefined };
    if (tier !== undefined) entry.tier = tier;
    // Omit `line` entirely when unknown rather than defaulting to 0 — see the
    // CoverageField.line contract.
    if (f.line !== undefined) entry.line = f.line;
    result.push(entry);
    if (f.children && f.children.length > 0) {
      result.push(...buildFieldCoverage(f.children, uri, path, covered));
    }
  }
  return result;
}

// ── CST helpers ─────────────────────────────────────────────────────────────

/** A located `mapping` block, with the key its resolved NL refs are filed under. */
interface LocatedMapping {
  node: SyntaxNode;
  /**
   * Namespace-qualified mapping key (`crm::load`), or the bare label at file
   * scope — the same key `resolveAllNLRefs` writes to `ResolvedNLRef.mapping`.
   *
   * Matching refs on this rather than on the label alone is what keeps two
   * same-named mappings in different namespaces apart. They are different
   * mappings, and crediting one with the other's refs would be a silent
   * over-count of exactly the kind ADR-036's "only resolved refs" rule guards.
   */
  mappingKey: string;
}

/** Find a `mapping` block by label, at file scope or inside a namespace block. */
function findMappingBlock(tree: Tree, name: string): LocatedMapping | null {
  for (const node of tree.rootNode.namedChildren) {
    if (node.type === "mapping_block" && labelText(node) === name) {
      return { node, mappingKey: name };
    }
    if (node.type === "namespace_block") {
      // A namespace's name is its first `identifier` child, not a label — the
      // same read extract.ts's collectFromNamespaces() does, so the key built
      // here matches the one resolveAllNLRefs() files refs under.
      const namespace = node.namedChildren.find((c) => c.type === "identifier")?.text ?? null;
      for (const ch of node.namedChildren) {
        if (ch.type === "mapping_block" && labelText(ch) === name) {
          return { node: ch, mappingKey: namespace ? `${namespace}::${name}` : name };
        }
      }
    }
  }
  return null;
}

/** Schema references declared in the mapping's `source {}` or `target {}` block. */
function getSchemaIdsFromBlock(body: SyntaxNode, blockType: "source_block" | "target_block"): string[] {
  for (const node of body.namedChildren) {
    if (node.type === blockType) {
      const ids: string[] = [];
      for (const ref of children(node, "source_ref")) {
        const name = sourceRefStructuralText(ref);
        if (name) ids.push(name);
      }
      return ids;
    }
  }
  return [];
}
