import { Hover, MarkupKind } from "vscode-languageserver";
import type { SyntaxNode, Tree } from "./parser-utils";
import { nodeRange, child, children, labelText, stringText, nodeAtPosition } from "./parser-utils";
import { isMetricSchema } from "@satsuma/core";

// Maximum number of fields shown in a schema/fragment hover preview.
// Beyond this cap the hover becomes too tall to be useful in the editor;
// a "… N more" line is appended instead.
const MAX_HOVER_FIELDS = 8;

/**
 * Compute hover information for the node at the given position.
 *
 * Per-file only — no workspace index.  Shows structural information
 * derived from the CST: block summaries, field types, metadata, etc.
 */
export function computeHover(
  tree: Tree,
  line: number,
  character: number,
): Hover | null {
  const node = nodeAtPosition(tree, line, character);
  if (!node) return null;

  // Walk up the tree to find a meaningful hover target
  const result = hoverForNode(node, tree);
  if (!result) return null;

  return {
    contents: { kind: MarkupKind.Markdown, value: result.markdown },
    range: nodeRange(result.node),
  };
}

interface HoverResult {
  markdown: string;
  node: SyntaxNode;
}

function hoverForNode(node: SyntaxNode, tree: Tree): HoverResult | null {
  // Try the node itself and ancestors until we find something useful
  let current: SyntaxNode | null = node;
  while (current) {
    const result = tryHover(current, tree);
    if (result) return result;
    current = current.parent;
  }
  return null;
}

function tryHover(node: SyntaxNode, tree: Tree): HoverResult | null {
  switch (node.type) {
    case "block_label":
      return hoverBlockLabel(node);

    case "field_name":
      return hoverFieldName(node);

    case "field_decl":
      return hoverFieldDecl(node);

    case "type_expr":
      return hoverTypeExpr(node);

    case "tag_token":
      return hoverTag(node);

    case "tag_with_value":
      return hoverKeyValue(node);

    case "fragment_spread":
      return hoverSpread(node, tree);

    case "spread_label":
      return hoverSpread(node.parent!, tree);

    case "src_path":
    case "tgt_path":
      return hoverArrowPath(node);

    case "pipe_text":
      return hoverPipeText(node);

    case "schema_block":
    case "fragment_block":
    case "mapping_block":
    case "transform_block":
    case "namespace_block":
    case "note_block":
      return hoverBlock(node);

    default:
      return null;
  }
}

// ---------- Hover generators ----------

function hoverBlockLabel(node: SyntaxNode): HoverResult | null {
  const block = node.parent;
  if (!block) return null;
  return hoverBlock(block);
}

