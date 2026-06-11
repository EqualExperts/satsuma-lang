/**
 * extract.ts — CST extraction functions for Satsuma files
 *
 * Each function accepts a tree-sitter root node and returns structured data
 * extracted from the concrete syntax tree. Functions are pure (no I/O) so
 * they can be tested against mock CST objects.
 */

import { canonicalRef } from "./canonical-ref.js";
import { classifyTransform, classifyArrow } from "./classify.js";
import { extractMetadata } from "./meta-extract.js";
import { child, children, allDescendants, labelText, stringText, entryText, qualifiedNameText, sourceRefStructuralText, isPresent } from "./cst-utils.js";
import type { Classification, FieldDecl, MetaEntry, PipeStep, SyntaxNode } from "./types.js";

// ── Internal field tree ────────────────────────────────────────────────────

interface FieldTree {
  fields: FieldDecl[];
  hasSpreads: boolean;
  spreads: string[];
}

/**
 * Check whether a field_decl contains a "list_of" keyword token.
 */
function hasListOfKeyword(fd: SyntaxNode): boolean {
  if (fd.children) {
    for (const c of fd.children) {
      if (!c.isNamed && c.text === "list_of") return true;
    }
    return false;
  }
  const nameNode = child(fd, "field_name");
  const nameEnd = nameNode ? nameNode.text.length : 0;
  return fd.text.slice(nameEnd).trimStart().startsWith("list_of");
}

/**
 * Extract direct field_decl children of a body node.
 */
function extractDirectFields(bodyNode: SyntaxNode): FieldDecl[] {
  return children(bodyNode, "field_decl").map((fd) => {
    const nameNode = child(fd, "field_name");
    const typeNode = child(fd, "type_expr");
    const inner = nameNode?.namedChildren[0];
    let name = inner?.text ?? "";
    if (inner?.type === "backtick_name") name = name.slice(1, -1);
    const meta = extractMetadata(child(fd, "metadata_block"));
    const decl: FieldDecl = {
      name,
      type: typeNode?.text ?? "",
      startRow: fd.startPosition.row,
      startColumn: fd.startPosition.column,
    };
    if (meta.length > 0) decl.metadata = meta;
    return decl;
  });
}

/**
 * Extract the full field tree from a schema_body node.
 *
 * In unified field syntax, all declarations are field_decl nodes:
 * - scalar field: field_name type_expr metadata?
 * - record field: field_name "record" metadata? { schema_body }
 * - list_of record: field_name "list_of" "record" metadata? { schema_body }
 * - list_of scalar: field_name "list_of" type_expr metadata?
 *
 * Record/list_of record fields have a schema_body child.
 */
export function extractFieldTree(bodyNode: SyntaxNode): FieldTree {
  const fields: FieldDecl[] = [];
  let hasSpreads = false;
  const spreads: string[] = [];

  for (const c of bodyNode.namedChildren) {
    if (c.type === "field_decl") {
      const nameNode = child(c, "field_name");
      const typeNode = child(c, "type_expr");
      const innerBody = child(c, "schema_body");
      const inner = nameNode?.namedChildren[0];
      let name = inner?.text ?? "";
      if (inner?.type === "backtick_name") name = name.slice(1, -1);
      const meta = extractMetadata(child(c, "metadata_block"));

      if (innerBody) {
        const isList = hasListOfKeyword(c);
        const nested = extractFieldTree(innerBody);
        const decl: FieldDecl = {
          name,
          type: "record",
          isList,
          children: nested.fields,
          startRow: c.startPosition.row,
          startColumn: c.startPosition.column,
        };
        if (meta.length > 0) decl.metadata = meta;
        if (nested.hasSpreads) {
          decl.hasSpreads = true;
          decl.spreads = nested.spreads;
          hasSpreads = true;
        }
        fields.push(decl);
      } else {
        const isList = hasListOfKeyword(c);
        const hasRecordKeyword = c.children?.some((ch) => !ch.isNamed && ch.text === "record");
        if (hasRecordKeyword) {
          const decl: FieldDecl = {
            name,
            type: "record",
            isList: isList || undefined,
            children: [],
            startRow: c.startPosition.row,
            startColumn: c.startPosition.column,
          };
          if (meta.length > 0) decl.metadata = meta;
          fields.push(decl);
        } else {
          const decl: FieldDecl = {
            name,
            type: typeNode?.text ?? "",
            startRow: c.startPosition.row,
            startColumn: c.startPosition.column,
          };
          if (isList) decl.isList = true;
          if (meta.length > 0) decl.metadata = meta;
          fields.push(decl);
        }
      }
    } else if (c.type === "fragment_spread") {
      hasSpreads = true;
      const label = child(c, "spread_label");
      if (label) {
        spreads.push(spreadLabelText(label));
      }
    }
  }

  return { fields, hasSpreads, spreads };
}

