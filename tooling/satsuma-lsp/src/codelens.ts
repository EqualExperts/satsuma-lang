import { CodeLens, Command, Range } from "vscode-languageserver";
import type { SyntaxNode, Tree } from "./parser-utils";
import { nodeRange, child, children, labelText, walkDescendants } from "./parser-utils";
import { isMetricSchema, sourceRefStructuralText } from "@satsuma/core";
import { WorkspaceIndex, findReferences, findMappingsUsing } from "./workspace-index";

/**
 * Compute CodeLens annotations for all top-level blocks in a file.
 * Uses the workspace index for counts — no CLI calls.
 */
export function computeCodeLenses(tree: Tree, uri: string, index: WorkspaceIndex): CodeLens[] {
  const lenses: CodeLens[] = [];
  for (const node of tree.rootNode.namedChildren) {
    collectLenses(node, null, uri, index, lenses);
  }
  return lenses;
}

function collectLenses(
  node: SyntaxNode,
  namespace: string | null,
  uri: string,
  index: WorkspaceIndex,
  lenses: CodeLens[],
): void {
  if (node.type === "namespace_block") {
    const nsName = node.childForFieldName("name").text;
    for (const ch of node.namedChildren) {
      collectLenses(ch, nsName, uri, index, lenses);
    }
    return;
  }

  const name = labelText(node);
  if (!name) return;

  const qualName = namespace ? `${namespace}::${name}` : name;
  const lblNode = child(node, "block_label");
  const range = lblNode ? nodeRange(lblNode) : lineRange(node);

  switch (node.type) {
    case "schema_block": {
      // Metric schemas are schema_blocks decorated with (metric, ...) metadata.
      // They get a metric-style lens showing source names instead of ref counts.
      const metaBlock = child(node, "metadata_block");
      if (isMetricSchema(metaBlock)) {
        lenses.push(metricLens(node, range));
      } else {
        lenses.push(...schemaLenses(node, qualName, range, index));
      }
      break;
    }
    case "fragment_block":
      lenses.push(fragmentLens(qualName, range, index));
      break;
    case "mapping_block":
      lenses.push(mappingLens(node, range));
      break;
    case "transform_block":
      lenses.push(transformLens(qualName, range, index));
      break;
    default:
      // No lens for any other top-level block kind — intentionally partial,
      // not every CST symbol names a lens-bearing construct.
      break;
  }
}

// ---------- Per-block-type lenses ----------

function schemaLenses(
  node: SyntaxNode,
  qualName: string,
  range: Range,
  index: WorkspaceIndex,
): CodeLens[] {
  const body = child(node, "schema_body");
  const fieldCount = body ? children(body, "field_decl").length : 0;
  const mappingCount = findMappingsUsing(index, qualName).length;

  let title = `${fieldCount} field(s)`;
  if (mappingCount > 0) {
    title += ` | used in ${mappingCount} mapping(s)`;
  }

  return [
    {
      range,
      command: makeCommand("Lineage from", "satsuma.showLineage", {
        schemaName: qualName,
        direction: "from",
      }),
    },
    {
      range,
      command: makeCommand("Lineage to", "satsuma.showLineage", {
        schemaName: qualName,
        direction: "to",
      }),
    },
    { range, command: makeCommand(title) },
  ];
}

function fragmentLens(qualName: string, range: Range, index: WorkspaceIndex): CodeLens {
  const spreadRefs = findReferences(index, qualName).filter((r) => r.context === "spread");
  const title = `spread in ${spreadRefs.length} place(s)`;
  return { range, command: makeCommand(title) };
}

function mappingLens(node: SyntaxNode, range: Range): CodeLens {
  const body = child(node, "mapping_body");
  if (!body) return { range, command: makeCommand("mapping") };

  const sources = extractRefNames(body, "source_block");
  const targets = extractRefNames(body, "target_block");
  const arrowCount = countArrows(body);

  const srcText = sources.length > 0 ? sources.join(", ") : "?";
  const tgtText = targets.length > 0 ? targets.join(", ") : "?";
  const title = `${srcText} → ${tgtText} | ${arrowCount} arrow(s)`;

  return { range, command: makeCommand(title) };
}

function metricLens(node: SyntaxNode, range: Range): CodeLens {
  const meta = child(node, "metadata_block");
  const sourceNames: string[] = [];

  if (meta) {
    walkDescendants(meta, (n) => {
      if (n.type === "tag_with_value") {
        const key = n.namedChildren[0];
        const val = n.namedChildren[1];
        if (key?.text === "source" && val) {
          sourceNames.push(val.text);
        }
      }
    });
  }

  const title = sourceNames.length > 0 ? `sources: ${sourceNames.join(", ")}` : "metric";

  return { range, command: makeCommand(title) };
}

function transformLens(qualName: string, range: Range, index: WorkspaceIndex): CodeLens {
  const spreadRefs = findReferences(index, qualName).filter((r) => r.context === "spread");
  const title = `used in ${spreadRefs.length} place(s)`;
  return { range, command: makeCommand(title) };
}

// ---------- Helpers ----------

function makeCommand(title: string, command = "", ...arguments_: unknown[]): Command {
  return arguments_.length > 0 ? { title, command, arguments: arguments_ } : { title, command };
}

function extractRefNames(body: SyntaxNode, blockType: string): string[] {
  const names: string[] = [];
  for (const block of body.namedChildren) {
    if (block.type !== blockType) continue;
    for (const ref of block.namedChildren) {
      if (ref.type === "source_ref") {
        const text = sourceRefStructuralText(ref);
        if (text) names.push(text);
      }
    }
  }
  return names;
}

function countArrows(body: SyntaxNode): number {
  let count = 0;
  for (const ch of body.namedChildren) {
    if (
      ch.type === "map_arrow" ||
      ch.type === "nested_arrow" ||
      ch.type === "computed_arrow" ||
      ch.type === "each_block" ||
      ch.type === "flatten_block"
    ) {
      count++;
    }
  }
  return count;
}

function lineRange(node: SyntaxNode): Range {
  return Range.create(
    node.startPosition.row,
    node.startPosition.column,
    node.startPosition.row,
    node.startPosition.column,
  );
}
