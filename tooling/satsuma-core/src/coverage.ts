/**
 * coverage.ts — Mapping field coverage: which declared fields does a mapping touch?
 *
 * Owns the single definition of coverage semantics for the whole toolchain.
 * Given a parsed file and a mapping name, {@link computeMappingCoverage} reads
 * every source and target path the mapping's arrows reference and reports
 * covered/uncovered status for every field of every participating schema.
 *
 * "Covered" means:
 *   - source *leaf*: its qualified path from the schema root — or a path that
 *     starts with it — appears as a src_path in at least one arrow anywhere in
 *     the mapping, **or** is named by a resolved NL `@ref` in that mapping.
 *   - target *leaf*: the same, as a tgt_path.
 *   - *container* (a record or list-of-record field): computed from its
 *     descendant leaves and nothing else — see {@link FieldCoverageState}. A
 *     container never vouches for leaves nothing wrote, and never reads as
 *     uncovered while something beneath it is covered.
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
import type { ArrowDeclarationKind, ExtractedArrow } from "./extract.js";
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
 *
 * `mappingNamespace` is the namespace of the mapping being reported on, or null
 * at file scope — supplied because a reference is only resolvable relative to
 * where it was written: a bare `orders` inside `namespace crm` means
 * `crm::orders`. A resolver that ignores it resolves nothing for any namespaced
 * mapping whose references are unqualified, which is the normal way to write one;
 * the LSP's did, so the editor reported no coverage at all for those mappings
 * while the CLI reported them fine. Core passes it rather than leaving each
 * consumer to re-derive the mapping's namespace, which is work core has already
 * done by the time it calls this.
 *
 * A resolver that closes over the namespace itself may ignore the argument — the
 * CLI and viz adapters do, having taken it from their own indexes.
 */
export type CoverageSchemaResolver = (
  schemaId: string,
  mappingNamespace: string | null,
) => CoverageSchemaDefinition | null;

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
 * How much of a field is covered (PRD 38 R2).
 *
 * `covered` — every descendant leaf is covered. For a leaf, the field itself is.
 * `partial` — at least one descendant leaf is covered, but not all. **Containers
 *   only**: a leaf has nothing beneath it to be partly done, so it never reports
 *   this.
 * `uncovered` — no descendant leaf is covered.
 *
 * This replaces the two contradictory booleans that were in use: the LSP gutter
 * treated a record as mapped when *any* descendant was covered, while the CLI's
 * review queue excluded a record only when *all* of them were. Both are right for
 * their consumer and one boolean cannot carry both claims, so the tri-state
 * carries both and each consumer picks its threshold — the gutter paints on
 * `covered || partial`, the review queue lists anything not `covered`.
 */
export type FieldCoverageState = "covered" | "partial" | "uncovered";

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
  /**
   * True when an arrow or a resolved `@ref` in the mapping covers this field —
   * defined as `state !== "uncovered"`, so a partly covered record is `true`.
   *
   * Kept as its own field because it is the older, wider contract (the VS Code
   * gutter and the CLI review queue both read it), and it stays byte-identical
   * to what they have always received. New consumers that need to tell a partly
   * covered record from a fully covered one must read {@link state}.
   */
  mapped: boolean;
  /**
   * How much of this field is covered. For a leaf, `covered` or `uncovered`
   * only — never `partial`.
   */
  state: FieldCoverageState;
  /**
   * Which tier covered it. Absent exactly when `mapped` is false — the two
   * always agree, so a consumer may branch on either. A container reports the
   * strongest tier among its covered descendants, since that is the strongest
   * claim anything beneath it makes.
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

// ── Naming the mapping to report on ─────────────────────────────────────────

/**
 * Which mapping in a tree to report on, when a label alone will not do.
 *
 * A label is not an identity: two mappings may carry the same one in different
 * namespaces, and an anonymous `mapping { … }` block has none at all. Supplying
 * the parts a caller knows makes the match exact.
 *
 * Every field is optional, and each one supplied narrows the match:
 */
