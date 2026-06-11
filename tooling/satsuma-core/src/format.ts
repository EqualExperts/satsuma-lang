/**
 * format.ts — Satsuma formatter core
 *
 * Pure function: takes a tree-sitter Tree and the original source string,
 * returns the formatted string. No I/O, no configuration, no side effects.
 *
 * The formatter walks the full CST (node.children, not just namedChildren)
 * to preserve comments and all anonymous tokens (punctuation, keywords).
 *
 * Style rules are fixed and match the canonical example corpus. Zero
 * configuration — one style for all Satsuma files everywhere.
 */

import type { SyntaxNode, Tree } from "./types.js";

const INDENT = "  ";

// Column-alignment widths for name and type in formatted field declarations.
// Fields are laid out as:   <name padded to NAME_CAP>  <type padded to TYPE_CAP>  <metadata>
// These values match the canonical example corpus. Changing them will reformat
// every field declaration across all Satsuma files — treat as a breaking style change.
const NAME_CAP = 24;
const TYPE_CAP = 14;

// ── Public API ────────────────────────────────────────────────────────────────

export function format(tree: Tree, source: string): string {
  const result = formatSourceFile(tree.rootNode, source);
  // Ensure single trailing newline, no trailing blank lines
  return trimTrailingNewlines(result) + "\n";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ind(level: number): string {
  return INDENT.repeat(level);
}

function trimTrailingNewlines(text: string): string {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 10) {
    end -= 1;
  }
  return text.slice(0, end);
}

function isComment(node: SyntaxNode): boolean {
  return node.type === "comment" ||
         node.type === "warning_comment" ||
         node.type === "question_comment";
}

function isImport(node: SyntaxNode): boolean {
  return node.type === "import_decl";
}

/** True if there is at least one blank line between two nodes in the source. */
function hasBlankBetween(a: SyntaxNode, b: SyntaxNode): boolean {
  return b.startPosition.row - a.endPosition.row > 1;
}

/** True if b starts on the same line as a ends. */
function sameLine(a: SyntaxNode, b: SyntaxNode): boolean {
  return a.endPosition.row === b.startPosition.row;
}

/** Find a named child by type. */
function findChild(node: SyntaxNode, type: string): SyntaxNode | null {
  for (const c of node.children) {
    if (c.type === type) return c;
  }
  return null;
}

/** Find all children of a given type. */
function findChildren(node: SyntaxNode, type: string): SyntaxNode[] {
  return node.children.filter(c => c.type === type);
}

// Body-type names recognised when scanning block-level children for gap
// comments (comments between `{` and the body node, or between the body
// node and `}`).  Tree-sitter places extras (comments) at the nearest
// enclosing named node, so a comment before the first body child lands as
// a sibling of the body inside the block — not inside the body itself.
const BODY_TYPES = new Set([
  "schema_body", "mapping_body", "pipe_chain",
]);

/**
 * Collect comments that appear between the opening `{` and the body node.
 *
 * Tree-sitter's `extras` placement means a comment before the body's first
 * named child becomes a child of the *block*, not of the body.  These
 * "leading gap" comments would otherwise be silently dropped because the
 * body-formatting functions only iterate `body.children`.
 *
 * Returns a formatted string (with leading newline per comment) ready to
 * append after the opening `{` line.
 */
function collectBlockLeadingComments(
  node: SyntaxNode, indent: number
): string {
  const comments: string[] = [];
  let braceRow = -1;

  for (const child of node.children) {
    if (child.type === "{") { braceRow = child.startPosition.row; continue; }
    if (braceRow < 0) continue;                           // still before `{`
    if (BODY_TYPES.has(child.type) || child.type === "}") break;
    if (isComment(child)) {
      // Skip inline comments on the brace line — callers keep those on the
      // header line via braceLineCommentSuffix.
      if (child.startPosition.row === braceRow) continue;
      comments.push(formatComment(child, indent + 1));
    }
  }
  return comments.length > 0
    ? "\n" + comments.join("\n")
    : "";
}

/**
 * Inline comments sitting on the same line as a block's opening `{`
 * (e.g. `schema s {  // why this schema exists`). Returns a suffix string
 * ready to append to the header line, or "" when none exist. A comment can
 * never precede `{` on that line (it would comment the brace out), so every
 * brace-row comment belongs after the brace (sl-dz3n).
 */
function braceLineCommentSuffix(node: SyntaxNode): string {
  const openBrace = node.children.find(c => c.type === "{");
  if (!openBrace) return "";
  let suffix = "";
  for (const child of node.children) {
    if (isComment(child) && child.startPosition.row === openBrace.startPosition.row) {
      suffix += "  " + formatInlineComment(child);
    }
  }
  return suffix;
}

/**
 * Collect any comments inside a block node that appear after the body
 * but before the closing }. These are typically trailing inline comments
 * on the last body item. Returns the formatted comment lines.
 */
function collectBlockTrailingComments(
  node: SyntaxNode, bodyEndRow: number, indent: number
): string {
  const comments: string[] = [];
  let foundBody = false;
  const openBrace = node.children.find(c => c.type === "{");
  const openBraceRow = openBrace?.startPosition.row ?? -1;

  for (const child of node.children) {
    if (BODY_TYPES.has(child.type)) {
      foundBody = true;
      continue;
    }
    if (foundBody && isComment(child)) {
      // Skip comments already handled by the opening-brace inline logic
      if (child.startPosition.row === openBraceRow) continue;

      if (child.startPosition.row === bodyEndRow) {
        // Trailing inline comment on last line of body
        comments.push("  " + formatInlineComment(child));
      } else {
        comments.push("\n" + formatComment(child, indent + 1));
      }
    }
  }
  return comments.join("");
}

/** Check if a field_decl is multi-line (has a { } body — record or list_of record). */
function isMultiLineField(node: SyntaxNode): boolean {
  return node.children.some(c => c.type === "{");
}

/** Get the field name text from a field_decl. */
function fieldNameText(node: SyntaxNode): string {
  const fn = findChild(node, "field_name");
  if (!fn) return "";
  const inner = fn.children[0];
  return inner ? inner.text : "";
}