/**
 * Extract the text from a spread_label node.
 * Handles qualified_name, backtick_name, and multi-word (identifier + continuation_word) forms.
 */
function spreadLabelText(labelNode: SyntaxNode): string {
  const qn = child(labelNode, "qualified_name");
  if (qn) return qualifiedNameText(qn)!;
  const q = child(labelNode, "backtick_name");
  if (q) return q.text.slice(1, -1);
  const words = labelNode.namedChildren
    .filter((c) => c.type === "identifier" || c.type === "continuation_word")
    .map((c) => c.text);
  return words.join(" ");
}

// Comment node types from the grammar extras list. These appear as named
// children in tree-sitter's namedChildren when they occur inside blocks, but
// they are not schema references and must be skipped during source/target extraction.
const COMMENT_NODE_TYPES = new Set(["comment", "warning_comment", "question_comment"]);

/**
 * Extract a structural source_ref name for mapping extraction and recover
 * through ERROR nodes during mid-edit tree-sitter states.
 *
 * Returns null for comment nodes — they are extras that appear as named
 * children in the CST but carry no source/target reference meaning (sl-bi92).
 */
function sourceRefNameNs(node: SyntaxNode | null | undefined): string | null {
  if (!node) return null;
  // Skip comment extras — they appear as named children in source/target blocks
  // but are not schema references.
  if (COMMENT_NODE_TYPES.has(node.type)) return null;
  if (node.type === "ERROR") {
    for (const c of node.namedChildren) {
      const result = sourceRefNameNs(c);
      if (result) return result;
    }
    return null;
  }
  if (node.type !== "source_ref") return entryText(node);
  return sourceRefStructuralText(node);
}

interface NamespaceCollected {
  node: SyntaxNode;
  namespace: string | null;
}

/**
 * Collect nodes of a given type from both top-level and inside namespace blocks.
 */
function collectFromNamespaces(rootNode: SyntaxNode, nodeType: string): NamespaceCollected[] {
  const results: NamespaceCollected[] = [];
  for (const c of rootNode.namedChildren) {
    if (c.type === nodeType) {
      results.push({ node: c, namespace: null });
    } else if (c.type === "namespace_block") {
      const nsName = c.namedChildren.find((x) => x.type === "identifier");
      const ns = nsName?.text ?? null;
      for (const inner of c.namedChildren) {
        if (inner.type === nodeType) {
          results.push({ node: inner, namespace: ns });
        }
      }
    }
  }
  return results;
}

// ── Public extract functions ──────────────────────────────────────────────────

export interface ExtractedNamespace {
  name: string | null;
  note: string | null;
  /** 0-indexed row from CST startPosition. */
  row: number;
  /** 0-indexed column from CST startPosition. */
  startColumn: number;
}

/**
 * Extract namespace block metadata.
 */
export function extractNamespaces(rootNode: SyntaxNode): ExtractedNamespace[] {
  return children(rootNode, "namespace_block").map((node) => {
    const nameNode = node.namedChildren.find((c) => c.type === "identifier");
    const name = nameNode?.text ?? null;
    const meta = child(node, "metadata_block");
    const noteTag = meta ? child(meta, "note_tag") : null;
    const noteStr = noteTag
      ? stringText(noteTag.namedChildren.find((c) => c.type === "nl_string" || c.type === "multiline_string"))
      : null;
    return { name, note: noteStr, row: node.startPosition.row, startColumn: node.startPosition.column };
  });
}