export interface MappingSelector {
  /**
   * Label as authored, backticks already stripped. `null` names an anonymous
   * mapping — but a label is not unique on its own, so pair it with
   * {@link namespace}, and use {@link row} for an anonymous block.
   */
  name?: string | null;
  /**
   * Namespace the mapping is declared in, or `null` for file scope. Matched
   * exactly when supplied: omitting it matches a mapping in any namespace, which
   * is what makes a bare label ambiguous.
   */
  namespace?: string | null;
  /**
   * 0-indexed CST start row of the `mapping` block. **Decisive when supplied** —
   * it identifies the block outright, so it is the form to use for an anonymous
   * mapping and the safest form for any consumer that already holds a position.
   */
  row?: number;
}

/**
 * How a caller names the mapping to report on: a label, or a
 * {@link MappingSelector} when the label is not enough to identify it.
 */
export type MappingTarget = string | MappingSelector;

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
 * @param target       Which mapping to report on. A bare label matches the first
 *                     block carrying it, in any namespace — pass a
 *                     {@link MappingSelector} to name one exactly, which any
 *                     caller holding a namespace or a position should do.
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
  target: MappingTarget,
  resolveSchema: CoverageSchemaResolver,
  nlRefs: readonly ResolvedNLRef[] = [],
): MappingCoverageResult {
  const found = findMappingBlock(tree, target);
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
  // list consumes it, and writing into one populates it. Whether that reference
  // reaches the container's *leaves* depends on the declaration kind — see
  // {@link ArrowFieldReference}.
  // Schemas are resolved once, up front, rather than inside the two report loops
  // below. The target side's whole-structure test has to ask what the *source*
  // path names (ADR-038), so the source field trees must be in hand before
  // `declaredTgt` is built.
  const sources = resolveParticipants(sourceIds, resolveSchema, found.namespace);
  const targets = resolveParticipants(targetIds, resolveSchema, found.namespace);

  const arrows = extractMappingArrowRecords(found.node);
  const declaredSrc = arrows.flatMap((a) =>
    a.sources.map((path) => ({ path, wholeStructure: declaresCorrespondence(a) })),
  );
  const declaredTgt = arrows
    .filter((a) => a.target !== null)
    .map((a) => ({
      path: a.target as string,
      // Target-side only: a record is populated wholesale by an arrow that
      // carries a record, not by one carrying a single scalar (ADR-038).
      wholeStructure: declaresCorrespondence(a) && namesAContainer(a.sources, sources),
    }));

  const nl = nlRefFieldPaths(nlRefs, found.mappingKey);

  const schemas: SchemaCoverageResult[] = [];

  for (const participant of sources) {
    schemas.push(coverageForSchema(participant, "source", sourceIds, declaredSrc, nl.anyContext));
  }

  for (const participant of targets) {
    schemas.push(
      coverageForSchema(participant, "target", targetIds, declaredTgt, nl.arrowBodyOnly),
    );
  }

  return { schemas };
}

/**
 * One schema a mapping names, paired with the definition the resolver returned.
 *
 * `writtenRef` is the form the mapping used; `def.schemaId` may canonicalise it,
 * and a reference can legitimately use either — so both are kept and both are
 * matched when a path's schema prefix is stripped.
 */
interface ParticipatingSchema {
  /** Schema id exactly as written in the mapping's `source{}`/`target{}` block. */
  writtenRef: string;
  /** The resolved field tree and its uri. */
  def: CoverageSchemaDefinition;
}

/**
 * Resolve the schemas on one side of a mapping, dropping any the resolver cannot
 * find.
 *
 * An unresolvable schema is omitted rather than reported: coverage is not a
 * validation pass, and `validate` owns missing-reference diagnostics. The
 * omission is also what makes an unresolvable *source* fail closed for
 * whole-structure expansion — see {@link namesAContainer}.
 */
function resolveParticipants(
  schemaIds: readonly string[],
  resolveSchema: CoverageSchemaResolver,
  mappingNamespace: string | null,
): ParticipatingSchema[] {
  const resolved: ParticipatingSchema[] = [];
  for (const writtenRef of schemaIds) {
    const def = resolveSchema(writtenRef, mappingNamespace);
    if (def) resolved.push({ writtenRef, def });
  }
  return resolved;
}

// ── Whole-structure arrows (PRD 38 R5, 3cc-iedv) ────────────────────────────