/** Get the display type string for a field_decl (for column alignment). */
function fieldTypeText(node: SyntaxNode): string {
  const hasListOf = node.children.some(c => c.type === "list_of");
  const typeExpr = findChild(node, "type_expr");
  const hasRecord = node.children.some(c => c.type === "record");

  if (hasListOf && hasRecord) return "list_of record";
  if (hasListOf && typeExpr) return "list_of " + typeExpr.text;
  if (hasRecord) return "record";
  if (typeExpr) return typeExpr.text;
  return "";
}

// ── Source File ───────────────────────────────────────────────────────────────

function formatSourceFile(root: SyntaxNode, source: string): string {
  const children = root.children;
  if (children.length === 0) return "";

  const parts: string[] = [];
  let prev: SyntaxNode | null = null;
  let seenNonComment = false;

  for (const child of children) {
    if (prev !== null) {
      parts.push(topLevelSep(prev, child, seenNonComment));
    }
    parts.push(formatTopLevel(child, source, 0));
    prev = child;
    if (!isComment(child)) seenNonComment = true;
  }

  return parts.join("");
}

// Blank-line rules between top-level constructs.
//
// Returning "\n"   = no blank line  (end current line, start next immediately)
// Returning "\n\n" = one blank line (one empty line separating the two items)
//
// Rules, by (predecessor, successor) pair:
//   import   → import:   no blank line  (imports form a dense block)
//   header†  → header†:  preserve source (blank only if source had one)
//   header†  → import:   no blank line  (header flows into imports)
//   header†  → block:    one blank line (header ends, content begins)
//   comment  → non-comment: no blank line  (comment belongs to what follows)
//   non-comment → comment: one blank line  (section-break before next comment)
//   comment  → comment:  no blank line  (consecutive comments stay together)
//   block    → block:    one blank line  (all other top-level blocks)
//
// † "header" = comment appearing before any non-comment construct.
function topLevelSep(prev: SyntaxNode, curr: SyntaxNode, seenNonComment: boolean): string {
  // import → import: no blank line
  if (isImport(prev) && isImport(curr)) return "\n";

  // File header comments (before any non-comment)
  if (!seenNonComment && isComment(prev)) {
    if (isComment(curr)) {
      // Preserve blank line between header comments when source had one
      return hasBlankBetween(prev, curr) ? "\n\n" : "\n";
    }
    if (isImport(curr)) return "\n";        // header → imports: no blank line
    return "\n\n";                          // header → first block: one blank line
  }

  // comment → non-comment: pull tight (comment annotates what follows)
  if (isComment(prev) && !isComment(curr)) return "\n";

  // non-comment → comment: one blank line (section break before comment)
  if (!isComment(prev) && isComment(curr)) return "\n\n";

  // comment → comment (between blocks): no blank line
  if (isComment(prev) && isComment(curr)) return "\n";

  // block → block (any combination): one blank line
  return "\n\n";
}

function formatTopLevel(node: SyntaxNode, source: string, indent: number): string {
  switch (node.type) {
    case "schema_block":    return formatSchemaBlock(node, source, indent);
    case "fragment_block":  return formatFragmentBlock(node, source, indent);
    case "mapping_block":   return formatMappingBlock(node, source, indent);
    case "transform_block": return formatTransformBlock(node, source, indent);
    case "note_block":      return formatNoteBlock(node, source, indent);
    case "import_decl":     return formatImportDecl(node, source, indent);
    case "namespace_block": return formatNamespaceBlock(node, source, indent);
    case "comment":
    case "warning_comment":
    case "question_comment":
      return formatComment(node, indent);
    default:
      // Fallback: reproduce source text
      return node.text;
  }
}

// ── Comments ──────────────────────────────────────────────────────────────────

function formatComment(node: SyntaxNode, indent: number): string {
  const text = node.text;
  // Section-header comments (// --- ... ---) are preserved as-is
  if (/^\/\/\s*---/.test(text)) return ind(indent) + text;

  // Normalize: ensure single space after comment marker
  const match = text.match(/^(\/\/[!?]?)\s*(.*)/);
  if (match) {
    const marker = match[1]!;
    const body = match[2]!;
    if (body.length === 0) return ind(indent) + marker;
    return ind(indent) + marker + " " + body;
  }
  return ind(indent) + text;
}

function formatInlineComment(node: SyntaxNode): string {
  const text = node.text;
  if (/^\/\/\s*---/.test(text)) return text;
  const match = text.match(/^(\/\/[!?]?)\s*(.*)/);
  if (match) {
    const marker = match[1]!;
    const body = match[2]!;
    if (body.length === 0) return marker;
    return marker + " " + body;
  }
  return text;
}

// ── Schema Block ──────────────────────────────────────────────────────────────

function formatSchemaBlock(node: SyntaxNode, source: string, indent: number): string {
  const label = findChild(node, "block_label");
  const meta = findChild(node, "metadata_block");
  const body = findChild(node, "schema_body");

  let line = ind(indent) + "schema " + formatBlockLabel(label!);
  if (meta) line += " " + formatMetadataBlock(meta, source, indent);
  line += " {" + braceLineCommentSuffix(node);

  const leading = collectBlockLeadingComments(node, indent);

  if (!body || body.namedChildren.length === 0) {
    const trailing = collectBlockTrailingComments(node, -1, indent);
    return line + leading + trailing + "\n" + ind(indent) + "}";
  }

  const bodyStr = formatSchemaBody(body, source, indent + 1);
  const trailing = collectBlockTrailingComments(node, body.endPosition.row, indent);
  return line + leading + "\n" + bodyStr + trailing + "\n" + ind(indent) + "}";
}

// ── Fragment Block ────────────────────────────────────────────────────────────

