/**
 * coverage.ts — Mapping field coverage: which declared fields does a mapping touch?
 *
 * Owns the single definition of coverage semantics for the whole toolchain.
 * Given a parsed file and a mapping name, {@link computeMappingCoverage} walks
 * the mapping body, collects every source and target path the arrows reference,
 * and reports covered/uncovered status for every field of every participating
 * schema.
 *
 * "Covered" means:
 *   - source field: its qualified path from the schema root — or a path that
 *     starts with it — appears as a src_path in at least one arrow anywhere in
 *     the mapping.
 *   - target field: the same, as a tgt_path.
 *
 * Matching is by path, never by local field name: two records under one schema
 * routinely declare the same leaf name, and treating a name match as coverage
 * silently reported unmapped fields as mapped (sl-joeq). The corollary is that
 * an arrow's schema prefix has to be resolved away before matching, which is
 * what {@link coverageForSchema} does.
 *
 * Nested record fields are handled recursively. Arrows nest inside three
 * container blocks — `each`, `flatten` and a braced `src -> tgt` (`nested_arrow`)
 * — which the grammar allows to interleave to any depth, so the walk recurses
 * uniformly over all three rather than enumerating what each may contain
 * (sl-qzy3). A container's own src/tgt count as touched and become the prefixes
 * for the arrows inside it.
 *
 * Coverage is deliberately *structural only*: a field a note block describes in
 * prose is uncovered by definition. NL interpretation belongs to nl-refs, and
 * policy judgements ("optional fields shouldn't count") belong to lint.
 *
 * This module does not own an index. Callers supply a {@link CoverageSchemaResolver}
 * that adapts their own workspace model — the LSP's `WorkspaceIndex`, the CLI's
 * `ExtractedWorkspace`, or a browser-side viz model — to the minimal field-tree
 * shape the walk needs. That keeps the semantics here and the plumbing there.
 *
 * Path-set expansion rules live in coverage-paths.ts.
 */

import { child, children, labelText, sourceRefStructuralText } from "./cst-utils.js";
import { buildCoveredFieldSet, isCoveredFieldPath, schemaLocalFieldPath } from "./coverage-paths.js";
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
  /** True when at least one arrow in the mapping covers this field. */
  mapped: boolean;
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
 */
export function computeMappingCoverage(
  tree: Tree,
  mappingName: string,
  resolveSchema: CoverageSchemaResolver,
): MappingCoverageResult {
  const mappingNode = findMappingBlock(tree, mappingName);
  if (!mappingNode) return { schemas: [] };

  const body = child(mappingNode, "mapping_body");
  if (!body) return { schemas: [] };

  const sourceIds = getSchemaIdsFromBlock(body, "source_block");
  const targetIds = getSchemaIdsFromBlock(body, "target_block");

  // Arrow references as authored, container-qualified but still carrying any
  // schema prefix — that prefix can only be stripped once we know which schema
  // we are reporting on, so resolution happens per schema below.
  const srcRefs: string[] = [];
  const tgtRefs: string[] = [];
  collectBodyPaths(body, srcRefs, tgtRefs);

  const schemas: SchemaCoverageResult[] = [];

  for (const schemaId of sourceIds) {
    const def = resolveSchema(schemaId);
    if (!def) continue;
    schemas.push(coverageForSchema(def, schemaId, "source", srcRefs, sourceIds));
  }

  for (const schemaId of targetIds) {
    const def = resolveSchema(schemaId);
    if (!def) continue;
    schemas.push(coverageForSchema(def, schemaId, "target", tgtRefs, targetIds));
  }

  return { schemas };
}

/**
 * Report one schema, resolving the mapping's authored arrow references into
 * paths local to it before matching them against its declared fields.
 */
