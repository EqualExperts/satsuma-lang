import {
  SemanticTokensBuilder,
  SemanticTokenTypes,
  SemanticTokenModifiers,
  SemanticTokensLegend,
} from "vscode-languageserver";
import type { Tree, Query } from "web-tree-sitter";
import { createAtRefRegex } from "@satsuma/core";
import { getLanguage, createQuery } from "./parser-utils";
import type { SyntaxNode } from "./parser-utils";

// ---------- Legend ----------

/** Ordered token types — index positions are referenced by the builder. */
const tokenTypes: string[] = [
  SemanticTokenTypes.keyword, // 0
  SemanticTokenTypes.type, // 1
  SemanticTokenTypes.function, // 2
  SemanticTokenTypes.variable, // 3
  SemanticTokenTypes.property, // 4
  SemanticTokenTypes.string, // 5
  SemanticTokenTypes.comment, // 6
  SemanticTokenTypes.decorator, // 7
  SemanticTokenTypes.namespace, // 8
  SemanticTokenTypes.operator, // 9
  SemanticTokenTypes.enumMember, // 10
  SemanticTokenTypes.number, // 11 (unused, but standard)
];

/** Ordered token modifiers — bitmask positions. */
const tokenModifiers: string[] = [
  SemanticTokenModifiers.definition, // 0
  SemanticTokenModifiers.declaration, // 1
  SemanticTokenModifiers.readonly, // 2
  SemanticTokenModifiers.defaultLibrary, // 3
  "nlRef", // 4 — @ref inside NL string
];

export const semanticTokensLegend: SemanticTokensLegend = {
  tokenTypes,
  tokenModifiers,
};

// ---------- Capture name → token type/modifier mapping ----------

interface TokenMapping {
  typeIndex: number;
  modifierBits: number;
}

/**
 * Map highlights.scm capture names to LSP semantic token type indices
 * and modifier bitmasks.
 */
const CAPTURE_MAP: Record<string, TokenMapping> = {
  // Keywords
  keyword: { typeIndex: 0, modifierBits: 0 },
  "keyword.import": { typeIndex: 0, modifierBits: 0 },
  "keyword.context": { typeIndex: 0, modifierBits: 0 },
  "keyword.operator": { typeIndex: 0, modifierBits: 0 },

  // Block labels — definitions
  "type.definition": { typeIndex: 1, modifierBits: 1 << 0 }, // type + definition
  "function.definition": { typeIndex: 2, modifierBits: 1 << 0 }, // function + definition
  module: { typeIndex: 8, modifierBits: 0 }, // namespace

  // Fields and variables
  "variable.field": { typeIndex: 4, modifierBits: 0 }, // property
  variable: { typeIndex: 3, modifierBits: 0 }, // variable

  // Types
  type: { typeIndex: 1, modifierBits: 0 },

  // Metadata / decorators
  attribute: { typeIndex: 7, modifierBits: 0 }, // decorator

  // Strings
  string: { typeIndex: 5, modifierBits: 0 },
  "string.special": { typeIndex: 5, modifierBits: 0 },
  "string.multiline": { typeIndex: 5, modifierBits: 0 },
  "string.path": { typeIndex: 5, modifierBits: 0 },

  // Comments
  comment: { typeIndex: 6, modifierBits: 0 },
  "comment.warning": { typeIndex: 6, modifierBits: 0 },
  "comment.question": { typeIndex: 6, modifierBits: 0 },

  // Constants (enum values, map keys/values, builtins)
  constant: { typeIndex: 10, modifierBits: 0 }, // enumMember
  "constant.builtin": { typeIndex: 10, modifierBits: 1 << 3 }, // enumMember + defaultLibrary

  // Operators / punctuation
  operator: { typeIndex: 9, modifierBits: 0 },
  "punctuation.bracket": { typeIndex: 9, modifierBits: 0 },
  "punctuation.delimiter": { typeIndex: 9, modifierBits: 0 },
};

// ---------- Query loading ----------

let _query: Query | null = null;
let _highlightsSource: string | null = null;

/**
 * Set the highlights.scm source that will be used for semantic token queries.
 * Must be called once during server initialisation (before any document is parsed).
 */
export function setHighlightsSource(source: string): void {
  _highlightsSource = source;
  _query = null; // reset cached query
}

function getHighlightsQuery(): Query {
  if (_query) return _query;
  if (!_highlightsSource)
    throw new Error("highlights.scm not loaded — call setHighlightsSource() first");
  const language = getLanguage();
  _query = createQuery(language, _highlightsSource);
  return _query;
}

// ---------- Public API ----------

/**
 * Compute semantic tokens from a tree-sitter parse tree using highlights.scm.
 *
 * Returns encoded tokens suitable for the LSP semanticTokens/full response.
 */