function formatFragmentBlock(node: SyntaxNode, source: string, indent: number): string {
  const label = findChild(node, "block_label");
  const body = findChild(node, "schema_body");

  let line = ind(indent) + "fragment " + formatBlockLabel(label!);
  line += " {" + braceLineCommentSuffix(node);

  const leading = collectBlockLeadingComments(node, indent);

  if (!body || body.namedChildren.length === 0) {
    const trailing = collectBlockTrailingComments(node, -1, indent);
    return line + leading + trailing + "\n" + ind(indent) + "}";
  }

  const bodyStr = formatSchemaBody(body, source, indent + 1);
  const trailing = collectBlockTrailingComments(node, body.endPosition.row, indent);
  return line + leading + "\n" + bodyStr + trailing + "\n" + ind(indent) + "}";
}

// ── Block Label ───────────────────────────────────────────────────────────────

function formatBlockLabel(node: SyntaxNode): string {
  const inner = node.children[0];
  if (!inner) return "";
  return inner.text; // identifier or quoted_name
}

// ── Schema Body (field alignment) ─────────────────────────────────────────────

function formatSchemaBody(body: SyntaxNode, source: string, indent: number): string {
  const children = body.children;
  if (children.length === 0) return "";

  // Gather all single-line field_decls for alignment calculation
  const singleLineFields: SyntaxNode[] = [];
  for (const c of children) {
    if (c.type === "field_decl" && !isMultiLineField(c)) {
      singleLineFields.push(c);
    }
  }

  // Calculate alignment columns from ALL single-line fields in the block
  const { nameCol, typeCol, metaCol } = calcFieldAlignment(singleLineFields);

  // Format each child in order with blank line preservation
  const lines: string[] = [];
  let prev: SyntaxNode | null = null;

  for (const child of children) {
    // Skip anonymous tokens (they're punctuation handled by parent)
    if (!child.isNamed && !isComment(child)) continue;

    // Blank line handling: preserve existing blank lines, normalize to 1
    if (prev !== null && hasBlankBetween(prev, child)) {
      lines.push("");
    }

    if (isComment(child)) {
      // Check if this is a trailing inline comment (same line as previous)
      if (prev !== null && sameLine(prev, child)) {
        // Append to previous line with 2-space gap
        const lastIdx = lines.length - 1;
        if (lastIdx >= 0) {
          lines[lastIdx] += "  " + formatInlineComment(child);
          prev = child;
          continue;
        }
      }
      lines.push(formatComment(child, indent));
    } else if (child.type === "field_decl") {
      if (isMultiLineField(child)) {
        lines.push(formatMultiLineField(child, source, indent));
      } else {
        lines.push(formatSingleLineField(child, source, indent, nameCol, typeCol, metaCol));
      }
    } else if (child.type === "fragment_spread") {
      lines.push(formatFragmentSpread(child, indent));
    } else if (child.type === "note_block") {
      // Note blocks are valid inside schema bodies (e.g. metric schemas carry
      // human-readable notes alongside their fields). Delegate to the same
      // note formatter used at the top-level and in mapping bodies.
      lines.push(formatNoteBlock(child, source, indent));
    }

    prev = child;
  }

  return lines.join("\n");
}

interface FieldAlignment {
  nameCol: number;   // max name width (capped)
  typeCol: number;   // column where type starts (relative to indent)
  metaCol: number;   // column where metadata starts (relative to indent)
}

/**
 * Return the visual width of a field name for column alignment purposes.
 * A backtick name that contains a newline spans multiple lines; the type
 * column continues from the last line, so only that line's character count
 * matters for alignment (sl-w5fs).
 */
function fieldNameDisplayWidth(name: string): number {
  const lastNewline = name.lastIndexOf("\n");
  return lastNewline === -1 ? name.length : name.length - lastNewline - 1;
}

function calcFieldAlignment(fields: SyntaxNode[]): FieldAlignment {
  let maxName = 0;
  let maxType = 0;

  for (const f of fields) {
    const name = fieldNameText(f);
    const type = fieldTypeText(f);
    if (fieldNameDisplayWidth(name) > maxName) maxName = fieldNameDisplayWidth(name);
    if (type.length > maxType) maxType = type.length;
  }

  const nameCol = Math.min(maxName, NAME_CAP);
  const typeCol = nameCol + 2;
  const typeWidth = Math.min(maxType, TYPE_CAP);
  const metaCol = typeCol + typeWidth + 2;

  return { nameCol, typeCol, metaCol };
}

function formatSingleLineField(
  node: SyntaxNode, source: string, indent: number,
  _nameCol: number, typeCol: number, metaCol: number
): string {
  const name = fieldNameText(node);
  const type = fieldTypeText(node);
  const meta = findChild(node, "metadata_block");

  // Name padding — use the last-line width so multiline backtick names align
  // correctly (the type column starts after the last line of the name).
  const nameGap = Math.max(typeCol - fieldNameDisplayWidth(name), 2);
  let line = ind(indent) + name + " ".repeat(nameGap) + type;

  if (meta) {
    // Check if metadata should be multi-line (contains multiline_string,
    // comments, or too long) — formatMetadataBlock handles all three.
    if (hasMultilineString(meta) || meta.children.some(isComment)) {
      line += " " + formatMetadataBlock(meta, source, indent);
    } else {
      const metaStr = formatMetadataInline(meta, source);
      const typeGap = Math.max(metaCol - typeCol - type.length, 2);
      const candidateLine = line + " ".repeat(typeGap) + metaStr;
      if (candidateLine.length > 80) {
        // Too long for one line — use multi-line metadata
        line += " " + formatMetadataBlock(meta, source, indent);
      } else {
        line += " ".repeat(typeGap) + metaStr;
      }
    }
  }

  return line;
}

function formatMultiLineField(node: SyntaxNode, source: string, indent: number): string {
  const name = fieldNameText(node);
  const hasListOf = node.children.some(c => c.type === "list_of");
  const hasRecord = node.children.some(c => c.type === "record");
  const meta = findChild(node, "metadata_block");
  const body = findChild(node, "schema_body");

  let line = ind(indent) + name + " ";
  if (hasListOf) line += "list_of ";
  if (hasRecord) line += "record";

  if (meta) {
    line += " " + formatMetadataBlock(meta, source, indent);
  }

  line += " {" + braceLineCommentSuffix(node);

  const openBrace = node.children.find(c => c.type === "{");
  const leading = collectBlockLeadingComments(node, indent);

  if (!body || body.namedChildren.length === 0) {
    const trailing = collectBlockTrailingComments(node, openBrace?.startPosition.row ?? -1, indent);
    return line + leading + trailing + "\n" + ind(indent) + "}";
  }

  const bodyStr = formatSchemaBody(body, source, indent + 1);
  const trailing = collectBlockTrailingComments(node, body.endPosition.row, indent);
  return line + leading + "\n" + bodyStr + trailing + "\n" + ind(indent) + "}";
}