function coverageForSchema(
  def: CoverageSchemaDefinition,
  writtenRef: string,
  role: "source" | "target",
  arrowRefs: readonly string[],
  participatingRefs: readonly string[],
): SchemaCoverageResult {
  // An arrow may name this schema by the reference as written in the mapping or
  // by the id the resolver canonicalised it to, so both forms must resolve.
  const canonicalRef = def.schemaId ?? writtenRef;
  const ownRefs = canonicalRef === writtenRef ? [writtenRef] : [writtenRef, canonicalRef];
  const otherRefs = participatingRefs.filter((ref) => ref !== writtenRef);

  const topLevelNames = new Set(def.fields.map((f) => f.name));
  const declaresTopLevel = (name: string): boolean => topLevelNames.has(name);

  const localPaths: string[] = [];
  for (const ref of arrowRefs) {
    const local = schemaLocalFieldPath(ref, ownRefs, otherRefs, declaresTopLevel);
    if (local !== null) localPaths.push(local);
  }

  return {
    schemaId: canonicalRef,
    role,
    fields: buildFieldCoverage(def.fields, def.uri, "", buildCoveredFieldSet(localPaths)),
  };
}

// ── Path collection ─────────────────────────────────────────────────────────

/**
 * Path prefixes established by the enclosing container, or null at mapping-body
 * level. A container's own — already qualified — source and target become the
 * bases for its children, accumulating across arbitrary depth.
 */
interface PathBases {
  /** Absolute source path of the enclosing container, null at body level. */
  src: string | null;
  /** Absolute target path of the enclosing container, null at body level. */
  tgt: string | null;
}

/**
 * Block types that declare one src/tgt pair plus a body of further block items.
 *
 * All three are walked through one shared branch rather than each parent
 * enumerating the children it permits. That enumeration is what caused
 * `flatten` inside `each` and `nested_arrow` anywhere to be silently dropped
 * from coverage (sl-qzy3): the grammar's `_nested_block_item` allows any of
 * these inside any of them, so a walk that lists cases per parent falls out of
 * step with the grammar the moment a construct is added.
 */
const CONTAINER_BLOCK_TYPES = new Set(["each_block", "flatten_block", "nested_arrow"]);

/**
 * Walk every arrow in the mapping body — including those nested inside
 * containers to arbitrary depth — and collect the src/tgt references it makes.
 *
 * References come out container-qualified but otherwise as authored: any schema
 * prefix is left on, because which prefix is strippable depends on the schema
 * being reported. {@link coverageForSchema} resolves that per schema.
 */
function collectBodyPaths(
  body: SyntaxNode,
  srcRefs: string[],
  tgtRefs: string[],
): void {
  collectBlockItemPaths(body.namedChildren, srcRefs, tgtRefs, { src: null, tgt: null });
}

/**
 * Collect references from a list of sibling block items, qualifying each against
 * the bases its enclosing container established.
 */
function collectBlockItemPaths(
  nodes: SyntaxNode[],
  srcRefs: string[],
  tgtRefs: string[],
  bases: PathBases,
): void {
  for (const node of nodes) {
    if (node.type === "map_arrow") {
      for (const sp of children(node, "src_path")) {
        srcRefs.push(qualify(bases.src, pathText(sp)));
      }
      const tp = child(node, "tgt_path");
      if (tp) tgtRefs.push(qualify(bases.tgt, pathText(tp)));
    } else if (node.type === "computed_arrow") {
      // Source-less arrow: the target is still populated by this mapping.
      const tp = child(node, "tgt_path");
      if (tp) tgtRefs.push(qualify(bases.tgt, pathText(tp)));
    } else if (CONTAINER_BLOCK_TYPES.has(node.type)) {
      collectContainerPaths(node, srcRefs, tgtRefs, bases);
    }
  }
}

/**
 * Record a container's own source and target, then recurse into its body with
 * those as the bases for the level below.
 */
function collectContainerPaths(
  node: SyntaxNode,
  srcRefs: string[],
  tgtRefs: string[],
  outer: PathBases,
): void {
  const rawSrc = child(node, "src_path");
  const rawTgt = child(node, "tgt_path");

  const src = rawSrc ? qualify(outer.src, pathText(rawSrc)) : outer.src;
  const tgt = containerTargetBase(node, rawTgt, outer.tgt);

  // The container's own paths count as touched: iterating a list consumes it,
  // and writing into one populates it.
  if (src) srcRefs.push(src);
  if (tgt) tgtRefs.push(tgt);

  collectBlockItemPaths(node.namedChildren, srcRefs, tgtRefs, { src, tgt });
}

