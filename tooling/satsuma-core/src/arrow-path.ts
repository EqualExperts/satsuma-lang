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
 * re-split text. The rule itself (what `^.`, `$.` and `.` mean) lives in
 * reference-stages.ts, and nothing here looks a field up.
 *
 * Why the CST and not `node.text`: a path's raw text keeps the backticks of
 * every quoted segment, so `` orders.`odd name` `` would reach validation and
 * coverage as a field called `` `odd name` `` that no declaration matches
 * (bsw-f9fq). Reading segments from the CST unquotes each one, wherever it sits.
 */

import { canonicalRef } from "./canonical-ref.js";
import { isPresent } from "./cst-utils.js";
import {
  PATH_SEPARATOR,
  resolveAuthoredPathAgainstContainer,
  resolvePathSegmentsAgainstContainer,
  type ContainerSegments,
} from "./reference-stages.js";
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

/**
 * Text of one path segment, with a `backtick_name`'s delimiters removed.
 *
 * Uses the same `slice(1, -1)` unquoting as field declarations
 * (cst-utils `fieldNameText`), so a segment and the field it names agree on
 * what the name is.
 */
export function pathSegmentText(seg: SyntaxNode): string {
  return seg.type === "backtick_name" ? seg.text.slice(1, -1) : seg.text;
}

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
 * A well-formed, un-namespaced path is resolved segment by segment
 * (`resolvePathSegmentsAgainstContainer`), never re-split from text.
 *
 * Two shapes have no clean segments and keep the text resolver: an
 * error-recovered path, whose raw text must stay visibly malformed (rule
 * sl-8o1n above), and a namespaced path, whose canonical `ns::schema.field`
 * identity is text. Their segments are the resolved text split on `.` — exact
 * unless a segment holds a dot, which is how every path was handled before
 * bsw-2yzd, so these rare shapes lose nothing they had.
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
  if (parts && parts.namespace === null) {
    const segments = resolvePathSegmentsAgainstContainer(
      parts.anchor,
      parts.segments,
      container?.segments ?? null,
    );
    return { authored, resolved: { text: segments.join(PATH_SEPARATOR), segments } };
  }
  const text = resolveAuthoredPathAgainstContainer(authored, container?.segments ?? null);
  return { authored, resolved: { text, segments: text.split(PATH_SEPARATOR) } };
}

/** The text up to its first line break, trimmed when one was cut off. */
function firstLine(text: string | null): string | null {
  if (!text) return null;
  const nlIdx = text.indexOf("\n");
  return nlIdx === -1 ? text : text.slice(0, nlIdx).trim();
}
