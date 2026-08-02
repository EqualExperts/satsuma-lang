import { DocumentSymbol, SymbolKind } from "vscode-languageserver";
import type { SyntaxNode, Tree } from "./parser-utils";
import { nodeRange, child, children, labelText, stringText } from "./parser-utils";
import { fieldNameText, isMetricSchema } from "@satsuma/core";

/** Map of CST block type → LSP SymbolKind. */
const BLOCK_SYMBOL_KIND: Record<string, SymbolKind> = {
  schema_block: SymbolKind.Class,
  fragment_block: SymbolKind.Interface,
  mapping_block: SymbolKind.Function,
  transform_block: SymbolKind.Function,
  namespace_block: SymbolKind.Namespace,
  note_block: SymbolKind.File,
  import_decl: SymbolKind.Package,
};

/** Block types whose bodies contain field declarations. */
const FIELD_BEARING_BLOCKS = new Set(["schema_block", "fragment_block"]);

/**
 * Build a DocumentSymbol tree from the parse tree.
 * Returns top-level symbols with fields/nested blocks as children.
 */
export function computeDocumentSymbols(tree: Tree): DocumentSymbol[] {
  return symbolsFromNodes(tree.rootNode.namedChildren);
}

function symbolsFromNodes(nodes: SyntaxNode[]): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];
  for (const node of nodes) {
    let kind = BLOCK_SYMBOL_KIND[node.type];
    if (kind === undefined) continue;

    // Metric schemas are schema_blocks decorated with (metric, ...) metadata.
    // Use SymbolKind.Constant (same as the old metric_block) to distinguish them
    // from plain schemas in the outline panel.
    if (node.type === "schema_block") {
      const metaBlock = child(node, "metadata_block");
      if (isMetricSchema(metaBlock)) kind = SymbolKind.Constant;
    }

    const sym = blockSymbol(node, kind);
    if (sym) symbols.push(sym);
  }
  return symbols;
}

function blockSymbol(node: SyntaxNode, kind: SymbolKind): DocumentSymbol | null {
  const name = symbolName(node);
  if (!name) return null;

  const lblNode = child(node, "block_label");
  const selectionRange = lblNode ? nodeRange(lblNode) : nodeRange(node);
  const detail = symbolDetail(node);

  const sym: DocumentSymbol = {
    name,
    kind,
    range: nodeRange(node),
    selectionRange,
    children: [],
  };

  if (detail) {
    sym.detail = detail;
  }

  // Namespace blocks contain nested definitions
  if (node.type === "namespace_block") {
    sym.children = symbolsFromNodes(node.namedChildren);
  }

  // Schema and fragment blocks contain field declarations
  if (FIELD_BEARING_BLOCKS.has(node.type)) {
    const body = child(node, "schema_body");
    if (body) {
      sym.children = fieldSymbols(body);
    }
  }

  // Mapping blocks — show source/target/arrow structure as children
  if (node.type === "mapping_block") {
    const body = child(node, "mapping_body");
    if (body) {
      sym.children = mappingChildSymbols(body);
    }
  }

  return sym;
}

/** Extract field declarations as DocumentSymbol children. */
function fieldSymbols(body: SyntaxNode): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];
  for (const fieldNode of children(body, "field_decl")) {
    const nameNode = child(fieldNode, "field_name");
    if (!nameNode) continue;

    const fieldName = fieldNameText(nameNode);
    if (!fieldName) continue;

    const typeExpr = child(fieldNode, "type_expr");
    const nestedBody = child(fieldNode, "schema_body");

    // Determine if this is a record/list_of record (nested structure)
    const isNested = nestedBody !== null;
    const isList = fieldNode.children.some((c) => c.type === "list_of");
    const isRecord = fieldNode.children.some(
      (c) =>
        c.type === "record" ||
        (c.type === "list_of" && fieldNode.children.some((d) => d.type === "record")),
    );

    let detail: string | undefined;
    if (isList && isRecord) {
      detail = "list_of record";
    } else if (isRecord) {
      detail = "record";
    } else if (isList && typeExpr) {
      detail = `list_of ${typeExpr.text}`;
    } else if (typeExpr) {
      detail = typeExpr.text;
    }

    const sym: DocumentSymbol = {
      name: fieldName,
      kind: isNested ? SymbolKind.Struct : SymbolKind.Field,
      range: nodeRange(fieldNode),
      selectionRange: nodeRange(nameNode),
      children: [],
    };

    if (detail) {
      sym.detail = detail;
    }

    // Recurse into nested record bodies
    if (nestedBody) {
      sym.children = fieldSymbols(nestedBody);
    }

    symbols.push(sym);
  }

  // Fragment spreads
  for (const spread of children(body, "fragment_spread")) {
    const spreadLabel = child(spread, "spread_label");
    const spreadName = spreadLabel ? spreadLabelText(spreadLabel) : null;
    if (spreadName) {
      symbols.push({
        name: `...${spreadName}`,
        kind: SymbolKind.Field,
        range: nodeRange(spread),
        selectionRange: nodeRange(spread),
        children: [],
        detail: "spread",
      });
    }
  }

  return symbols;
}

/** Extract mapping body children as symbols (source, target blocks). */
function mappingChildSymbols(body: SyntaxNode): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];

  for (const ch of body.namedChildren) {
    if (ch.type === "source_block") {
      symbols.push({
        name: "source",
        kind: SymbolKind.Property,
        range: nodeRange(ch),
        selectionRange: nodeRange(ch),
        children: [],
      });
    } else if (ch.type === "target_block") {
      symbols.push({
        name: "target",
        kind: SymbolKind.Property,
        range: nodeRange(ch),
        selectionRange: nodeRange(ch),
        children: [],
      });
    } else if (ch.type === "note_block") {
      symbols.push({
        name: "note",
        kind: SymbolKind.File,
        range: nodeRange(ch),
        selectionRange: nodeRange(ch),
        children: [],
      });
    }
  }

  return symbols;
}

// ---------- Name extraction helpers ----------

function symbolName(node: SyntaxNode): string | null {
  switch (node.type) {
    case "note_block":
      return "note";
    case "import_decl": {
      const pathNode = child(node, "import_path");
      const pathStr = pathNode ? stringText(pathNode.namedChildren[0]) : null;
      return pathStr ? `import "${pathStr}"` : "import";
    }
    default:
      return labelText(node) ?? "(anonymous)";
  }
}

function symbolDetail(node: SyntaxNode): string | undefined {
  // For metric schemas, the human-readable display label is the metric_name
  // tag value inside the metadata_block, not a direct child nl_string.
  if (node.type === "schema_block") {
    const metaBlock = child(node, "metadata_block");
    if (isMetricSchema(metaBlock) && metaBlock) {
      const nameEntry = metaBlock.namedChildren.find(
        (c) => c.type === "tag_with_value" && c.namedChildren[0]?.text === "metric_name",
      );
      if (nameEntry) {
        const val = nameEntry.namedChildren[1];
        const strNode = val?.namedChildren.find(
          (c) => c.type === "nl_string" || c.type === "multiline_string",
        );
        if (strNode) return stringText(strNode) ?? undefined;
      }
    }
  }
  return undefined;
}

function spreadLabelText(node: SyntaxNode): string | null {
  // spread_label can contain identifier, quoted_name, or qualified_name
  const inner = node.namedChildren[0];
  if (!inner) return node.text;
  if (inner.type === "backtick_name") return inner.text.slice(1, -1);
  return inner.text;
}