export interface ExtractedSchema {
  name: string | null;
  namespace: string | null;
  note: string | null;
  fields: FieldDecl[];
  hasSpreads: boolean;
  spreads: string[];
  /** 0-indexed row from CST startPosition. */
  row: number;
  /** 0-indexed column from CST startPosition. */
  startColumn: number;
  blockMetadata?: MetaEntry[];
}

/**
 * Extract all schema_block definitions from the CST.
 */
export function extractSchemas(rootNode: SyntaxNode): ExtractedSchema[] {
  return collectFromNamespaces(rootNode, "schema_block").map(({ node, namespace }) => {
    const name = labelText(node);
    const meta = child(node, "metadata_block");
    const noteTag = meta ? child(meta, "note_tag") : null;
    const noteStr = noteTag
      ? stringText(noteTag.namedChildren.find((c) => c.type === "nl_string" || c.type === "multiline_string"))
      : null;
    const body = child(node, "schema_body");
    const fieldTree = body ? extractFieldTree(body) : { fields: [], hasSpreads: false, spreads: [] };
    const blockMeta = meta ? extractMetadata(meta) : [];
    const result: ExtractedSchema = {
      name,
      namespace,
      note: noteStr,
      fields: fieldTree.fields,
      hasSpreads: fieldTree.hasSpreads,
      spreads: fieldTree.spreads,
      row: node.startPosition.row,
      startColumn: node.startPosition.column,
    };
    if (blockMeta.length > 0) result.blockMetadata = blockMeta;
    return result;
  });
}

export interface ExtractedMetric {
  name: string | null;
  namespace: string | null;
  /** Human-readable display name from the metric_name metadata tag, or null. */
  displayName: string | null;
  sources: string[];
  grain: string | null;
  slices: string[];
  fields: FieldDecl[];
  /** 0-indexed row from CST startPosition. */
  row: number;
  /** 0-indexed column from CST startPosition. */
  startColumn: number;
}

/**
 * Returns true when a schema's metadata_block contains a bare `metric` tag_token.
 *
 * This is the canonical way to identify metric schemas in v2 — no separate
 * block type exists. Metrics are schema blocks decorated with `(metric, ...)`.
 */
export function isMetricSchema(meta: SyntaxNode | null | undefined): boolean {
  if (!meta) return false;
  return meta.namedChildren.some(
    (c) => c.type === "tag_token" && c.namedChildren[0]?.text === "metric",
  );
}

/**
 * Extract metric-specific metadata (sources, grain, slices, displayName) from
 * a schema block's metadata_block node.
 *
 * In the v2 grammar, metrics are schema blocks with `(metric, ...)` metadata.
 * The `metric_name` tag carries the human-readable display name; `source`,
 * `grain`, and `slice` carry lineage and aggregation metadata.
 */
function extractMetricMeta(meta: SyntaxNode | null): {
  displayName: string | null;
  sources: string[];
  grain: string | null;
  slices: string[];
} {
  const sources: string[] = [];
  let grain: string | null = null;
  const slices: string[] = [];
  let displayName: string | null = null;

  if (!meta) return { displayName, sources, grain, slices };

  for (const entry of meta.namedChildren) {
    if (entry.type === "tag_with_value") {
      const key = entry.namedChildren[0];
      const val = entry.namedChildren[1];
      if (key?.text === "metric_name") {
        if (val) displayName = stringText(val.namedChildren.find((c) => c.type === "nl_string")) ?? entryText(val);
      } else if (key?.text === "source") {
        if (!val) continue;
        for (const item of val.namedChildren) {
          if (item.type === "qualified_name") {
            sources.push(qualifiedNameText(item)!);
          } else if (item.type === "identifier") {
            sources.push(item.text);
          }
        }
      } else if (key?.text === "grain") {
        if (val) grain = entryText(val);
      }
    } else if (entry.type === "slice_body") {
      for (const item of entry.namedChildren) {
        if (item.type === "identifier") slices.push(item.text);
      }
    }
  }

  return { displayName, sources, grain, slices };
}

/**
 * Extract all metric-decorated schema_block definitions.
 *
 * In v2, a metric is a schema block whose metadata_block contains the bare
 * `metric` tag_token. This function filters `schema_block` nodes by that
 * criterion, then extracts metric-specific metadata (display name, sources,
 * grain, slices) alongside the standard field tree.
 */