// ── Fragment Spread ───────────────────────────────────────────────────────────

function formatFragmentSpread(node: SyntaxNode, indent: number): string {
  const label = findChild(node, "spread_label");
  if (!label) return ind(indent) + node.text;

  const inner = label.children[0];
  if (!inner) return ind(indent) + "..." + label.text;

  // spread_label can be: quoted_name, qualified_name, or _spread_words (multiple identifiers)
  if (inner.type === "backtick_name") {
    return ind(indent) + "..." + inner.text;
  }
  if (inner.type === "qualified_name") {
    return ind(indent) + "..." + inner.text;
  }
  // _spread_words: identifier followed by zero or more continuation_words
  const words = label.children
    .filter(c => c.type === "identifier" || c.type === "continuation_word")
    .map(c => c.text);
  return ind(indent) + "..." + words.join(" ");
}

// ── Mapping Block ─────────────────────────────────────────────────────────────

function formatMappingBlock(node: SyntaxNode, source: string, indent: number): string {
  const label = findChild(node, "block_label");
  const meta = findChild(node, "metadata_block");
  const body = findChild(node, "mapping_body");

  let line = ind(indent) + "mapping";
  if (label) line += " " + formatBlockLabel(label);
  if (meta) line += " " + formatMetadataBlock(meta, source, indent);
  line += " {" + braceLineCommentSuffix(node);

  const leading = collectBlockLeadingComments(node, indent);

  if (!body) {
    const trailing = collectBlockTrailingComments(node, -1, indent);
    return line + leading + trailing + "\n" + ind(indent) + "}";
  }

  const bodyStr = formatMappingBody(body, source, indent + 1);
  const trailing = collectBlockTrailingComments(node, body.endPosition.row, indent);
  return line + leading + "\n" + bodyStr + trailing + "\n" + ind(indent) + "}";
}

// ── Mapping Body ──────────────────────────────────────────────────────────────

function formatMappingBody(body: SyntaxNode, source: string, indent: number): string {
  const children = body.children;
  const lines: string[] = [];
  let prev: SyntaxNode | null = null;

  for (const child of children) {
    if (!child.isNamed && !isComment(child)) continue;

    // Blank line preservation
    if (prev !== null && hasBlankBetween(prev, child)) {
      lines.push("");
    }

    if (isComment(child)) {
      if (prev !== null && sameLine(prev, child)) {
        const lastIdx = lines.length - 1;
        if (lastIdx >= 0) {
          lines[lastIdx] += "  " + formatInlineComment(child);
          prev = child;
          continue;
        }
      }
      lines.push(formatComment(child, indent));
    } else {
      switch (child.type) {
        case "source_block":
          lines.push(formatSourceBlock(child, source, indent));
          break;
        case "target_block":
          lines.push(formatTargetBlock(child, source, indent));
          break;
        case "map_arrow":
          lines.push(formatMapArrow(child, source, indent));
          break;
        case "computed_arrow":
          lines.push(formatComputedArrow(child, source, indent));
          break;
        case "nested_arrow":
          lines.push(formatNestedArrow(child, source, indent));
          break;
        case "each_block":
          lines.push(formatEachFlattenBlock(child, source, indent, "each"));
          break;
        case "flatten_block":
          lines.push(formatEachFlattenBlock(child, source, indent, "flatten"));
          break;
        case "note_block":
          lines.push(formatNoteBlock(child, source, indent));
          break;
        default:
          lines.push(ind(indent) + child.text);
      }
    }
    prev = child;
  }

  return lines.join("\n");
}

// ── Source/Target Blocks ──────────────────────────────────────────────────────

// An entry (source ref / join string) or a comment inside a source/target
// block, in source order. Comments force the multi-line layout (sl-dz3n).
type SourceBlockItem = { node: SyntaxNode; text: string; isComment: boolean };

/** Gather refs, join strings, and body comments of a source/target block in order. */
function collectSourceBlockItems(node: SyntaxNode, source: string): SourceBlockItem[] {
  const openBrace = node.children.find(c => c.type === "{");
  const braceRow = openBrace?.startPosition.row ?? -1;

  const items: SourceBlockItem[] = [];
  for (const child of node.children) {
    if (child.type === "source_ref") {
      items.push({ node: child, text: formatSourceRef(child, source), isComment: false });
    } else if (child.type === "nl_string") {
      items.push({ node: child, text: child.text, isComment: false });
    } else if (isComment(child) && child.startPosition.row !== braceRow) {
      // Brace-row comments stay on the header line via braceLineCommentSuffix.
      items.push({ node: child, text: "", isComment: true });
    }
  }
  return items;
}

/**
 * Lay out source/target block entries one per line, interleaving comments:
 * a comment on the same line as the previous entry stays appended to it,
 * others get their own line. `withCommas` selects the source-block style
 * (comma-separated, sl-q9oj); target blocks have no commas.
 */
function formatSourceBlockBody(
  items: SourceBlockItem[], indent: number, withCommas: boolean
): string {
  const entryCount = items.filter(i => !i.isComment).length;
  const lines: string[] = [];
  let entryIdx = 0;
  let prev: SyntaxNode | null = null;

  for (const item of items) {
    if (item.isComment) {
      if (prev !== null && sameLine(prev, item.node) && lines.length > 0) {
        lines[lines.length - 1] += "  " + formatInlineComment(item.node);
      } else {
        lines.push(formatComment(item.node, indent + 1));
      }
    } else {
      entryIdx += 1;
      const comma = withCommas && entryIdx < entryCount ? "," : "";
      lines.push(ind(indent + 1) + item.text + comma);
    }
    prev = item.node;
  }
  return lines.join("\n");
}

