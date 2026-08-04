/**
 * extract.ts — CST extraction functions for Satsuma files
 *
 * Each function accepts a tree-sitter root node and returns structured data
 * extracted from the concrete syntax tree. Functions are pure (no I/O) so
 * they can be tested against mock CST objects.
 */

import { canonicalRef } from "./canonical-ref.js";
import { classifyTransform, classifyArrow } from "./classify.js";
import { createScalarTypeExpression } from "./field-decl.js";
import { extractMetadata } from "./meta-extract.js";
import {
  child,
  children,
  allDescendants,
  labelText,
  stringText,
  entryText,
  qualifiedNameText,
  sourceRefStructuralText,
  isPresent,
} from "./cst-utils.js";
import type {
  Classification,
  FieldDecl,
  MetaEntry,
  PipeStep,
  RecordFieldDecl,
  RecordListFieldDecl,
  ScalarFieldDecl,
  ScalarListFieldDecl,
  SyntaxNode,
} from "./types.js";
import type { SatsumaCstType, SatsumaGrammarSymbol } from "./generated/cst-types.js";

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
  return fd.children.some((c) => !c.isNamed && c.text === "list_of");
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
    const decl: ScalarFieldDecl = {
      name,
      type: createScalarTypeExpression(typeNode?.text ?? ""),
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
        const decl: RecordFieldDecl | RecordListFieldDecl = isList
          ? {
              name,
              type: "record",
              isList: true,
              children: nested.fields,
              startRow: c.startPosition.row,
              startColumn: c.startPosition.column,
            }
          : {
              name,
              type: "record",
              isList: false,
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
        const hasRecordKeyword = c.children.some((ch) => !ch.isNamed && ch.text === "record");
        if (hasRecordKeyword) {
          const decl: RecordFieldDecl | RecordListFieldDecl = isList
            ? {
                name,
                type: "record",
                isList: true,
                children: [],
                startRow: c.startPosition.row,
                startColumn: c.startPosition.column,
              }
            : {
                name,
                type: "record",
                children: [],
                startRow: c.startPosition.row,
                startColumn: c.startPosition.column,
              };
          if (meta.length > 0) decl.metadata = meta;
          fields.push(decl);
        } else {
          const decl: ScalarFieldDecl | ScalarListFieldDecl = {
            name,
            type: createScalarTypeExpression(typeNode?.text ?? ""),
            startRow: c.startPosition.row,
            startColumn: c.startPosition.column,
            ...(isList ? { isList: true as const } : {}),
          };
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
  if (qn) return qualifiedNameText(qn) ?? qn.text;
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
const COMMENT_NODE_TYPES: ReadonlySet<SatsumaCstType> = new Set([
  "comment",
  "warning_comment",
  "question_comment",
]);

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
function collectFromNamespaces(
  rootNode: SyntaxNode,
  nodeType: SatsumaGrammarSymbol,
): NamespaceCollected[] {
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
      ? stringText(
          noteTag.namedChildren.find(
            (c) => c.type === "nl_string" || c.type === "multiline_string",
          ),
        )
      : null;
    return {
      name,
      note: noteStr,
      row: node.startPosition.row,
      startColumn: node.startPosition.column,
    };
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
      ? stringText(
          noteTag.namedChildren.find(
            (c) => c.type === "nl_string" || c.type === "multiline_string",
          ),
        )
      : null;
    const body = child(node, "schema_body");
    const fieldTree = body
      ? extractFieldTree(body)
      : { fields: [], hasSpreads: false, spreads: [] };
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
        if (val)
          displayName =
            stringText(val.namedChildren.find((c) => c.type === "nl_string")) ?? entryText(val);
      } else if (key?.text === "source") {
        if (!val) continue;
        for (const item of val.namedChildren) {
          if (item.type === "qualified_name") {
            sources.push(qualifiedNameText(item) ?? item.text);
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
      return {
        name,
        namespace,
        displayName,
        sources,
        grain,
        slices,
        fields,
        row: node.startPosition.row,
        startColumn: node.startPosition.column,
      };
    });
}

export interface ExtractedMapping {
  name: string | null;
  namespace: string | null;
  /** Entity references exactly as authored in the `source` block. */
  sources: string[];
  /**
   * Entity references exactly as authored in the `target` block.
   *
   * Extraction has no workspace index, so a bare name cannot yet be identified
   * as namespace-local or global. Consumers must resolve it relative to
   * {@link namespace}, using current-namespace-then-global lookup.
   */
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

    return {
      name,
      namespace,
      sources,
      targets,
      arrowCount,
      row: node.startPosition.row,
      startColumn: node.startPosition.column,
    };
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
    const fieldTree = body
      ? extractFieldTree(body)
      : { fields: [], hasSpreads: false, spreads: [] };
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
  /** Raw pipe-chain source text, preserving the author's layout. */
  body: string | null;
  /**
   * Layout-independent serialization of the pipe chain (see
   * canonicalPipeChainText). Two transforms with the same canonicalBody are
   * structurally identical even if the author or formatter laid the steps
   * out differently — diff compares this, not `body` (sl-dxjh).
   */
  canonicalBody: string | null;
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
    const pipeSteps = pipeChain ? children(pipeChain, "pipe_step") : [];
    return {
      name: labelText(node),
      body: pipeChain ? pipeChain.text : null,
      canonicalBody: pipeChain ? canonicalPipeChainText(pipeSteps) : null,
      namespace,
      row: node.startPosition.row,
      startColumn: node.startPosition.column,
    };
  });
}

const BLOCK_TYPES: ReadonlySet<SatsumaCstType> = new Set([
  "schema_block",
  "mapping_block",
  "fragment_block",
  "transform_block",
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
    const pathStr = pathNode ? stringText(pathNode.namedChildren[0]) : null;

    return {
      names,
      path: pathStr,
      row: node.startPosition.row,
      startColumn: node.startPosition.column,
    };
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
    const [ns, schema] = ids;
    if (ns && schema) {
      const field =
        ids
          .slice(2)
          .map((c) => c.text)
          .join(".") || null;
      return canonicalRef(ns.text, schema.text, field);
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

// ── Canonical pipe-chain serialization ──────────────────────────────────────
//
// The formatter is free to re-lay a pipe chain (steps one-per-line, map
// entries newline-separated) without changing meaning, so structural
// comparisons must not use raw chain text. The canonical form normalizes
// exactly the layout the formatter owns — separators between steps and
// between map entries — while every leaf token (pipe text, map keys, map
// values, spread names) is the verbatim source text: NL strings are
// human-interpreted and must never be normalized (sl-dxjh).

/**
 * Serialize one pipe step's inner node into its canonical text.
 *
 * `map { ... }` literals are rebuilt as a single-line entry list; all other
 * step kinds (pipe_text, fragment_spread) are single tokens whose text is
 * already layout-free, so they pass through verbatim.
 */
function canonicalPipeStepText(inner: SyntaxNode | undefined, fallback: string): string {
  if (!inner) return fallback;
  if (inner.type !== "map_literal") return inner.text;

  const entries = children(inner, "map_entry");
  if (entries.length === 0) return "map { }";
  const entryTexts = entries.map((e) => {
    const key = child(e, "map_key");
    const value = child(e, "map_value");
    // Key and value text stay verbatim — quoted strings are NL content.
    return key && value ? `${key.text}: ${value.text}` : e.text;
  });
  return `map { ${entryTexts.join(", ")} }`;
}

/**
 * Serialize a pipe chain (list of pipe_step nodes) into a single
 * layout-independent line: canonical step texts joined with " | ".
 *
 * Invariant: a chain and its formatter output produce the same canonical
 * text, so fmt-only changes never register as structural differences.
 */
export function canonicalPipeChainText(pipeSteps: SyntaxNode[]): string {
  return pipeSteps.map((s) => canonicalPipeStepText(s.namedChildren[0], s.text)).join(" | ");
}

/**
 * Which declaration produced an arrow record — spec §4.4's three shapes plus the
 * two list operators.
 *
 * `map` — a plain `a -> b`, optionally with a pipe-chain transform body. It
 *   names a path and nothing narrows the claim.
 * `computed` — `-> b { ... }`, no source; the body is a transform pipeline or
 *   prose, so nothing is asserted to flow into `b` from anywhere declared.
 * `nested` — `a -> b { ... }` whose braces hold further arrows. The body is a
 *   nesting scope that enumerates what maps.
 * `each` / `flatten` — a list operator; its src/tgt are the iteration subject
 *   and its body enumerates what maps per element.
 *
 * The distinction matters to any consumer asking what an arrow *asserts* about a
 * container, because only `map` asserts anything about the whole of one — the
 * other four name a container and then say, in their body, exactly which parts
 * of it map. Coverage is the first such consumer (PRD 38 R5).
 */
export type ArrowDeclarationKind = "map" | "computed" | "nested" | "each" | "flatten";

export interface ExtractedArrow {
  mapping: string | null;
  namespace: string | null;
  /** The declaration shape this record came from — see {@link ArrowDeclarationKind}. */
  kind: ArrowDeclarationKind;
  /**
   * True when this declaration's braces enumerate further arrow declarations.
   *
   * Only the three nesting kinds can: a `map` or `computed` body is a transform
   * pipeline, not a scope (spec §4.4), so both are always false. A nesting kind
   * with an empty body is false too — `addr -> address { }` opens a scope and
   * puts nothing in it.
   *
   * Consumers use it to tell a header that *narrows* its claim to the fields it
   * lists from one that makes no such narrowing. Coverage is the first
   * (ADR-037): `addr -> address { }` asserts the whole structure maps, while
   * `addr -> address { .street -> .line }` asserts only what it enumerates.
   */
  enumeratesChildren: boolean;
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
    records.push(...extractMappingArrowRecords(mappingNode, namespace));
  }

  return records;
}

/**
 * Arrow records for **one** `mapping_block` node, with the same absolute-path
 * semantics {@link extractArrowRecords} gives every arrow in a file.
 *
 * Exists because a consumer that has already located a single mapping must not
 * re-derive the nesting rules to read its arrows. Coverage is that consumer: it
 * reports on one named mapping, and two same-named mappings in different
 * namespaces are different mappings — so it cannot filter the whole-file list by
 * label without conflating them.
 *
 * @param mappingNode A `mapping_block` node.
 * @param namespace   Namespace the block was found in, or null at file scope.
 *                    Recorded on each returned arrow; it does not affect paths.
 */
export function extractMappingArrowRecords(
  mappingNode: SyntaxNode,
  namespace: string | null = null,
): ExtractedArrow[] {
  const body = child(mappingNode, "mapping_body");
  if (!body) return [];

  const records: ExtractedArrow[] = [];
  collectArrowRecords(body.namedChildren, labelText(mappingNode), namespace, null, null, records);
  return records;
}

/**
 * Make one arrow path absolute against the container it was authored inside.
 *
 * Inside a `nested_arrow`, `each` or `flatten` body, paths are authored
 * *element-relative* — `.line1 -> .line1` under `each parcels -> packed` means
 * `parcels.line1 -> packed.line1` (spec §4.6). The leading dot is the authored
 * marker of that relativity and is stripped as the container prefix goes on;
 * a path written without one inside a container is treated identically, since
 * the container is the only frame it can be read in.
 *
 * Exported because every consumer that resolves an arrow against a declared
 * field must apply this rule, and the copies drift when they don't share it:
 * coverage reported nested leaves as gaps until sc-xnxp, and the viz dropped
 * every relative-path arrow from its coverage lookups, hover highlighting and
 * overview edges until 3cdd-yavi.
 *
 * @param path        Path as authored, with or without a leading dot.
 * @param containerPath Absolute path of the enclosing container, or null at
 *                    mapping-body level, where a path is already absolute and
 *                    is returned untouched — dot and all, since a stray leading
 *                    dot there matches no declared field and must not be made
 *                    to look as though it does.
 */
export function qualifyChildArrowPath(path: string, containerPath: string | null): string {
  if (!containerPath || !path) return path;
  return `${containerPath}.${path.replace(/^\./, "")}`;
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
          node.namedChildren,
          mappingName,
          namespace,
          container.sources[0] ?? null,
          container.target,
          records,
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

  sources = sources.map((s) => qualifyChildArrowPath(s, parentSrc));
  target = target === null ? null : qualifyChildArrowPath(target, parentTgt);

  // Canonical (layout-independent) so two arrows that differ only in how
  // the formatter laid out the chain or a map literal compare equal — diff
  // matches arrows on this text (sl-dxjh).
  const transformRaw = pipeSteps.length > 0 ? canonicalPipeChainText(pipeSteps) : "";

  const metaNode = child(arrow, "metadata_block");
  const metadata = metaNode ? extractMetadata(metaNode) : undefined;

  const record: ExtractedArrow = {
    mapping: mappingName,
    namespace,
    kind: arrowDeclarationKind(arrow.type),
    enumeratesChildren: arrow.namedChildren.some((c) => ARROW_DECLARATION_TYPES.has(c.type)),
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
 * Every CST node type that is an arrow declaration — grammar.js's `_arrow_decl`
 * choice plus the two list operators, which `_nested_block_item` adds inside
 * `each`/`flatten` bodies. Kept in step with those two grammar rules.
 */
const ARROW_DECLARATION_TYPES: ReadonlySet<SatsumaCstType> = new Set([
  "map_arrow",
  "computed_arrow",
  "nested_arrow",
  "each_block",
  "flatten_block",
]);

/**
 * Map an arrow-declaration CST node type onto its {@link ArrowDeclarationKind}.
 *
 * Total over the node types `collectArrowRecords` dispatches on; anything else
 * would be a caller bug, and `map` is the reading that asserts the most, so
 * falling back to it would be the dangerous default. `computed` is the
 * conservative one, and is what an unrecognised shape gets.
 */
function arrowDeclarationKind(nodeType: SatsumaCstType): ArrowDeclarationKind {
  switch (nodeType) {
    case "map_arrow":
      return "map";
    case "nested_arrow":
      return "nested";
    case "each_block":
      return "each";
    case "flatten_block":
      return "flatten";
    default:
      return "computed";
  }
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