export function extractMetrics(rootNode: SyntaxNode): ExtractedMetric[] {
  return collectFromNamespaces(rootNode, "schema_block")
    .filter(({ node }) => isMetricSchema(child(node, "metadata_block")))
    .map(({ node, namespace }) => {
      const name = labelText(node);
      const meta = child(node, "metadata_block");
      const { displayName, sources, grain, slices } = extractMetricMeta(meta);
      const body = child(node, "schema_body");
      const fields = body ? extractDirectFields(body) : [];
      return { name, namespace, displayName, sources, grain, slices, fields, row: node.startPosition.row, startColumn: node.startPosition.column };
    });
}

export interface ExtractedMapping {
  name: string | null;
  namespace: string | null;
  sources: string[];
  targets: string[];
  arrowCount: number;
  /** 0-indexed row from CST startPosition. */
  row: number;
  /** 0-indexed column from CST startPosition. */
  startColumn: number;
}

/**
 * Extract all mapping_block definitions.
 */
export function extractMappings(rootNode: SyntaxNode): ExtractedMapping[] {
  return collectFromNamespaces(rootNode, "mapping_block").map(({ node, namespace }) => {
    const name = labelText(node);
    const body = child(node, "mapping_body");
    const sources: string[] = [];
    const targets: string[] = [];
    let arrowCount = 0;

    if (body) {
      const srcBlock = child(body, "source_block");
      const tgtBlock = child(body, "target_block");

      if (srcBlock) {
        for (const c of srcBlock.namedChildren) {
          const t = sourceRefNameNs(c);
          if (t) sources.push(t);
        }
      }
      if (tgtBlock) {
        for (const c of tgtBlock.namedChildren) {
          const t = sourceRefNameNs(c);
          if (t) targets.push(t);
        }
      }

      arrowCount =
        allDescendants(body, "map_arrow").length +
        allDescendants(body, "computed_arrow").length +
        allDescendants(body, "nested_arrow").length;
    }

    // Targets are namespace-qualified here; sources are intentionally left as
    // authored. Extraction has no workspace knowledge to decide whether a bare
    // source name is namespace-local or global, so resolution-time consumers
    // qualify them against the index instead (core resolveRef's
    // contextSchemaKey, the CLI's resolveScopedEntityRef — sl-98cz).
    const qualifiedTargets = targets.map((t) =>
      namespace && !t.includes("::") ? `${namespace}::${t}` : t,
    );

    return { name, namespace, sources, targets: qualifiedTargets, arrowCount, row: node.startPosition.row, startColumn: node.startPosition.column };
  });
}

export interface ExtractedFragment {
  name: string | null;
  namespace: string | null;
  fields: FieldDecl[];
  hasSpreads: boolean;
  spreads: string[];
  /** 0-indexed row from CST startPosition. */
  row: number;
  /** 0-indexed column from CST startPosition. */
  startColumn: number;
}

/**
 * Extract all fragment_block definitions.
 */
export function extractFragments(rootNode: SyntaxNode): ExtractedFragment[] {
  return collectFromNamespaces(rootNode, "fragment_block").map(({ node, namespace }) => {
    const name = labelText(node);
    const body = child(node, "schema_body");
    const fieldTree = body ? extractFieldTree(body) : { fields: [], hasSpreads: false, spreads: [] };
    return {
      name,
      namespace,
      fields: fieldTree.fields,
      hasSpreads: fieldTree.hasSpreads,
      spreads: fieldTree.spreads,
      row: node.startPosition.row,
      startColumn: node.startPosition.column,
    };
  });
}

export interface ExtractedTransform {
  name: string | null;
  body: string | null;
  namespace: string | null;
  /** 0-indexed row from CST startPosition. */
  row: number;
  /** 0-indexed column from CST startPosition. */
  startColumn: number;
}

/**
 * Extract all transform_block definitions.
 */
export function extractTransforms(rootNode: SyntaxNode): ExtractedTransform[] {
  return collectFromNamespaces(rootNode, "transform_block").map(({ node, namespace }) => {
    const pipeChain = child(node, "pipe_chain");
    return {
      name: labelText(node),
      body: pipeChain ? pipeChain.text : null,
      namespace,
      row: node.startPosition.row,
      startColumn: node.startPosition.column,
    };
  });
}