function formatSourceBlock(node: SyntaxNode, source: string, indent: number): string {
  const items = collectSourceBlockItems(node, source);
  const entries = items.filter(i => !i.isComment);
  const nlStrings = entries.filter(i => i.node.type === "nl_string");
  const braceSuffix = braceLineCommentSuffix(node);
  const hasComments = braceSuffix !== "" || items.some(i => i.isComment);

  if (items.length === 0) {
    // An empty block can still carry a brace-row comment: `source {  // c`
    return braceSuffix
      ? ind(indent) + "source {" + braceSuffix + "\n" + ind(indent) + "}"
      : ind(indent) + "source { }";
  }

  // Try single-line (comments can never share a single line — they would
  // comment out the closing brace)
  const entryTexts = entries.map(i => i.text);
  const singleLine = ind(indent) + "source { " + entryTexts.join(", ") + " }";
  if (!hasComments && singleLine.length <= 80 && !entryTexts.some(s => s.includes("\n"))) {
    // For multi-ref sources, use multi-line
    if (entries.length <= 1 && nlStrings.length === 0) {
      return singleLine;
    }
  }

  // Multi-line. The grammar treats commas between source entries as optional,
  // but the canonical corpus style is comma-separated — preserve it so
  // formatting matches the single-line style and round-trips (sl-q9oj).
  const inner = formatSourceBlockBody(items, indent, true);
  return ind(indent) + "source {" + braceSuffix + "\n" + inner + "\n" + ind(indent) + "}";
}

function formatTargetBlock(node: SyntaxNode, source: string, indent: number): string {
  const items = collectSourceBlockItems(node, source)
    .filter(i => i.isComment || i.node.type === "source_ref");
  const entries = items.filter(i => !i.isComment);
  const braceSuffix = braceLineCommentSuffix(node);
  const hasComments = braceSuffix !== "" || items.some(i => i.isComment);

  if (items.length === 0) {
    // An empty block can still carry a brace-row comment: `target {  // c`
    return braceSuffix
      ? ind(indent) + "target {" + braceSuffix + "\n" + ind(indent) + "}"
      : ind(indent) + "target { }";
  }

  const singleLine = ind(indent) + "target { " + (entries[0]?.text ?? "") + " }";
  if (!hasComments && singleLine.length <= 80 && entries.length === 1) {
    return singleLine;
  }

  const inner = formatSourceBlockBody(items, indent, false);
  return ind(indent) + "target {" + braceSuffix + "\n" + inner + "\n" + ind(indent) + "}";
}

function formatSourceRef(node: SyntaxNode, source: string): string {
  const parts: string[] = [];
  for (const child of node.children) {
    if (child.type === "metadata_block") {
      parts.push(formatMetadataInline(child, source));
    } else if (child.isNamed || child.type === "identifier" || child.type === "qualified_name" || child.type === "backtick_name" || child.type === "nl_string") {
      parts.push(child.text);
    }
  }
  return parts.join(" ");
}

// ── Arrows ────────────────────────────────────────────────────────────────────

/**
 * Render an arrow's transform body (` { pipe_chain }`) appended to the given
 * header line. Inline when the chain is comment-free and fits in 80 columns;
 * otherwise multi-line, preserving comments in all four body positions:
 * on the brace row, between `{` and the chain, between pipe steps, and
 * between the chain and `}` (sl-dz3n).
 */
function formatArrowTransformBody(
  node: SyntaxNode, pipeChain: SyntaxNode, line: string, source: string, indent: number
): string {
  // Comments that are direct children of the arrow node all live inside the
  // braces: a `//` comment before `{` would comment the brace out.
  const hasBodyComments = node.children.some(isComment);

  const chainStr = formatPipeChain(pipeChain, source, indent);
  const inlineCandidate = line + " { " + chainStr + " }";
  if (!hasBodyComments && isInlinePipeChain(pipeChain) && inlineCandidate.length <= 80) {
    return inlineCandidate;
  }

  const braceSuffix = braceLineCommentSuffix(node);
  const leading = collectBlockLeadingComments(node, indent);
  const trailing = collectBlockTrailingComments(node, pipeChain.endPosition.row, indent);
  return line + " {" + braceSuffix + leading + "\n"
    + formatPipeChainMultiLine(pipeChain, source, indent + 1)
    + trailing + "\n" + ind(indent) + "}";
}

function formatMapArrow(node: SyntaxNode, source: string, indent: number): string {
  const srcPaths = findChildren(node, "src_path");
  const tgtPath = findChild(node, "tgt_path");
  const meta = findChild(node, "metadata_block");
  const pipeChain = findChild(node, "pipe_chain");

  let line = ind(indent);
  if (srcPaths.length > 0) line += srcPaths.map((s) => formatPath(s)).join(", ");
  line += " -> " + formatPath(tgtPath!);

  if (meta) line += " " + formatMetadataInline(meta, source, indent);

  if (pipeChain) {
    return formatArrowTransformBody(node, pipeChain, line, source, indent);
  }

  return line;
}

function formatComputedArrow(node: SyntaxNode, source: string, indent: number): string {
  const tgtPath = findChild(node, "tgt_path");
  const meta = findChild(node, "metadata_block");
  const pipeChain = findChild(node, "pipe_chain");

  let line = ind(indent) + "-> " + formatPath(tgtPath!);

  if (meta) line += " " + formatMetadataInline(meta, source, indent);

  if (pipeChain) {
    return formatArrowTransformBody(node, pipeChain, line, source, indent);
  }

  return line;
}

