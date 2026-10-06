/**
 * arrow-path.ts — read an arrow's src_path / tgt_path from its CST segments.
 *
 * Every arrow path form in the grammar is a structural prefix followed by a
 * dot-separated run of segments, each an `identifier` or a `backtick_name`
 * (grammar.js `_path_seg`):
 *
 *   field_path           a.b           no prefix
 *   backtick_path        `a b`.c       no prefix, first segment quoted
 *   relative_field_path  .a.b          `.`   — relative to the container (spec §4.4)
 *   parent_path          ^.^.a         `^.`×n — pop n container levels (ADR-053)
 *   root_path            $.a           `$.`  — absolute from the schema root (ADR-053)
 *   namespaced_path      ns::s.a       `ns::` then schema and field segments
 *
 * This module owns turning that CST into structured parts, rendering the parts
 * back to the authored path string, and handing them to the container rule in
 * reference-stages.ts so a path is resolved from its segments rather than from
 * re-split text — top-down during extraction, or in place from a single path
 * node for an editor (`resolveArrowPathInPlace`). The rule itself (what `^.`, `$.` and `.` mean) lives in
 * reference-stages.ts, and nothing here looks a field up.
 *
 * Why the CST and not `node.text`: a path's raw text keeps the backticks of
 * every quoted segment, so `` orders.`odd name` `` would reach validation and
 * coverage as a field called `` `odd name` `` that no declaration matches
 * (bsw-f9fq). Reading segments from the CST unquotes each one, wherever it sits.
 */

import { canonicalRef } from "./canonical-ref.js";
import { isPresent, pathSegmentText } from "./cst-utils.js";
import {
  PATH_SEPARATOR,
  resolveAuthoredPathAgainstContainer,
  resolvePathSegmentsAgainstContainer,
  type ContainerSegments,
} from "./reference-stages.js";
import type { SatsumaCstType } from "./generated/cst-types.js";
import type { SyntaxNode } from "./types.js";

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * The structural prefix an authored path carries, which decides how it is
 * resolved against its enclosing container.
 */
export type ArrowPathAnchor =
  /** No prefix (`a.b`, `` `a b`.c ``): prefixed with the container path. */
  | { kind: "plain" }
  /** Leading `.`: relative to the container; resolves the same as plain. */
  | { kind: "relative" }
  /** Leading `$.`: absolute from the schema root, container ignored. */
  | { kind: "root" }
  /** Leading `^.` repeated `levels` times: pop that many container levels. */
  | { kind: "parent"; levels: number };

/** An arrow path decomposed into its prefix, namespace and unquoted segments. */
export interface ArrowPathParts {
  /** The structural prefix, and so the container-resolution rule that applies. */
  anchor: ArrowPathAnchor;
  /**
   * The namespace of a `ns::schema.field` path, else null. When set, the first
   * segment is the schema name and the rest name the field within it.
   */
  namespace: string | null;
  /**
   * Path segments in authored order with backticks removed, so a quoted
   * segment compares equal to the declared field name. A segment may itself
   * contain a `.` (`` `a.b` ``); consumers that need to tell that apart from
   * two segments must use this array, not the rendered string.
   */
  segments: string[];
}

// ── Grammar conventions ─────────────────────────────────────────────────────

/** The parent-escape marker token (ADR-053); one occurrence pops one level. */
const PARENT_ESCAPE_TOKEN = "^.";
/** The root-escape marker token (ADR-053). */
const ROOT_ESCAPE_TOKEN = "$.";
/** The relativity marker on a relative_field_path (spec §4.4). */
const RELATIVE_MARKER = ".";

/** True for a node the grammar's `_path_seg` produces, with real text. */
function isPresentSegment(node: SyntaxNode): boolean {
  return (node.type === "identifier" || node.type === "backtick_name") && isPresent(node);
}

/**
 * The segment nodes of a path, or null when error recovery left anything else
 * among its named children (an ERROR node, a MISSING segment).
 *
 * Rule: a malformed path is never rebuilt into a well-formed one. Skipping the
 * ERROR in `items[].id` would yield `items.id`, a declared field, and raise
 * coverage on a broken file — the opposite of ADR-036's rule that breaking a
 * spec must never raise coverage (pinned by coverage.test.js, sl-8o1n).
 */
function segmentNodes(inner: SyntaxNode): SyntaxNode[] | null {
  const named = inner.namedChildren;
  return named.every(isPresentSegment) ? named : null;
}

/** Read the anchor a path node's type (and, for `^.`, its token count) implies. */
function anchorOf(inner: SyntaxNode): ArrowPathAnchor | null {
  switch (inner.type) {
    case "field_path":
    case "backtick_path":
    case "namespaced_path":
      return { kind: "plain" };
    case "relative_field_path":
      return { kind: "relative" };
    case "root_path":
      return { kind: "root" };
    case "parent_path":
      return {
        kind: "parent",
        levels: inner.children.filter((c) => c.type === PARENT_ESCAPE_TOKEN).length,
      };
    default:
      return null;
  }
}

// ── Decomposition ───────────────────────────────────────────────────────────