const BLOCK_TYPES = new Set([
  "schema_block", "mapping_block",
  "fragment_block", "transform_block",
]);

function findParentBlock(node: SyntaxNode): { name: string | null; blockType: string | null } {
  let current = node.parent;
  while (current) {
    if (BLOCK_TYPES.has(current.type)) {
      const label = child(current, "block_label");
      const bareName = label ? labelText(current) : null;
      const blockType = current.type.replace(/_block$/, "");
      // Walk up further to see if this block sits inside a namespace_block so
      // we can qualify the name (e.g. "crm::customers" not just "customers").
      // This ensures the JSON `block` field in warnings/questions output carries
      // the fully-qualified name needed to disambiguate same-named schemas in
      // different namespaces (sl-pb47).
      const name = bareName ? qualifyWithNamespace(current, bareName) : null;
      return { name, blockType };
    }
    current = current.parent;
  }
  return { name: null, blockType: null };
}

/**
 * Walk up the CST from `blockNode` to find an enclosing namespace_block.
 * If one is found, return "ns::name"; otherwise return `name` unchanged.
 */
function qualifyWithNamespace(blockNode: SyntaxNode, name: string): string {
  let current = blockNode.parent;
  while (current) {
    if (current.type === "namespace_block") {
      const nsName = child(current, "identifier");
      return nsName ? `${nsName.text}::${name}` : name;
    }
    current = current.parent;
  }
  return name;
}

export interface ExtractedNote {
  text: string;
  /** 0-indexed row from CST startPosition. */
  row: number;
  /** 0-indexed column from CST startPosition. */
  startColumn: number;
  parent: string | null;
  namespace: string | null;
}

/**
 * Extract all note_block nodes from the CST.
 */
export function extractNotes(rootNode: SyntaxNode): ExtractedNote[] {
  const results: ExtractedNote[] = [];

  function walkForNotes(node: SyntaxNode, namespace: string | null): void {
    for (const c of node.namedChildren) {
      if (c.type === "namespace_block") {
        const nsName = child(c, "identifier");
        walkForNotes(c, nsName?.text ?? null);
        continue;
      }
      if (c.type === "note_block") {
        results.push({
          text: extractNoteText(c),
          row: c.startPosition.row,
          startColumn: c.startPosition.column,
          parent: null,
          namespace,
        });
      } else if (
        c.type === "schema_block" ||
        c.type === "fragment_block" ||
        c.type === "mapping_block"
      ) {
        const parentName = labelText(c);
        collectNotesInBlock(c, parentName, namespace, results);
      }
    }
  }

  walkForNotes(rootNode, null);
  return results;
}

function collectNotesInBlock(
  blockNode: SyntaxNode,
  parentName: string | null,
  namespace: string | null,
  results: ExtractedNote[],
): void {
  for (const c of blockNode.namedChildren) {
    if (c.type === "note_block") {
      results.push({
        text: extractNoteText(c),
        row: c.startPosition.row,
        startColumn: c.startPosition.column,
        parent: parentName,
        namespace,
      });
    }
    if (c.type === "schema_body" || c.type === "mapping_body") {
      for (const inner of c.namedChildren) {
        if (inner.type === "note_block") {
          results.push({
            text: extractNoteText(inner),
            row: inner.startPosition.row,
            startColumn: inner.startPosition.column,
            parent: parentName,
            namespace,
          });
        }
      }
    }
  }
}

function extractNoteText(noteNode: SyntaxNode): string {
  const parts: string[] = [];
  for (const c of noteNode.namedChildren) {
    if (c.type === "nl_string") {
      parts.push(c.text.slice(1, -1));
    } else if (c.type === "multiline_string") {
      parts.push(c.text.slice(3, -3).trim());
    }
  }
  return parts.join("\n");
}

export interface ExtractedWarning {
  text: string;
  /** 0-indexed row from CST startPosition. */
  row: number;
  /** 0-indexed column from CST startPosition. */
  startColumn: number;
  parent: string | null;
  parentType: string | null;
}

/**
 * Extract all warning comments (//! ...).
 */