function formatNestedArrow(node: SyntaxNode, source: string, indent: number): string {
  const srcPath = findChild(node, "src_path");
  const tgtPath = findChild(node, "tgt_path");
  const meta = findChild(node, "metadata_block");

  let line = ind(indent) + formatPath(srcPath!) + " -> " + formatPath(tgtPath!);
  if (meta) line += " " + formatMetadataInline(meta, source, indent);

  // Inner arrows
  const innerArrows = node.children.filter(c =>
    c.type === "map_arrow" || c.type === "computed_arrow" || c.type === "nested_arrow"
  );

  if (innerArrows.length === 0) {
    return line + " { }";
  }

  const innerLines: string[] = [];
  let prev: SyntaxNode | null = null;
  for (const child of node.children) {
    if (!child.isNamed && !isComment(child)) continue;
    if (child.type === "src_path" || child.type === "tgt_path" || child.type === "metadata_block") continue;

    if (prev !== null && hasBlankBetween(prev, child)) {
      innerLines.push("");
    }

    if (isComment(child)) {
      if (prev !== null && sameLine(prev, child)) {
        const lastIdx = innerLines.length - 1;
        if (lastIdx >= 0) {
          innerLines[lastIdx] += "  " + formatInlineComment(child);
          prev = child;
          continue;
        }
      }
      innerLines.push(formatComment(child, indent + 1));
    } else if (child.type === "map_arrow") {
      innerLines.push(formatMapArrow(child, source, indent + 1));
    } else if (child.type === "computed_arrow") {
      innerLines.push(formatComputedArrow(child, source, indent + 1));
    } else if (child.type === "nested_arrow") {
      innerLines.push(formatNestedArrow(child, source, indent + 1));
    }
    prev = child;
  }

  return line + " {\n" + innerLines.join("\n") + "\n" + ind(indent) + "}";
}

// ── Each/Flatten Blocks ───────────────────────────────────────────────────────

function formatEachFlattenBlock(
  node: SyntaxNode, source: string, indent: number, keyword: string
): string {
  const srcPath = findChild(node, "src_path");
  const tgtPath = findChild(node, "tgt_path");
  const meta = findChild(node, "metadata_block");

  let line = ind(indent) + keyword + " " + formatPath(srcPath!) + " -> " + formatPath(tgtPath!);

  if (meta) {
    line += " " + formatMetadataBlock(meta, source, indent);
  }

  line += " {";

  // Inner items: arrow declarations plus nested each/flatten sub-blocks
  // (grammar rule _nested_block_item allows iteration blocks to nest).
  const innerLines: string[] = [];
  let prev: SyntaxNode | null = null;

  for (const child of node.children) {
    if (!child.isNamed && !isComment(child)) continue;
    if (child.type === "src_path" || child.type === "tgt_path" || child.type === "metadata_block") continue;
    if (child.type === keyword) continue; // skip the keyword itself

    if (prev !== null && hasBlankBetween(prev, child)) {
      innerLines.push("");
    }

    if (isComment(child)) {
      if (prev !== null && sameLine(prev, child)) {
        const lastIdx = innerLines.length - 1;
        if (lastIdx >= 0) {
          innerLines[lastIdx] += "  " + formatInlineComment(child);
          prev = child;
          continue;
        }
      }
      innerLines.push(formatComment(child, indent + 1));
    } else if (child.type === "map_arrow") {
      innerLines.push(formatMapArrow(child, source, indent + 1));
    } else if (child.type === "computed_arrow") {
      innerLines.push(formatComputedArrow(child, source, indent + 1));
    } else if (child.type === "nested_arrow") {
      innerLines.push(formatNestedArrow(child, source, indent + 1));
    } else if (child.type === "each_block") {
      innerLines.push(formatEachFlattenBlock(child, source, indent + 1, "each"));
    } else if (child.type === "flatten_block") {
      innerLines.push(formatEachFlattenBlock(child, source, indent + 1, "flatten"));
    }
    prev = child;
  }

  if (innerLines.length === 0) {
    return line + "\n" + ind(indent) + "}";
  }

  return line + "\n" + innerLines.join("\n") + "\n" + ind(indent) + "}";
}

// ── Path Formatting ───────────────────────────────────────────────────────────

function formatPath(node: SyntaxNode): string {
  // Reconstruct path from children: identifiers, dots, backtick_names, ::
  const parts: string[] = [];
  for (const child of node.children) {
    // The path node wraps a field_path, relative_field_path, namespaced_path, or backtick_path
    if (child.childCount > 0) {
      return formatPath(child);
    }
    parts.push(child.text);
  }
  return parts.join("");
}

// ── Pipe Chain ────────────────────────────────────────────────────────────────

function isInlinePipeChain(node: SyntaxNode): boolean {
  // A pipe chain can be formatted inline unless it contains a multiline string
  // (triple-quoted) or a comment — a `//` comment on a single line would
  // comment out everything after it (sl-dz3n). Single-quoted NL strings are
  // fine on one line. All pipe steps are NL after Feature 28 — the old
  // heuristic that excluded any nl_string is moot.
  for (const child of node.children) {
    if (isComment(child)) return false;
    if (child.type === "pipe_step") {
      const inner = child.children[0];
      if (inner && inner.type === "multiline_string") {
        return false;
      }
    }
  }
  return true;
}

function formatPipeChain(node: SyntaxNode, source: string, indent: number): string {
  // Inline format: step1 | step2 | step3
  const steps: string[] = [];
  for (const child of node.children) {
    if (child.type === "pipe_step") {
      steps.push(formatPipeStep(child, source, indent));
    }
  }
  return steps.join(" | ");
}

function formatPipeChainMultiLine(node: SyntaxNode, source: string, indent: number): string {
  // Multi-line: each step on its own line, pipe continuation. Comments
  // between steps are preserved in place — same-line comments stay appended
  // to their step, own-line comments keep their own line (sl-dz3n).
  const lines: string[] = [];
  let stepCount = 0;
  let prev: SyntaxNode | null = null;

  for (const child of node.children) {
    if (child.type === "pipe_step") {
      const step = formatPipeStep(child, source, indent);
      lines.push(ind(indent) + (stepCount === 0 ? "" : "| ") + step);
      stepCount += 1;
      prev = child;
    } else if (isComment(child)) {
      if (prev !== null && sameLine(prev, child) && lines.length > 0) {
        lines[lines.length - 1] += "  " + formatInlineComment(child);
      } else {
        lines.push(formatComment(child, indent));
      }
      prev = child;
    }
  }
  return lines.join("\n");
}