/**
 * Resolve the target base a container establishes for its children.
 *
 * `each` and `nested_arrow` always establish one: their target names a field,
 * and the arrows inside are written against it.
 *
 * `flatten` is the exception, and the grammar says which case applies. In
 * spec §4.6's top-level form the target names the target *schema*
 * (`flatten contacts -> tgt`) and the block unnests into flat schema-root
 * fields, so there is no base and the named schema is not a field to register.
 * Written relative — `flatten parcels.contents -> .packed_items` inside an
 * `each` (examples/nested-iteration/pipeline.stm:100) — it names a list field
 * on the current element, and its arrows are relative to that. A
 * `relative_field_path` node is the authored signal separating the two.
 */
function containerTargetBase(
  node: SyntaxNode,
  rawTgt: SyntaxNode | null,
  outerTgt: string | null,
): string | null {
  if (!rawTgt) return outerTgt;
  if (node.type === "flatten_block" && !isRelativePath(rawTgt)) return outerTgt;
  return qualify(outerTgt, pathText(rawTgt));
}

/** True when a src_path/tgt_path was authored relative to the current element (`.field`). */
function isRelativePath(pathNode: SyntaxNode): boolean {
  return child(pathNode, "relative_field_path") !== null;
}

function qualify(base: string | null, leaf: string): string {
  return base ? `${base}.${leaf}` : leaf;
}

// ── Field coverage building ─────────────────────────────────────────────────

/**
 * Recursively build the FieldCoverageEntry list for a schema's fields.
 * `prefix` is the path from the schema root to the current level; record
 * fields emit an entry of their own *and* entries for every descendant.
 */
function buildFieldCoverage(
  fields: CoverageField[],
  uri: string,
  prefix: string,
  coveredPaths: Set<string>,
): FieldCoverageEntry[] {
  const result: FieldCoverageEntry[] = [];
  for (const f of fields) {
    const path = prefix ? `${prefix}.${f.name}` : f.name;
    const entry: FieldCoverageEntry = {
      path,
      uri,
      mapped: isCoveredFieldPath(path, coveredPaths),
    };
    // Omit `line` entirely when unknown rather than defaulting to 0 — see the
    // CoverageField.line contract.
    if (f.line !== undefined) entry.line = f.line;
    result.push(entry);
    if (f.children && f.children.length > 0) {
      result.push(...buildFieldCoverage(f.children, uri, path, coveredPaths));
    }
  }
  return result;
}

// ── CST helpers ─────────────────────────────────────────────────────────────

/** Find a `mapping` block by label, at file scope or inside a namespace block. */
function findMappingBlock(tree: Tree, name: string): SyntaxNode | null {
  for (const node of tree.rootNode.namedChildren) {
    if (node.type === "mapping_block" && labelText(node) === name) return node;
    if (node.type === "namespace_block") {
      for (const ch of node.namedChildren) {
        if (ch.type === "mapping_block" && labelText(ch) === name) return ch;
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

/**
 * Normalise a src_path / tgt_path node to a plain dotted path.
 *
 * Two normalisations, both required before the path can be qualified or
 * matched against a declared field path:
 *
 *  1. Backtick quoting is stripped (`` `order id` `` → `order id`).
 *  2. A leading `.` is stripped. Inside `each`/`flatten` blocks the spec writes
 *     element-relative paths as `.SKU` (spec §4.6), which the grammar parses as
 *     `relative_field_path`. Keeping the dot would make qualify() produce
 *     `items..SKU`, whose declared counterpart `items.SKU` then never matches —
 *     so every nested field inside an each/flatten block would be reported
 *     uncovered despite an explicit arrow (sc-xnxp). The CLI's arrow index
 *     already applies the same `^\.` strip in buildFieldArrows().
 */
function pathText(node: SyntaxNode): string {
  const text = node.text;
  const unquoted = text.startsWith("`") && text.endsWith("`") ? text.slice(1, -1) : text;
  return unquoted.startsWith(".") ? unquoted.slice(1) : unquoted;
}