export function extractWarnings(rootNode: SyntaxNode): ExtractedWarning[] {
  return allDescendants(rootNode, "warning_comment").map((node) => {
    const { name, blockType } = findParentBlock(node);
    return {
      text: node.text.replace(/^\/\/!\s*/, ""),
      row: node.startPosition.row,
      startColumn: node.startPosition.column,
      parent: name,
      parentType: blockType,
    };
  });
}

export interface ExtractedQuestion {
  text: string;
  /** 0-indexed row from CST startPosition. */
  row: number;
  /** 0-indexed column from CST startPosition. */
  startColumn: number;
  parent: string | null;
  parentType: string | null;
}

/**
 * Extract all question comments (//? ...).
 */
export function extractQuestions(rootNode: SyntaxNode): ExtractedQuestion[] {
  return allDescendants(rootNode, "question_comment").map((node) => {
    const { name, blockType } = findParentBlock(node);
    return {
      text: node.text.replace(/^\/\/\?\s*/, ""),
      row: node.startPosition.row,
      startColumn: node.startPosition.column,
      parent: name,
      parentType: blockType,
    };
  });
}

export interface ExtractedImport {
  names: string[];
  path: string | null;
  /** 0-indexed row from CST startPosition. */
  row: number;
  /** 0-indexed column from CST startPosition. */
  startColumn: number;
}

/**
 * Extract all import_decl nodes from the CST.
 */
export function extractImports(rootNode: SyntaxNode): ExtractedImport[] {
  return children(rootNode, "import_decl").map((node) => {
    const names = children(node, "import_name")
      .map((nm) => {
        // isPresent guards against zero-width MISSING recovery nodes —
        // `import { } from "x"` must yield no names, not [""] (sl-0nvt).
        const qn = child(nm, "qualified_name");
        if (isPresent(qn)) return qualifiedNameText(qn);
        const q = child(nm, "backtick_name");
        if (isPresent(q)) return q.text.slice(1, -1);
        const id = child(nm, "identifier");
        return isPresent(id) ? id.text : null;
      })
      .filter((n): n is string => n != null);

    const pathNode = child(node, "import_path");
    const pathStr = pathNode
      ? stringText(pathNode.namedChildren[0])
      : null;

    return { names, path: pathStr, row: node.startPosition.row, startColumn: node.startPosition.column };
  });
}

// ── Arrow-level extraction ──────────────────────────────────────────────────

/**
 * Extract the text of a src_path or tgt_path node.
 */
function pathText(pathNode: SyntaxNode | null): string | null {
  if (!pathNode) return null;
  const inner = pathNode.namedChildren[0];
  if (!inner) return pathNode.text;
  if (inner.type === "backtick_path") return inner.text.slice(1, -1);
  if (inner.type === "namespaced_path") {
    const ids = inner.namedChildren.filter((c) => c.type === "identifier");
    if (ids.length >= 2) {
      const ns = ids[0]!.text;
      const schema = ids[1]!.text;
      const field = ids.slice(2).map((c) => c.text).join(".") || null;
      return canonicalRef(ns, schema, field);
    }
  }
  return inner.text;
}

/**
 * Decompose pipe_step nodes into structured step records.
 */
function decomposePipeSteps(steps: SyntaxNode[]): PipeStep[] {
  return steps.map((step) => {
    const inner = step.namedChildren[0];
    return {
      type: inner?.type ?? "unknown",
      text: inner?.text ?? step.text,
    };
  });
}

export interface ExtractedArrow {
  mapping: string | null;
  namespace: string | null;
  sources: string[];
  target: string | null;
  transform_raw: string;
  steps: PipeStep[];
  classification: Classification;
  derived: boolean;
  /** 0-indexed row from CST startPosition (named "line" for historical reasons). */
  line: number;
  /** 0-indexed column from CST startPosition. */
  startColumn: number;
  metadata?: MetaEntry[];
}

/**
 * Extract detailed arrow records from all mapping blocks in the CST.
 *
 * Arrows nest to arbitrary depth (nested_arrow bodies hold further arrow
 * declarations; each/flatten bodies hold arrow declarations plus nested
 * each/flatten blocks — spec §4.4), so the walk recurses through every
 * container. Each container (nested_arrow, each_block, flatten_block) emits
 * its own record — for each/flatten this is the list-to-list arrow — and its
 * children's relative paths are made absolute against the container's paths.
 */