function formatPipeStep(node: SyntaxNode, source: string, indent: number): string {
  const inner = node.children[0];
  if (!inner) return "";

  switch (inner.type) {
    case "pipe_text":
      return inner.text;
    case "map_literal":
      return formatMapLiteral(inner, source, indent);
    case "fragment_spread":
      return formatFragmentSpread(inner, 0).trimStart();
    default:
      return inner.text;
  }
}

function formatMapLiteral(node: SyntaxNode, _source: string, indent: number): string {
  const entries = findChildren(node, "map_entry");

  if (entries.length === 0) return "map { }";

  // Try single-line: map { key: val, key: val }
  const entryStrs = entries.map(e => formatMapEntry(e));
  const singleLine = "map { " + entryStrs.join(", ") + " }";
  if (singleLine.length + ind(indent).length <= 80 && entries.length <= 3) {
    return singleLine;
  }

  // Multi-line
  const inner = entryStrs.map(e => ind(indent + 1) + e).join("\n");
  return "map {\n" + inner + "\n" + ind(indent) + "}";
}

function formatMapEntry(node: SyntaxNode): string {
  const key = findChild(node, "map_key");
  const value = findChild(node, "map_value");
  if (!key || !value) return node.text;

  return formatMapKey(key) + ": " + value.text;
}

function formatMapKey(node: SyntaxNode): string {
  // map_key children may be hidden (comparison ops, default, null, _).
  // Use node.text directly — it always contains the correct key text.
  return node.text.replace(/\s+/g, " ").trim();
}

// ── Transform Block ───────────────────────────────────────────────────────────

function formatTransformBlock(node: SyntaxNode, source: string, indent: number): string {
  const label = findChild(node, "block_label");
  const pipeChain = findChild(node, "pipe_chain");

  const line = ind(indent) + "transform " + formatBlockLabel(label!);

  if (!pipeChain) {
    return line + " { }";
  }

  const braceSuffix = braceLineCommentSuffix(node);
  const leading = collectBlockLeadingComments(node, indent);
  const trailing = collectBlockTrailingComments(node, pipeChain.endPosition.row, indent);

  // Try single-line (only when no comments exist anywhere in the body)
  const chainStr = formatPipeChain(pipeChain, source, indent);
  const singleLine = line + " { " + chainStr + " }";
  if (!braceSuffix && !leading && !trailing && isInlinePipeChain(pipeChain) && singleLine.length <= 80) {
    return line + " {\n" + ind(indent + 1) + chainStr + "\n" + ind(indent) + "}";
  }

  const bodyStr = formatPipeChainMultiLine(pipeChain, source, indent + 1);
  return line + " {" + braceSuffix + leading + "\n" + bodyStr + trailing + "\n" + ind(indent) + "}";
}

// ── Note Block ────────────────────────────────────────────────────────────────

function formatNoteBlock(node: SyntaxNode, _source: string, indent: number): string {
  // note { "..." } or note { """...""" } or note { "line1" "line2" }
  // Body items in source order: strings plus any comments between them
  // (sl-dz3n). Brace-row comments stay on the `note {` line via the suffix.
  const braceSuffix = braceLineCommentSuffix(node);
  const openBrace = node.children.find(c => c.type === "{");
  const braceRow = openBrace?.startPosition.row ?? -1;

  const items: SyntaxNode[] = [];
  for (const child of node.children) {
    if (child.type === "nl_string" || child.type === "multiline_string") {
      items.push(child);
    } else if (isComment(child) && child.startPosition.row !== braceRow) {
      items.push(child);
    }
  }

  if (items.length === 0) {
    return braceSuffix
      ? ind(indent) + "note {" + braceSuffix + "\n" + ind(indent) + "}"
      : ind(indent) + "note { }";
  }

  // Lay out one item per line; a comment on the same line as the previous
  // string stays appended to it, other comments keep their own line.
  const lines: string[] = [];
  let prev: SyntaxNode | null = null;
  for (const item of items) {
    if (isComment(item)) {
      if (prev !== null && sameLine(prev, item) && lines.length > 0) {
        lines[lines.length - 1] += "  " + formatInlineComment(item);
      } else {
        lines.push(formatComment(item, indent + 1));
      }
    } else if (item.type === "multiline_string") {
      lines.push(formatMultilineString(item, indent + 1));
    } else {
      lines.push(ind(indent + 1) + item.text);
    }
    prev = item;
  }

  return ind(indent) + "note {" + braceSuffix + "\n" + lines.join("\n") + "\n" + ind(indent) + "}";
}

function formatMultilineString(node: SyntaxNode, indent: number): string {
  // Triple-quoted strings: preserve content verbatim but fix delimiter indentation
  const text = node.text;
  // Split into lines
  const lines = text.split("\n");
  if (lines.length <= 1) return ind(indent) + text;

  // The spec says: "Content inside strings is never modified."
  // The triple-quoted string is a single token including delimiters and content.
  // Preserve content verbatim — just output at the current indent position.
  return ind(indent) + text;
}

// ── Import Declaration ────────────────────────────────────────────────────────

function formatImportDecl(node: SyntaxNode, _source: string, indent: number): string {
  const names: string[] = [];
  for (const child of node.children) {
    if (child.type === "import_name") {
      names.push(formatImportName(child));
    }
  }

  const path = findChild(node, "import_path");
  const pathStr = path ? path.children[0]?.text || path.text : "";

  return ind(indent) + "import { " + names.join(", ") + " } from " + pathStr;
}

function formatImportName(node: SyntaxNode): string {
  const inner = node.children[0];
  if (!inner) return node.text;
  return inner.text;
}

// ── Namespace Block ───────────────────────────────────────────────────────────