/**
 * One path a mapping's arrows reference, tagged with how much of it the
 * declaration asserts.
 */
interface ArrowFieldReference {
  /** Path as authored — absolute, but still carrying any schema prefix. */
  path: string;
  /**
   * True when the declaration asserts the *whole* structure at this path maps
   * (ADR-037). Two things must hold, and both are properties of the
   * declaration, not of the path.
   *
   * **Its kind must be `map` or `nested`.** These are the two shapes that state
   * a correspondence and nothing narrower: `addr -> address` says the structure
   * maps across, so reporting its leaves as gaps reports a gap the author
   * explicitly closed (3cc-iedv). A pipe-chain transform body does not change
   * that — spec §4.4 makes it a pipeline, not a nesting scope. The other kinds
   * name a container while asserting no correspondence at all:
   * `each items -> lines { … }` opens an iteration (the subject is registered
   * because iterating a list consumes it, but nothing is claimed about
   * `items.val`), and `-> containers { "no source data available" }` has no
   * source — inheriting from prose is what ADR-036 forbids, and the one such
   * arrow in the example corpus is flagged `//! DATA GAP` by its own author.
   *
   * **Its body must enumerate nothing.** A header that lists child arrows
   * narrows its claim to what it lists: `addr -> address { .street -> .line }`
   * says street maps, and says nothing about `zip`. Reading the header as
   * wholesale would report `zip` as covered when nothing writes it (sl-qzy3).
   *
   * **What is deliberately NOT checked: whether the field on the *other* side
   * is also a record.** The flag travels with the path, and the path is judged
   * against whichever schema is being reported on — so `crm.addr -> out` expands
   * `addr`'s leaves on the source side even though `out` is a scalar, and
   * `full_name -> address` expands `address`'s leaves on the target side even
   * though `full_name` is one. `coverageForSchema` reports on a single schema
   * and does not hold the counterpart's field tree, so a genuine
   * record-to-record test would mean resolving every participating schema up
   * front and pairing sides per arrow. The looser rule is the shipped one: it
   * reads correctly on the source side (a `map` arrow off a record consumes the
   * whole record) and generously on the target side, where a scalar-to-record
   * arrow credits every leaf of the record. Whether to tighten the target side
   * is `3ct-cs4y`, not something to infer from this comment.
   *
   * Getting the kind check wrong is not a rounding error: the direct set was
   * kind-blind until sl-r6b0, and turning inheritance on without the distinction
   * would have manufactured coverage for every leaf under every `each` header.
   */
  wholeStructure: boolean;
}

/**
 * The declaration kinds whose header asserts a correspondence over the whole
 * structure it names, rather than over the parts its body lists.
 *
 * Listed positively rather than as a negation, so a declaration kind added to
 * the grammar defaults to the conservative reading — a new construct asserts
 * nothing about a subtree until someone decides it does.
 */
const WHOLE_STRUCTURE_KINDS: readonly ArrowDeclarationKind[] = ["map", "nested"];

/**
 * True when the declaration states a correspondence over the whole structure it
 * names, rather than over the parts its body lists — condition 1 AND condition 2
 * of ADR-037, which are properties of the declaration alone.
 *
 * This is the whole test on the **source** side. The target side adds
 * {@link namesAContainer} on top of it (ADR-038).
 */
function declaresCorrespondence(arrow: ExtractedArrow): boolean {
  return WHOLE_STRUCTURE_KINDS.includes(arrow.kind) && !arrow.enumeratesChildren;
}

/**
 * True when at least one of these authored paths names a declared container in
 * one of the schemas on that side of the mapping.
 *
 * This is ADR-038's target-side condition: `addr -> address` populates the whole
 * of `address` because a record arrives; `full_name -> address` does not,
 * because one scalar cannot fill twelve leaves and the declaration says nothing
 * about which leaf it would fill. Without the test, coverage credits all twelve
 * — an overstatement in exactly the direction ADR-034 refused to risk, since it
 * is `covered` that `--fail-under` gates.
 *
 * **Any one container source is enough.** A multi-source arrow
 * (`addr, meta -> address`) asserts one correspondence built from several
 * inputs, and a record among them makes the whole-structure reading plausible.
 * Requiring all of them would turn a mixed arrow into a gap.
 *
 * **Fails closed.** A path naming nothing declared, or naming a schema the
 * resolver could not resolve (so absent from `schemas` entirely), is not
 * evidence of a record — so it does not confer. Under-counting is the safe
 * direction (ADR-034), and a source path that resolves to nothing is already
 * reported by `validate`'s `field-not-in-schema`.
 */