/**
 * Decompose a `src_path` or `tgt_path` node into its anchor, namespace and
 * unquoted segments.
 *
 * Returns null when the node holds no recognised path form, or when error
 * recovery left a non-segment child in it; callers fall back to the node's
 * raw text, so a malformed path stays visibly malformed.
 */
export function arrowPathParts(pathNode: SyntaxNode | null | undefined): ArrowPathParts | null {
  const inner = pathNode?.namedChildren[0];
  if (!inner) return null;
  const anchor = anchorOf(inner);
  if (!anchor) return null;

  const segNodes = segmentNodes(inner);
  if (!segNodes) return null;
  if (inner.type === "namespaced_path") {
    // First named child is the namespace identifier; the rest are segments.
    const [ns, ...rest] = segNodes;
    if (!ns || ns.type !== "identifier" || rest.length === 0) return null;
    return { anchor, namespace: ns.text, segments: rest.map(pathSegmentText) };
  }

  if (segNodes.length === 0) return null;
  return { anchor, namespace: null, segments: segNodes.map(pathSegmentText) };
}

/**
 * Render parts as the authored path string the container resolver consumes:
 * the anchor's prefix, then the unquoted segments joined with `.`.
 *
 * A namespaced path renders in canonical `ns::schema.field` form. The string
 * cannot distinguish a segment containing `.` from two segments — use
 * `parts.segments` where that matters.
 */
export function renderArrowPath(parts: ArrowPathParts): string {
  const body = parts.segments.join(".");
  if (parts.namespace !== null) {
    const [schema = "", ...field] = parts.segments;
    return canonicalRef(parts.namespace, schema, field.join(".") || null);
  }
  switch (parts.anchor.kind) {
    case "plain":
      return body;
    case "relative":
      return `${RELATIVE_MARKER}${body}`;
    case "root":
      return `${ROOT_ESCAPE_TOKEN}${body}`;
    case "parent":
      return `${PARENT_ESCAPE_TOKEN.repeat(parts.anchor.levels)}${body}`;
  }
}

/**
 * The authored text of a `src_path` / `tgt_path` with every quoted segment
 * unquoted, ready for `resolveAuthoredPathAgainstContainer`.
 *
 * Falls back to the node's raw text when it holds no recognised path form or
 * was error-recovered, so malformed input still yields something to report
 * against and never resolves to a declared field by accident.
 */
export function arrowPathText(pathNode: SyntaxNode | null | undefined): string | null {
  if (!pathNode) return null;
  const parts = arrowPathParts(pathNode);
  if (parts) return renderArrowPath(parts);
  return pathNode.namedChildren[0]?.text ?? pathNode.text;
}

// ── Resolution against a container ──────────────────────────────────────────

/**
 * An arrow path made absolute against its containers, in both of the forms
 * consumers need.
 */
export interface ResolvedArrowPath {
  /** The joined schema-root path: the arrow record's identity (ADR-035). */
  text: string;
  /**
   * The segments `text` was joined from, one per nesting level. When this path
   * is itself a container, its children resolve against these, so a backtick
   * segment containing a dot stays one level for `^.` (bsw-2yzd).
   */
  segments: ContainerSegments;
}

/**
 * Resolve a `src_path` / `tgt_path` node against its enclosing container.
 *
 * A well-formed path is resolved segment by segment
 * (`resolvePathSegmentsAgainstContainer`), never re-split from text. A
 * namespaced path's qualifier rides on its schema segment (`ns::schema`), so
 * `` ns::s.`a.b` `` is the two levels `["ns::s", "a.b"]` and joins back to the
 * canonical `ns::s.a.b` identity (bsw-2yzd).
 *
 * Only an error-recovered path has no clean segments. It keeps the text
 * resolver, so its raw text stays visibly malformed (rule sl-8o1n above), and
 * its segments are the resolved text split on `.`; such a path never resolves
 * to a declared field, so it is never a container worth descending into.
 *
 * @param pathNode  The path node, or null/undefined for an arrow without one.
 * @param container The resolved enclosing container, or null at mapping-body
 *                  level.
 * @returns The authored text (first line only, so an error-recovered node
 *          spanning lines stays one line) and the resolved path; null when
 *          the node is absent or empty.
 */
export function resolveArrowPath(
  pathNode: SyntaxNode | null | undefined,
  container: ResolvedArrowPath | null,
): { authored: string; resolved: ResolvedArrowPath } | null {
  const authored = firstLine(arrowPathText(pathNode));
  if (!authored) return null;

  const parts = arrowPathParts(pathNode);
  if (parts) {
    const segments = resolvePathSegmentsAgainstContainer(
      parts.anchor,
      qualifiedSegments(parts),
      container?.segments ?? null,
    );
    return { authored, resolved: { text: segments.join(PATH_SEPARATOR), segments } };
  }
  const text = resolveAuthoredPathAgainstContainer(authored, container?.segments ?? null);
  return { authored, resolved: { text, segments: text.split(PATH_SEPARATOR) } };
}