function formatNamespaceBlock(node: SyntaxNode, source: string, indent: number): string {
  const name = node.children.find(c => c.type === "identifier");
  const meta = findChild(node, "metadata_block");

  let line = ind(indent) + "namespace " + (name?.text || "");
  if (meta) line += " " + formatMetadataBlock(meta, source, indent);
  line += " {";

  // Inner items (schemas, mappings, etc.)
  const innerItems: SyntaxNode[] = [];
  let insideBody = false;
  for (const child of node.children) {
    if (child.type === "{") { insideBody = true; continue; }
    if (child.type === "}") break;
    if (insideBody && (child.isNamed || isComment(child))) {
      innerItems.push(child);
    }
  }

  if (innerItems.length === 0) {
    return line + "\n" + ind(indent) + "}";
  }

  // Format inner items like a mini source_file
  const innerParts: string[] = [];
  let prev: SyntaxNode | null = null;
  let seenNonComment = false;

  for (const item of innerItems) {
    if (prev !== null) {
      innerParts.push(namespaceSep(prev, item, seenNonComment));
    }
    innerParts.push(formatTopLevel(item, source, indent + 1));
    prev = item;
    if (!isComment(item)) seenNonComment = true;
  }

  return line + "\n" + innerParts.join("") + "\n" + ind(indent) + "}";
}

function namespaceSep(prev: SyntaxNode, curr: SyntaxNode, _seenNonComment: boolean): string {
  // Within namespaces, use 1 blank line between blocks
  if (isComment(prev) && !isComment(curr)) return "\n";
  if (!isComment(prev) && isComment(curr)) return "\n\n";
  if (isComment(prev) && isComment(curr)) return "\n";
  return "\n\n";
}

// ── Metadata Block ────────────────────────────────────────────────────────────

function hasMultilineString(node: SyntaxNode): boolean {
  for (const child of node.children) {
    if (child.type === "multiline_string") return true;
    if (child.type === "note_tag") {
      for (const inner of child.children) {
        if (inner.type === "multiline_string") return true;
      }
    }
    if (child.childCount > 0 && hasMultilineString(child)) return true;
  }
  return false;
}

// A metadata entry or a comment between entries, in source order. Comments
// force the multi-line layout, where they survive on their own line or
// appended to the entry they share a line with (sl-dz3n).
type MetadataItem = { node: SyntaxNode; text: string; isComment: boolean };

function formatMetadataBlock(node: SyntaxNode, source: string, indent: number): string {
  const items = collectMetadataItems(node, source);

  if (items.length === 0) return "()";

  // Comments cannot share a single line (they would comment out everything
  // after them), and multiline strings never fit one — both force multi-line.
  if (items.some(i => i.isComment) || hasMultilineString(node)) {
    return formatMetadataMultiLine(items, indent);
  }

  // Try single-line
  const singleLine = "(" + items.map(i => i.text).join(", ") + ")";
  if (singleLine.length + ind(indent).length + 20 <= 80) { // rough line length check
    return singleLine;
  }

  // Multi-line
  return formatMetadataMultiLine(items, indent);
}

function formatMetadataInline(node: SyntaxNode, source: string, indent: number = 0): string {
  const items = collectMetadataItems(node, source);
  // Inline contexts (arrows, source refs) still fall back to the multi-line
  // layout when comments are present — there is no way to keep a `//`
  // comment on a shared line without commenting out the rest of it (sl-dz3n).
  if (items.some(i => i.isComment)) {
    return formatMetadataMultiLine(items, indent);
  }
  return "(" + items.map(i => i.text).join(", ") + ")";
}

function formatMetadataMultiLine(items: MetadataItem[], indent: number): string {
  if (items.length === 0) return "()";

  const entryCount = items.filter(i => !i.isComment).length;
  const lines: string[] = ["("];
  let entryIdx = 0;
  let prev: SyntaxNode | null = null;

  for (const item of items) {
    if (item.isComment) {
      if (prev !== null && sameLine(prev, item.node) && lines.length > 1) {
        lines[lines.length - 1] += "  " + formatInlineComment(item.node);
      } else {
        lines.push(formatComment(item.node, indent + 1));
      }
    } else {
      entryIdx += 1;
      const comma = entryIdx < entryCount ? "," : "";
      lines.push(ind(indent + 1) + item.text + comma);
    }
    prev = item.node;
  }
  lines.push(ind(indent) + ")");
  return lines.join("\n");
}

/** Gather metadata entries and the comments between them, in source order. */
function collectMetadataItems(node: SyntaxNode, source: string): MetadataItem[] {
  const items: MetadataItem[] = [];
  for (const child of node.children) {
    if (child.type === "(" || child.type === ")" || child.type === ",") continue;
    if (isComment(child)) {
      items.push({ node: child, text: "", isComment: true });
    } else {
      items.push({ node: child, text: formatMetadataEntry(child, source), isComment: false });
    }
  }
  return items;
}

function formatMetadataEntry(node: SyntaxNode, source: string): string {
  switch (node.type) {
    case "tag_token": {
      const id = findChild(node, "identifier");
      return id ? id.text : node.text;
    }
    case "tag_with_value": {
      return formatTagWithValue(node);
    }
    case "note_tag": {
      return formatNoteTag(node, source);
    }
    case "enum_body": {
      return formatEnumBody(node);
    }
    case "slice_body": {
      return formatSliceBody(node);
    }
    default:
      return node.text;
  }
}

function formatTagWithValue(node: SyntaxNode): string {
  const key = node.namedChildren[0]; // identifier
  const val = node.namedChildren[1]; // value_text
  if (!key) return node.text;
  return val ? key.text + " " + val.text : key.text;
}

function formatNoteTag(node: SyntaxNode, _source: string): string {
  // note "string" or note """multiline"""
  for (const child of node.children) {
    if (child.type === "nl_string") return "note " + child.text;
    if (child.type === "multiline_string") return "note " + child.text;
  }
  return "note";
}

function formatEnumBody(node: SyntaxNode): string {
  const items: string[] = [];
  for (const child of node.children) {
    if (child.type === "enum" || child.type === "{" || child.type === "}" || child.type === ",") continue;
    items.push(child.text);
  }
  return "enum {" + items.join(", ") + "}";
}

function formatSliceBody(node: SyntaxNode): string {
  const items: string[] = [];
  for (const child of node.children) {
    if (child.type === "slice" || child.type === "{" || child.type === "}" || child.type === ",") continue;
    if (child.type === "identifier") items.push(child.text);
  }
  return "slice {" + items.join(", ") + "}";
}