function namesAContainer(
  paths: readonly string[],
  schemas: readonly ParticipatingSchema[],
): boolean {
  const participatingRefs = schemas.map((s) => s.writtenRef);
  return paths.some((path) =>
    schemas.some((schema) => {
      const local = schemaLocalPath(path, schema, participatingRefs);
      return local !== null && declaredFieldKind(local, schema.def.fields) === "container";
    }),
  );
}

/**
 * Expand every whole-structure reference into the subtree it asserts, and return
 * the flat list of paths the covered-path model is built from.
 *
 * Expansion happens here, at set-build time, rather than as a wildcard probe
 * during the walk. The covered set stays a plain set of paths, so every existing
 * query over it — and every consumer holding the flat view — keeps working
 * without learning a new rule.
 *
 * A reference is expanded only if it resolves to a declared container: a path
 * naming a leaf, or naming nothing in this schema, contributes just itself.
 *
 * @param refs   Schema-local references, already stripped of any schema prefix.
 * @param fields This schema's declared field tree, the authority on what a
 *               subtree contains.
 */
function expandWholeStructureRefs(
  refs: readonly ArrowFieldReference[],
  fields: CoverageField[],
): string[] {
  const paths: string[] = [];
  for (const ref of refs) {
    paths.push(ref.path);
    if (!ref.wholeStructure) continue;
    paths.push(...descendantPathsOf(ref.path, fields));
  }
  return paths;
}

/**
 * Every path beneath `path` in the declared field tree, dotted from the schema
 * root — empty when the path names a leaf or is not declared here.
 *
 * Both records and their leaves are returned. The leaves are what coverage
 * counts; the intermediate records are returned so a conferred record reads as
 * `covered` in its own right rather than only through its descendants.
 */
function descendantPathsOf(path: string, fields: CoverageField[]): string[] {
  const found = findDeclaredField(path, fields);
  if (!found) return [];

  const paths: string[] = [];
  const collect = (children: CoverageField[], prefix: string): void => {
    for (const child of children) {
      const childPath = `${prefix}.${child.name}`;
      paths.push(childPath);
      if (child.children) collect(child.children, childPath);
    }
  };
  collect(found.children ?? [], path);
  return paths;
}

/**
 * The declared field a schema-local dotted path names, or null when the schema
 * declares no such path.
 *
 * The single walk of a {@link CoverageField} tree — {@link descendantPathsOf}
 * and {@link declaredFieldKind} both go through it, so "what does this path
 * name?" has one answer rather than one per caller.
 */
function findDeclaredField(path: string, fields: CoverageField[]): CoverageField | null {
  let level: CoverageField[] | undefined = fields;
  let found: CoverageField | undefined;
  for (const segment of path.split(".")) {
    found = level?.find((f) => f.name === segment);
    if (!found) return null;
    level = found.children;
  }
  return found ?? null;
}

/**
 * What a schema-local dotted path names in a declared field tree: a `container`
 * (a field with declared children — `record` or `list_of record`), a `leaf`, or
 * `null` when this schema declares no such path.
 *
 * Exported because "is this arrow endpoint a record?" is asked in two places
 * that must agree: coverage gates target-side subtree expansion on it
 * (ADR-038), and the CLI's `unenumerated-record-target` lint rule reports the
 * arrows that gate turns away. A second implementation would let the number and
 * the explanation for it drift apart.
 *
 * A container with no declared children reads as a `leaf`, matching the rule
 * `coverageForField` and `leafFieldEntries` apply when counting: as far as
 * coverage is concerned a record nothing is declared inside carries data of its
 * own.
 */
export function declaredFieldKind(
  path: string,
  fields: CoverageField[],
): "container" | "leaf" | null {
  const found = findDeclaredField(path, fields);
  if (!found) return null;
  return found.children && found.children.length > 0 ? "container" : "leaf";
}