/**
 * A path's segments with any namespace folded into the schema segment, so
 * joining them gives the canonical `ns::schema.field` text `renderArrowPath`
 * would, while a dotted field segment stays one level.
 */
function qualifiedSegments(parts: ArrowPathParts): string[] {
  if (parts.namespace === null) return parts.segments;
  const [schema = "", ...field] = parts.segments;
  return [canonicalRef(parts.namespace, schema), ...field];
}

/** The text up to its first line break, trimmed when one was cut off. */
function firstLine(text: string | null): string | null {
  if (!text) return null;
  const nlIdx = text.indexOf("\n");
  return nlIdx === -1 ? text : text.slice(0, nlIdx).trim();
}

// ── Resolution in place, from any path node ────────────────────────────────

/**
 * Node types whose body paths are written relative to the container's own
 * header paths (spec §4.4) — the same three `collectArrowRecords` in
 * extract.ts recurses through.
 */
const CONTAINER_NODE_TYPES: ReadonlySet<SatsumaCstType> = new Set([
  "nested_arrow",
  "each_block",
  "flatten_block",
]);

/**
 * An arrow path resolved where it sits in the CST, together with the nodes of
 * its own authored segments, so an editor can tell which part of the resolved
 * path the cursor is on.
 */
export interface ArrowPathInPlace {
  /** The authored text, as {@link resolveArrowPath} returns it. */
  authored: string;
  /** The path made absolute against every enclosing container. */
  resolved: ResolvedArrowPath;
  /**
   * The `identifier` / `backtick_name` nodes of the authored segments, in
   * order, excluding a namespace qualifier. They align with the *last*
   * `segmentNodes.length` entries of `resolved.segments`, since container
   * resolution only ever prepends. Empty for an error-recovered path, whose
   * segments are not trusted (rule sl-8o1n).
   */
  segmentNodes: SyntaxNode[];
}

/**
 * The authored segment nodes of a `src_path` / `tgt_path`, excluding a
 * namespace qualifier; empty when the path is absent or error-recovered.
 */
export function arrowPathSegmentNodes(pathNode: SyntaxNode | null | undefined): SyntaxNode[] {
  const inner = pathNode?.namedChildren[0];
  if (!inner || !anchorOf(inner)) return [];
  const segNodes = segmentNodes(inner);
  if (!segNodes) return [];
  return inner.type === "namespaced_path" ? segNodes.slice(1) : segNodes;
}

/**
 * Resolve a `src_path` / `tgt_path` node against the containers that enclose
 * it, by walking up the CST rather than down from the mapping.
 *
 * Extraction resolves top-down as it walks a mapping body; an editor starts
 * from the one path under the cursor and has no such walk. Both must give the
 * same answer — an LSP that resolves `.id` inside `each orders` to the
 * top-level `id` sends go-to-definition to the wrong field (bsw-89wr) — so
 * this applies the same two rules extraction does: the container's header path
 * on the same side is the frame, and a container's own frame is its enclosing
 * container's. core's arrow-path tests pin that the two agree on every arrow
 * in the example corpus.
 *
 * @returns null when the node is absent or holds no path text.
 */
export function resolveArrowPathInPlace(
  pathNode: SyntaxNode | null | undefined,
): ArrowPathInPlace | null {
  if (!pathNode) return null;
  const result = resolveArrowPath(pathNode, enclosingContainerPath(pathNode));
  if (!result) return null;
  return { ...result, segmentNodes: arrowPathSegmentNodes(pathNode) };
}

/**
 * The resolved segments up to and including the authored segment `node`, or
 * all of them when `node` is not one of the path's segments (the cursor is on
 * a `^.` marker, say). Lets go-to-definition on `b` in `.a.b` land on `a.b`,
 * and on `a` land on `a`.
 */
export function resolvedSegmentsThrough(path: ArrowPathInPlace, node: SyntaxNode): string[] {
  const all = [...path.resolved.segments];
  // Compared by span, not identity: web-tree-sitter mints a fresh wrapper on
  // every child access, so two wrappers of one node are never `===`.
  const at = path.segmentNodes.findIndex(
    (seg) => seg.startIndex === node.startIndex && seg.endIndex === node.endIndex,
  );
  if (at < 0) return all;
  const firstAuthored = all.length - path.segmentNodes.length;
  return all.slice(0, Math.max(0, firstAuthored) + at + 1);
}

/**
 * The resolved same-side header path of the container enclosing the arrow
 * that owns `pathNode`, or null at mapping-body level.
 *
 * A path's parent is its arrow (or the container whose header it is); that
 * node's parent is the enclosing container when there is one. Sources take the
 * first header path that resolves, as extraction's `resolvedSources[0]` does.
 */
function enclosingContainerPath(pathNode: SyntaxNode): ResolvedArrowPath | null {
  const container = pathNode.parent?.parent;
  if (!container || !CONTAINER_NODE_TYPES.has(container.type)) return null;
  for (const header of container.namedChildren) {
    if (header.type !== pathNode.type) continue;
    const resolved = resolveArrowPathInPlace(header)?.resolved;
    if (resolved) return resolved;
  }
  return null;
}