function hoverBlock(node: SyntaxNode): HoverResult | null {
  const name = labelText(node) ?? "(anonymous)";
  const blockType = node.type.replace("_block", "");

  const lines: string[] = [];

  switch (node.type) {
    // --- Schema / Fragment hover ---
    // Metric schemas are schema_blocks decorated with (metric, ...) metadata;
    // they show metric-specific info (display name, grain) above the field list.
    case "schema_block":
    case "fragment_block": {
      const metaBlock = child(node, "metadata_block");
      const isMetric = node.type === "schema_block" && isMetricSchema(metaBlock);
      const displayKind = isMetric ? "metric" : blockType;
      lines.push(`**${displayKind}** \`${name}\``);
      if (isMetric && metaBlock) {
        // Show metric_name tag value as display label
        const metricNameEntry = metaBlock.namedChildren.find(
          (c) => c.type === "tag_with_value" && c.namedChildren[0]?.text === "metric_name",
        );
        if (metricNameEntry) {
          const valNode = metricNameEntry.namedChildren[1];
          const strNode = valNode?.namedChildren.find(
            (c) => c.type === "nl_string" || c.type === "multiline_string",
          );
          if (strNode) lines.push(`Display: "${stringText(strNode)}"`);
        }
        lines.push(`Metadata: ${metaBlock.text.trim()}`);
      }
      const body = child(node, "schema_body");
      if (body) {
        const fields = children(body, "field_decl");
        const spreads = children(body, "fragment_spread");
        lines.push(`${fields.length} field(s)${spreads.length > 0 ? `, ${spreads.length} spread(s)` : ""}`);
        // Show a preview of the first MAX_HOVER_FIELDS fields; truncate the rest.
        const fieldSummary = fields.slice(0, MAX_HOVER_FIELDS).map((f) => {
          const fn = child(f, "field_name");
          const te = child(f, "type_expr");
          const meta = collectMetadata(f);
          let line = `- \`${fn?.text ?? "?"}\``;
          if (te) line += ` ${te.text}`;
          if (meta) line += ` *(${meta})*`;
          return line;
        });
        if (fieldSummary.length > 0) {
          lines.push("", ...fieldSummary);
        }
        if (fields.length > MAX_HOVER_FIELDS) {
          lines.push(`- *…${fields.length - MAX_HOVER_FIELDS} more*`);
        }
      }
      break;
    }

    // --- Mapping hover ---
    case "mapping_block": {
      lines.push(`**mapping** \`${name}\``);
      const body = child(node, "mapping_body");
      if (body) {
        const sources = children(body, "source_block");
        const targets = children(body, "target_block");
        if (sources.length > 0 || targets.length > 0) {
          const srcNames = sources.map((s) => backtickText(s)).filter(Boolean);
          const tgtNames = targets.map((t) => backtickText(t)).filter(Boolean);
          if (srcNames.length > 0) lines.push(`Source: ${srcNames.map((n) => `\`${n}\``).join(", ")}`);
          if (tgtNames.length > 0) lines.push(`Target: ${tgtNames.map((n) => `\`${n}\``).join(", ")}`);
        }
      }
      break;
    }

    // --- Transform hover ---
    case "transform_block": {
      lines.push(`**transform** \`${name}\``);
      // Transform body is a pipe_chain (not a named "transform_body")
      const pipeChain = child(node, "pipe_chain");
      if (pipeChain) {
        const bodyText = pipeChain.text.trim();
        if (bodyText.length > 0 && bodyText.length < 200) {
          lines.push("```satsuma", bodyText, "```");
        }
      }
      break;
    }

    // --- Namespace hover ---
    case "namespace_block": {
      const nsName = node.childForFieldName("name");
      lines.push(`**namespace** \`${nsName?.text ?? name}\``);
      const blockChildren = node.namedChildren.filter((c) => c.type.endsWith("_block"));
      if (blockChildren.length > 0) {
        lines.push(`${blockChildren.length} block(s)`);
      }
      break;
    }

    // --- Note hover ---
    case "note_block": {
      lines.push("**note**");
      const nlStr = child(node, "nl_string");
      const mlStr = child(node, "multiline_string");
      const text = stringText(nlStr) ?? stringText(mlStr);
      if (text && text.length < 300) {
        lines.push(text);
      }
      break;
    }

    default:
      return null;
  }

  return { markdown: lines.join("\n"), node };
}

function hoverFieldName(node: SyntaxNode): HoverResult | null {
  const fieldDecl = node.parent;
  if (!fieldDecl || fieldDecl.type !== "field_decl") return null;
  return hoverFieldDecl(fieldDecl);
}

function hoverFieldDecl(node: SyntaxNode): HoverResult | null {
  const nameNode = child(node, "field_name");
  const typeExpr = child(node, "type_expr");
  const meta = collectMetadata(node);

  const name = nameNode?.text ?? "?";
  const lines: string[] = [];
  lines.push(`**field** \`${name}\``);
  if (typeExpr) lines.push(`Type: \`${typeExpr.text}\``);

  // Check for record / list_of
  const isList = node.children.some((c) => c.type === "list_of");
  const isRecord = node.children.some((c) => c.type === "record");
  if (isList && isRecord) lines.push("Structure: `list_of record`");
  else if (isRecord) lines.push("Structure: `record`");
  else if (isList) lines.push("Structure: `list_of`");

  if (meta) lines.push(`Metadata: ${meta}`);

  // Show parent schema/fragment name
  const parent = findAncestorBlock(node);
  if (parent) {
    const parentName = labelText(parent) ?? "(anonymous)";
    const parentType = parent.type.replace("_block", "");
    lines.push(`In: \`${parentType} ${parentName}\``);
  }

  return { markdown: lines.join("\n"), node: nameNode ?? node };
}

function hoverTypeExpr(node: SyntaxNode): HoverResult | null {
  return {
    markdown: `**type** \`${node.text}\``,
    node,
  };
}