export function computeSemanticTokens(tree: Tree): { data: number[] } {
  const query = getHighlightsQuery();
  const captures = query.captures(tree.rootNode);

  // Pre-scan: identify nl_string/multiline_string nodes that contain @refs.
  // These need split tokenisation instead of a single string token.
  const nlRefNodes = collectNlRefNodes(tree.rootNode);

  // Sort captures by position (row, then column) — tree-sitter captures
  // should already be ordered, but ensure it for the delta encoding.
  captures.sort((a: { node: SyntaxNode }, b: { node: SyntaxNode }) => {
    const rowDiff = a.node.startPosition.row - b.node.startPosition.row;
    if (rowDiff !== 0) return rowDiff;
    return a.node.startPosition.column - b.node.startPosition.column;
  });

  // Deduplicate: when multiple captures match the same span, keep the first
  // (most specific due to highlights.scm ordering).
  const seen = new Set<string>();
  const builder = new SemanticTokensBuilder();

  for (const capture of captures as Array<{ name: string; node: SyntaxNode }>) {
    const mapping = CAPTURE_MAP[capture.name];
    if (!mapping) continue;

    const node = capture.node;
    const key = `${node.startPosition.row}:${node.startPosition.column}:${node.endPosition.row}:${node.endPosition.column}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // For NL strings with @refs, emit split tokens instead of one big string.
    if (nlRefNodes.has(nodeId(node))) {
      emitSplitStringTokens(node, builder);
      continue;
    }

    // Semantic tokens are single-line in the LSP protocol.
    // For multi-line nodes (like multiline strings), emit one token per line.
    const startRow = node.startPosition.row;
    const endRow = node.endPosition.row;

    if (startRow === endRow) {
      const length = node.endPosition.column - node.startPosition.column;
      if (length > 0) {
        builder.push(
          startRow,
          node.startPosition.column,
          length,
          mapping.typeIndex,
          mapping.modifierBits,
        );
      }
    } else {
      // Multi-line token: emit one token per source line.
      const sourceLines = node.text.split("\n");
      for (let i = 0; i < sourceLines.length; i++) {
        const line = startRow + i;
        const col = i === 0 ? node.startPosition.column : 0;
        const len = sourceLines[i]!.length;
        if (len > 0) {
          builder.push(line, col, len, mapping.typeIndex, mapping.modifierBits);
        }
      }
    }
  }

  return builder.build();
}

// ---------- NL reference extraction ----------

const AT_REF_RE = createAtRefRegex();

/** Unique identity for a CST node (by position). */
function nodeId(node: SyntaxNode): string {
  return `${node.startPosition.row}:${node.startPosition.column}:${node.endPosition.row}:${node.endPosition.column}`;
}

/**
 * Pre-scan the tree and return the set of nodeId()s for nl_string and
 * multiline_string nodes that contain at least one @ref.
 */
function collectNlRefNodes(root: SyntaxNode): Set<string> {
  const result = new Set<string>();
  const cursor = root.walk();
  let reachedRoot = false;

  do {
    const node = cursor.currentNode;
    if (node.type === "nl_string" || node.type === "multiline_string") {
      AT_REF_RE.lastIndex = 0;
      if (AT_REF_RE.test(node.text)) {
        result.add(nodeId(node));
      }
    }
    if (cursor.gotoFirstChild()) continue;
    if (cursor.gotoNextSibling()) continue;
    while (true) {
      if (!cursor.gotoParent()) {
        reachedRoot = true;
        break;
      }
      if (cursor.gotoNextSibling()) break;
    }
  } while (!reachedRoot);

  return result;
}

/** Segment type for split string tokenisation. */
interface Segment {
  offset: number; // byte offset within node text
  length: number;
  isRef: boolean; // true = @ref (variable), false = string
}

/**
 * For an nl_string or multiline_string that contains @refs,
 * emit interleaved string and variable tokens instead of one big string token.
 */
function emitSplitStringTokens(node: SyntaxNode, builder: SemanticTokensBuilder): void {
  const text = node.text;
  const startRow = node.startPosition.row;
  const startCol = node.startPosition.column;

  // Build line offset map for position calculation
  const lineOffsets: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") lineOffsets.push(i + 1);
  }

  // Collect all @ref spans, sorted by offset
  const refSpans: Array<{ offset: number; length: number }> = [];

  let match: RegExpExecArray | null;
  AT_REF_RE.lastIndex = 0;
  while ((match = AT_REF_RE.exec(text)) !== null) {
    refSpans.push({ offset: match.index, length: match[0].length });
  }
  refSpans.sort((a, b) => a.offset - b.offset);

  // Build segments: alternating string and ref parts
  const segments: Segment[] = [];
  let lastEnd = 0;

  for (const span of refSpans) {
    if (span.offset > lastEnd) {
      segments.push({ offset: lastEnd, length: span.offset - lastEnd, isRef: false });
    }
    segments.push({ offset: span.offset, length: span.length, isRef: true });
    lastEnd = span.offset + span.length;
  }
  // Trailing string part
  if (lastEnd < text.length) {
    segments.push({ offset: lastEnd, length: text.length - lastEnd, isRef: false });
  }

  // Emit each segment, splitting across lines as needed
  const nlRefBit = 1 << 4; // nlRef modifier bitmask
  for (const seg of segments) {
    const typeIndex = seg.isRef ? 3 : 5; // variable or string
    const modBits = seg.isRef ? nlRefBit : 0;
    const segText = text.slice(seg.offset, seg.offset + seg.length);
    const segLines = segText.split("\n");

    // Find starting line for this segment
    let segLineIdx = 0;
    for (let l = lineOffsets.length - 1; l >= 0; l--) {
      if (seg.offset >= lineOffsets[l]!) {
        segLineIdx = l;
        break;
      }
    }

    for (let i = 0; i < segLines.length; i++) {
      const row = startRow + segLineIdx + i;
      let col: number;
      if (segLineIdx + i === 0) {
        // First line of the node — offset relative to node start column
        col = startCol + (i === 0 ? seg.offset : 0);
      } else {
        // Subsequent lines — offset from start of that line
        const lineStartOffset = lineOffsets[segLineIdx + i]!;
        col = (i === 0 ? seg.offset : lineStartOffset) - lineStartOffset;
      }
      const len = segLines[i]!.length;
      if (len > 0) {
        builder.push(row, col, len, typeIndex, modBits);
      }
    }
  }
}
