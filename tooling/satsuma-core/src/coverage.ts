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
 *   - source field: its name (or a path that starts with it) appears as a
 *     src_path in at least one arrow, each_block, or flatten_block inside the
 *     mapping.
 *   - target field: its name (or a path that starts with it) appears as a
 *     tgt_path in at least one arrow inside the mapping.
 *
 * Nested record fields are handled recursively. each_block and flatten_block
 * src-paths contribute both the top-level field and the qualified nested path.
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
import { addPathAndPrefixes, isCoveredFieldPath } from "./coverage-paths.js";
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

  // Collect all explicit arrow source paths and target paths from the mapping.
  const coveredSrcPaths = new Set<string>();
  const coveredTgtPaths = new Set<string>();
  collectBodyPaths(body, coveredSrcPaths, coveredTgtPaths);

  const schemas: SchemaCoverageResult[] = [];

  for (const schemaId of sourceIds) {
    const def = resolveSchema(schemaId);
    if (!def) continue;
    schemas.push({
      schemaId: def.schemaId ?? schemaId,
      role: "source",
      fields: buildFieldCoverage(def.fields, def.uri, "", coveredSrcPaths),
    });
  }

  for (const schemaId of targetIds) {
    const def = resolveSchema(schemaId);
    if (!def) continue;
    schemas.push({
      schemaId: def.schemaId ?? schemaId,
      role: "target",
      fields: buildFieldCoverage(def.fields, def.uri, "", coveredTgtPaths),
    });
  }

  return { schemas };
}

// ── Path collection ─────────────────────────────────────────────────────────

/**
 * Walk all arrows (including inside each/flatten) in the mapping body and
 * populate the covered src-path and tgt-path sets.
 */
function collectBodyPaths(
  body: SyntaxNode,
  srcPaths: Set<string>,
  tgtPaths: Set<string>,
): void {
  for (const node of body.namedChildren) {
    switch (node.type) {
      case "map_arrow":
        for (const sp of children(node, "src_path")) addPathAndPrefixes(srcPaths, pathText(sp));
        { const tp = child(node, "tgt_path"); if (tp) addPathAndPrefixes(tgtPaths, pathText(tp)); }
        break;
      case "computed_arrow":
        { const tp = child(node, "tgt_path"); if (tp) addPathAndPrefixes(tgtPaths, pathText(tp)); }
        break;
      case "each_block":
        collectEachPaths(node, srcPaths, tgtPaths, null, null);
        break;
      case "flatten_block":
        collectFlattenPaths(node, srcPaths, tgtPaths);
        break;
    }
  }
}

/**
 * Recursively collect paths from an each_block.
 * Arrows inside an each_block are relative to the iteration field.
 *
 * Nullability contract for outerSrcBase / outerTgtBase:
 *   null     — no enclosing each_block has established a base path yet; this
 *               is the top-level call for this each_block, so paths from the
 *               block's own src_path/tgt_path become the new base.
 *   non-null — an enclosing each_block already established a prefix; paths in
 *               this nested block are qualified relative to that prefix via
 *               qualify(outerBase, localPath).
 *
 * Recursive call sites pass srcBase/tgtBase (the base resolved for this level)
 * as the outer values for any nested each_blocks found within this node.
 */
function collectEachPaths(
  node: SyntaxNode,
  srcPaths: Set<string>,
  tgtPaths: Set<string>,
  outerSrcBase: string | null,
  outerTgtBase: string | null,
): void {
  const rawSrc = child(node, "src_path");
  const rawTgt = child(node, "tgt_path");
  const srcBase = rawSrc ? qualify(outerSrcBase, pathText(rawSrc)) : outerSrcBase;
  const tgtBase = rawTgt ? qualify(outerTgtBase, pathText(rawTgt)) : outerTgtBase;

  if (srcBase) addPathAndPrefixes(srcPaths, srcBase);
  if (tgtBase) addPathAndPrefixes(tgtPaths, tgtBase);

  for (const ch of node.namedChildren) {
    if (ch.type === "map_arrow") {
      for (const sp of children(ch, "src_path")) {
        const leaf = pathText(sp);
        addPathAndPrefixes(srcPaths, srcBase ? qualify(srcBase, leaf) : leaf);
      }
      const tp = child(ch, "tgt_path");
      if (tp) {
        const leaf = pathText(tp);
        addPathAndPrefixes(tgtPaths, tgtBase ? qualify(tgtBase, leaf) : leaf);
      }
    } else if (ch.type === "computed_arrow") {
      const tp = child(ch, "tgt_path");
      if (tp) {
        const leaf = pathText(tp);
        addPathAndPrefixes(tgtPaths, tgtBase ? qualify(tgtBase, leaf) : leaf);
      }
    } else if (ch.type === "each_block") {
      collectEachPaths(ch, srcPaths, tgtPaths, srcBase, tgtBase);
    }
  }
}

/**
 * Collect paths from a flatten_block.
 *
 * Unlike each_block, only the *source* side has a base path: flatten unnests a
 * source list into flat target fields, so target paths inside the block are
 * already schema-root-relative and must not be prefixed.
 */
function collectFlattenPaths(
  node: SyntaxNode,
  srcPaths: Set<string>,
  tgtPaths: Set<string>,
): void {
  const rawSrc = child(node, "src_path");
  const srcBase = rawSrc ? pathText(rawSrc) : null;
  if (srcBase) addPathAndPrefixes(srcPaths, srcBase);

  for (const ch of node.namedChildren) {
    if (ch.type === "map_arrow") {
      for (const sp of children(ch, "src_path")) {
        const leaf = pathText(sp);
        addPathAndPrefixes(srcPaths, srcBase ? qualify(srcBase, leaf) : leaf);
      }
      const tp = child(ch, "tgt_path");
      if (tp) addPathAndPrefixes(tgtPaths, pathText(tp));
    } else if (ch.type === "computed_arrow") {
      const tp = child(ch, "tgt_path");
      if (tp) addPathAndPrefixes(tgtPaths, pathText(tp));
    }
  }
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