/**
 * Reduce an authored arrow path to one local to `schema`, or null when it names
 * a different participating schema.
 *
 * Wraps {@link schemaLocalFieldPath} with the three inputs every caller has to
 * assemble the same way: the schema's two legitimate spellings (as written in
 * the mapping, and the id the resolver canonicalised it to), the other schemas
 * on that side, and whether the schema shadows a prefix with a top-level field
 * of the same name. Sharing it keeps `coverageForSchema` and
 * {@link namesAContainer} resolving prefixes identically — if they diverged, a
 * qualified arrow could confer a subtree in one and not the other.
 */
function schemaLocalPath(
  ref: string,
  schema: ParticipatingSchema,
  participatingRefs: readonly string[],
): string | null {
  const canonicalRef = schema.def.schemaId ?? schema.writtenRef;
  const ownRefs =
    canonicalRef === schema.writtenRef ? [schema.writtenRef] : [schema.writtenRef, canonicalRef];
  const otherRefs = participatingRefs.filter((r) => r !== schema.writtenRef);
  const topLevelNames = new Set(schema.def.fields.map((f) => f.name));
  return schemaLocalFieldPath(ref, ownRefs, otherRefs, (name) => topLevelNames.has(name));
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
  schema: ParticipatingSchema,
  role: "source" | "target",
  participatingRefs: readonly string[],
  declaredRefs: readonly ArrowFieldReference[],
  nlRefPaths: readonly string[],
): SchemaCoverageResult {
  const { def } = schema;
  // A reference may name this schema by the form written in the mapping or by the
  // id the resolver canonicalised it to, so both must resolve.
  const canonicalRef = def.schemaId ?? schema.writtenRef;
  const toLocal = (ref: string): string | null => schemaLocalPath(ref, schema, participatingRefs);

  const declaredLocal: ArrowFieldReference[] = [];
  for (const ref of declaredRefs) {
    const local = toLocal(ref.path);
    if (local !== null) declaredLocal.push({ path: local, wholeStructure: ref.wholeStructure });
  }

  // A resolved @ref is always fully schema-qualified, so it belongs to this
  // schema only if the prefix actually came off. Requiring that — rather than
  // accepting the fall-through — keeps another schema's refs out of this set
  // instead of parking unmatchable paths in it.
  //
  // NL refs never expand into a subtree: prose naming a record is a reference to
  // it, not a claim that every leaf beneath it maps (ADR-036).
  const nlLocal: string[] = [];
  for (const ref of nlRefPaths) {
    const local = toLocal(ref);
    if (local !== null && local !== ref) nlLocal.push(local);
  }

  return {
    schemaId: canonicalRef,
    role,
    fields: buildFieldCoverage(def.fields, def.uri, "", {
      declared: buildCoveredFieldPaths(expandWholeStructureRefs(declaredLocal, def.fields)),
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
 * Coverage entries for a declared field tree that no mapping touches: every
 * field `uncovered`, with the leaf and container rules applied as usual.
 *
 * Exists so "nothing covers this schema" is still an answer *this* module
 * produces. A consumer showing a schema no mapping references — the viz overview
 * renders one card per declared schema — still needs a denominator, and deriving
 * "0 of N" from its own count of the field tree is how a card ends up counting
 * containers into the ratio that ADR-034 excludes (sl-hcan).
 *
 * There is deliberately **no** entry point taking an arbitrary set of covered
 * paths. One existed, and it was the shape that let the viz keep deriving its
 * own covered set: a flat set of paths has thrown away the two things coverage
 * now needs — which tier covered a field (ADR-036) and whether an arrow's
 * declaration confers its whole subtree (ADR-037) — so anything built that way
 * silently under-reports both, as the viz card did on twelve shipped examples
 * (sl-46wr, sl-csrs). A consumer with real coverage to report must go through
 * {@link computeMappingCoverage}, which has the arrows and the resolved refs.
 */
export function uncoveredFieldCoverage(fields: CoverageField[], uri: string): FieldCoverageEntry[] {
  return buildFieldCoverage(fields, uri, "", {
    declared: buildCoveredFieldPaths([]),
    nl: buildCoveredFieldPaths([]),
  });
}

/**
 * Recursively build the FieldCoverageEntry list for a schema's fields.
 * `prefix` is the path from the schema root to the current level; record
 * fields emit an entry of their own *and* entries for every descendant, the
 * record's own entry first, all in declaration order.
 */
function buildFieldCoverage(
  fields: CoverageField[],
  uri: string,
  prefix: string,
  covered: TieredCoveredPaths,
): FieldCoverageEntry[] {
  return fields.flatMap((f) => coverageForField(f, uri, prefix, covered).entries);
}

/**
 * One field's coverage entry, the entries of everything beneath it, and the two
 * roll-up values its parent needs to compute its own state.
 *
 * The state and tier are returned alongside the flat entry list rather than
 * re-read from it, so the recursion never has to work out which of the returned
 * entries were *direct* children — a distinction the flat list has lost.
 */
interface FieldCoverageSubtree {
  /** This field's entry, followed by every descendant entry in declaration order. */
  entries: FieldCoverageEntry[];
  /** This field's coverage state. */
  state: FieldCoverageState;
  /** This field's tier, absent exactly when the state is `uncovered`. */
  tier?: CoverageTier;
}

/**
 * Coverage for one declared field and its subtree.
 *
 * A **leaf** is judged on its own path, by {@link isCoveredPath} — direct, or
 * the ancestor of a direct path deeper than the schema declares. A field in
 * both tiers is reported as `declared`: that is the stronger claim, and
 * reporting the weaker one would let a field an arrow genuinely writes read as
 * merely inferred from prose (ADR-036).
 *
 * A **container** is judged *only* on its descendant leaves — never on its own
 * path. That is what makes the tri-state trustworthy in both directions: a
 * container reference cannot manufacture leaf coverage (an `each parcels ->
 * .packed { }` with an empty body leaves `packed` uncovered, PRD 38 R2), and
 * `partial` propagates upward while `covered` does not (with only `a.b.x`
 * mapped, `a.b` and `a` are both partial).
 *
 * A whole-record arrow (`addr -> address`) still covers the record and all of
 * its leaves — but it does so by having been expanded into those leaves before
 * this walk began ({@link expandWholeStructureRefs}), which is the only way a
 * container can read as covered without vouching for leaves nothing wrote.
 */
function coverageForField(
  f: CoverageField,
  uri: string,
  prefix: string,
  covered: TieredCoveredPaths,
): FieldCoverageSubtree {
  const path = prefix ? `${prefix}.${f.name}` : f.name;
  const children = f.children ?? [];

  // A record with no declared children carries data of its own as far as
  // coverage is concerned, so it is judged as a leaf — the same rule
  // `leafFieldEntries` applies when counting.
  const subtrees =
    children.length > 0 ? children.map((c) => coverageForField(c, uri, path, covered)) : null;

  const { state, tier } = subtrees ? rollUpContainer(subtrees) : leafState(path, covered);

  const entry: FieldCoverageEntry = { path, uri, mapped: state !== "uncovered", state };
  if (tier !== undefined) entry.tier = tier;
  // Omit `line` entirely when unknown rather than defaulting to 0 — see the
  // CoverageField.line contract.
  if (f.line !== undefined) entry.line = f.line;

  const entries = [entry, ...(subtrees ?? []).flatMap((s) => s.entries)];
  return tier !== undefined ? { entries, state, tier } : { entries, state };
}

/** Coverage of a leaf: binary, decided by its own path in the two tiers. */
function leafState(
  path: string,
  covered: TieredCoveredPaths,
): { state: FieldCoverageState; tier?: CoverageTier } {
  if (isCoveredPath(path, covered.declared)) return { state: "covered", tier: "declared" };
  if (isCoveredPath(path, covered.nl)) return { state: "covered", tier: "nl" };
  return { state: "uncovered" };
}

/**
 * Coverage of a container, rolled up from its direct children.
 *
 * Rolling up from direct children rather than from all descendant leaves is
 * equivalent — each child already summarises its own leaves — and keeps the
 * recursion single-pass.
 */
function rollUpContainer(subtrees: FieldCoverageSubtree[]): {
  state: FieldCoverageState;
  tier?: CoverageTier;
} {
  const state: FieldCoverageState = subtrees.every((s) => s.state === "covered")
    ? "covered"
    : subtrees.every((s) => s.state === "uncovered")
      ? "uncovered"
      : "partial";
  if (state === "uncovered") return { state };
  // Declared beats NL, so a record holding one arrow-written leaf among prose-
  // referenced ones reports the stronger claim its subtree supports (ADR-036).
  const tier: CoverageTier = subtrees.some((s) => s.tier === "declared") ? "declared" : "nl";
  return { state, tier };
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
  /** Namespace the mapping is declared in, or null at file scope. */
  namespace: string | null;
}

/** One `mapping` block in the tree, paired with the namespace it is declared in. */
interface MappingCandidate {
  node: SyntaxNode;
  /** Enclosing namespace name, or null at file scope. */
  namespace: string | null;
  /** Label as authored, or null for an anonymous `mapping { … }` block. */
  label: string | null;
}

/**
 * Every `mapping` block in the tree, at file scope and inside namespaces, in
 * declaration order.
 *
 * A namespace's name is its first `identifier` child, not a label — the same
 * read extract.ts's `collectFromNamespaces()` does, so the keys built from it
 * match the ones `resolveAllNLRefs()` files refs under.
 */
function mappingCandidates(tree: Tree): MappingCandidate[] {
  const found: MappingCandidate[] = [];
  for (const node of tree.rootNode.namedChildren) {
    if (node.type === "mapping_block") {
      found.push({ node, namespace: null, label: labelText(node) });
      continue;
    }
    if (node.type === "namespace_block") {
      const namespace = node.namedChildren.find((c) => c.type === "identifier")?.text ?? null;
      for (const ch of node.namedChildren) {
        if (ch.type === "mapping_block") {
          found.push({ node: ch, namespace, label: labelText(ch) });
        }
      }
    }
  }
  return found;
}

/**
 * The NL-ref key for one mapping — what `resolveAllNLRefs` files its refs under.
 *
 * An anonymous mapping is keyed by its start row, matching
 * `extractMappingNLRefs`'s `<anon>@:<row>` synthesis, so a mapping with no label
 * can still be credited with the refs in its own body.
 */
function nlRefKeyFor(candidate: MappingCandidate): string {
  const name = candidate.label ?? `<anon>@:${candidate.node.startPosition.row}`;
  return candidate.namespace ? `${candidate.namespace}::${name}` : name;
}

/**
 * Locate the mapping a {@link MappingTarget} names.
 *
 * **A bare string matches by label alone, and that is ambiguous.** Two mappings
 * may share a label in different namespaces (viz-model's sl-aeae case), and the
 * first one declared wins the match — so the caller gets another mapping's
 * arrows judged against its own schemas, which reads as a plausible but wrong
 * figure rather than as an error. Callers that know which mapping they mean must
 * pass a {@link MappingSelector}; the string form is retained only for the LSP's
 * `satsuma/mappingCoverage` request, whose params carry a name and nothing else.
 *
 * A selector matches on the parts it supplies. `row` is decisive when given and
 * is the only way to name an anonymous mapping, which has no label to match.
 */
function findMappingBlock(tree: Tree, target: MappingTarget): LocatedMapping | null {
  const candidates = mappingCandidates(tree);

  if (typeof target === "string") {
    const match = candidates.find((c) => c.label === target);
    return match ? located(match) : null;
  }

  const match = candidates.find((c) => {
    if (target.namespace !== undefined && c.namespace !== target.namespace) return false;
    if (target.row !== undefined) return c.node.startPosition.row === target.row;
    return c.label === (target.name ?? null);
  });
  return match ? located(match) : null;
}

/** Project a matched candidate onto the shape the walk needs. */
function located(candidate: MappingCandidate): LocatedMapping {
  return {
    node: candidate.node,
    mappingKey: nlRefKeyFor(candidate),
    namespace: candidate.namespace,
  };
}

/** Schema references declared in the mapping's `source {}` or `target {}` block. */
function getSchemaIdsFromBlock(
  body: SyntaxNode,
  blockType: "source_block" | "target_block",
): string[] {
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