function hoverTag(node: SyntaxNode): HoverResult | null {
  const tag = node.text;
  const desc = TAG_DESCRIPTIONS[tag];
  const lines = [`**tag** \`${tag}\``];
  if (desc) lines.push(desc);
  return { markdown: lines.join("\n"), node };
}

function hoverKeyValue(node: SyntaxNode): HoverResult | null {
  const key = node.namedChildren[0]; // identifier (was kv_key)
  const val = node.namedChildren[1]; // value_text
  if (!key) return null;
  const lines = [`**metadata** \`${key.text}\``];
  if (val) lines.push(`Value: \`${val.text}\``);
  return { markdown: lines.join("\n"), node };
}

function hoverSpread(node: SyntaxNode, tree: Tree): HoverResult | null {
  const label = child(node, "spread_label");
  if (!label) return null;
  const name = label.text;

  // Try to find the fragment/transform definition in the same file
  const root = tree.rootNode;
  for (const block of root.namedChildren) {
    if (block.type === "fragment_block" || block.type === "transform_block") {
      const blockName = labelText(block);
      if (blockName === name) {
        const result = hoverBlock(block);
        if (result) {
          return { markdown: `**spread** \`...${name}\`\n\n${result.markdown}`, node: label };
        }
      }
    }
    // Check inside namespaces
    if (block.type === "namespace_block") {
      for (const nested of block.namedChildren) {
        if (nested.type === "fragment_block" || nested.type === "transform_block") {
          const blockName = labelText(nested);
          if (blockName === name) {
            const result = hoverBlock(nested);
            if (result) {
              return { markdown: `**spread** \`...${name}\`\n\n${result.markdown}`, node: label };
            }
          }
        }
      }
    }
  }

  return { markdown: `**spread** \`...${name}\``, node: label };
}

function hoverArrowPath(node: SyntaxNode): HoverResult | null {
  const side = node.type === "src_path" ? "source" : "target";
  return {
    markdown: `**${side} path** \`${node.text}\``,
    node,
  };
}

function hoverPipeText(node: SyntaxNode): HoverResult | null {
  const name = child(node, "identifier");
  if (!name) return null;
  return {
    markdown: `**pipe text** \`${node.text}\``,
    node,
  };
}

// ---------- Helpers ----------

/** Walk up from a node to find the enclosing schema/fragment/mapping block. */
function findAncestorBlock(node: SyntaxNode): SyntaxNode | null {
  let current = node.parent;
  while (current) {
    if (
      current.type === "schema_block" ||
      current.type === "fragment_block" ||
      current.type === "mapping_block" ||
      current.type === "transform_block"
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/** Collect metadata tags and key-value pairs from a field_decl. */
function collectMetadata(node: SyntaxNode): string | null {
  const meta = child(node, "metadata_block");
  if (!meta) return null;
  const parts: string[] = [];
  for (const ch of meta.namedChildren) {
    if (ch.type === "tag_token") parts.push(ch.text);
    else if (ch.type === "tag_with_value") parts.push(ch.text);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Extract the reference name from a source/target block. */
function backtickText(node: SyntaxNode): string | null {
  for (const ch of node.namedChildren) {
    if (ch.type === "source_ref" || ch.type === "backtick_name") return ch.text;
  }
  return null;
}

// Tag descriptions shown in hover tooltips when the cursor is on a metadata tag.
// Source: SATSUMA-V2-SPEC.md §Metadata Tags. This list covers the tags defined
// in the spec; it is intentionally exhaustive for spec-defined tags but does
// not attempt to cover arbitrary user-defined custom tags.
const TAG_DESCRIPTIONS: Record<string, string> = {
  pk: "Primary key — uniquely identifies each record",
  pii: "Personally identifiable information — requires special handling",
  required: "Field must not be null",
  optional: "Field may be null",
  unique: "Values must be unique across all records",
  indexed: "Field is indexed for fast lookup",
  deprecated: "Field is deprecated and should not be used in new mappings",
  scd: "Slowly changing dimension — tracks historical changes",
  scd2: "SCD Type 2 — maintains full history with start/end dates",
  immutable: "Value cannot change after initial creation",
  sensitive: "Contains sensitive data requiring access controls",
  computed: "Value is derived/calculated, not directly sourced",
  nullable: "Field explicitly allows null values",
};