export function extractArrowRecords(rootNode: SyntaxNode): ExtractedArrow[] {
  const records: ExtractedArrow[] = [];

  for (const { node: mappingNode, namespace } of collectFromNamespaces(rootNode, "mapping_block")) {
    const mappingName = labelText(mappingNode);
    const body = child(mappingNode, "mapping_body");
    if (!body) continue;
    collectArrowRecords(body.namedChildren, mappingName, namespace, null, null, records);
  }

  return records;
}

/**
 * Recursively collect arrow records from a list of sibling CST nodes,
 * appending to `records` in document order.
 *
 * `parentSrc`/`parentTgt` are the absolute paths of the enclosing container
 * (null at mapping-body level). A container's own record already has the
 * parent prefixes applied, so its source/target become the prefixes for the
 * next level down — accumulating across arbitrary depth (sl-zl55).
 */
function collectArrowRecords(
  nodes: SyntaxNode[],
  mappingName: string | null,
  namespace: string | null,
  parentSrc: string | null,
  parentTgt: string | null,
  records: ExtractedArrow[],
): void {
  for (const node of nodes) {
    switch (node.type) {
      case "map_arrow":
      case "computed_arrow":
        records.push(extractSingleArrow(node, mappingName, namespace, parentSrc, parentTgt));
        break;

      case "nested_arrow":
      case "each_block":
      case "flatten_block": {
        const container = extractSingleArrow(node, mappingName, namespace, parentSrc, parentTgt);
        records.push(container);
        // nested_arrow / each / flatten declare exactly one src_path, so the
        // container's single (already absolute) source is the child prefix.
        collectArrowRecords(
          node.namedChildren, mappingName, namespace,
          container.sources[0] ?? null, container.target, records,
        );
        break;
      }

      default:
        // src_path / tgt_path / metadata_block etc. — not arrow declarations.
        break;
    }
  }
}

/**
 * Extract a single arrow record, optionally prefixing source/target with parent paths.
 */
function extractSingleArrow(
  arrow: SyntaxNode,
  mappingName: string | null,
  namespace: string | null,
  parentSrc: string | null,
  parentTgt: string | null,
): ExtractedArrow {
  const srcNodes = children(arrow, "src_path");
  const tgtNode = child(arrow, "tgt_path");
  const pipeChain = child(arrow, "pipe_chain");
  const pipeSteps = pipeChain ? children(pipeChain, "pipe_step") : [];

  let sources: string[] = srcNodes
    .map((n) => cleanPathText(pathText(n)))
    .filter((s): s is string => s !== null);
  let target = cleanPathText(pathText(tgtNode));
  const classification = classifyTransform(pipeSteps);
  const derived = classifyArrow(arrow);
  const steps = decomposePipeSteps(pipeSteps);

  if (parentSrc && sources.length > 0) {
    sources = sources.map((s) => {
      const cleanSrc = s.replace(/^\./, "");
      return `${parentSrc}.${cleanSrc}`;
    });
  }
  if (parentTgt && target) {
    const cleanTgt = target.replace(/^\./, "");
    target = `${parentTgt}.${cleanTgt}`;
  }

  const transformRaw = pipeSteps.length > 0
    ? pipeSteps.map((s) => s.namedChildren[0]?.text ?? s.text).join(" | ")
    : "";

  const metaNode = child(arrow, "metadata_block");
  const metadata = metaNode ? extractMetadata(metaNode) : undefined;

  const record: ExtractedArrow = {
    mapping: mappingName,
    namespace,
    sources,
    target,
    transform_raw: transformRaw,
    steps,
    classification,
    derived,
    line: arrow.startPosition.row,
    startColumn: arrow.startPosition.column,
  };

  if (metadata && metadata.length > 0) {
    record.metadata = metadata;
  }

  return record;
}

/**
 * Clean path text: defensive newline stripping.
 */
function cleanPathText(text: string | null): string | null {
  if (!text) return null;
  const nlIdx = text.indexOf("\n");
  if (nlIdx !== -1) {
    text = text.slice(0, nlIdx).trim();
  }
  return text;
}
