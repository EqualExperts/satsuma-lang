import type { SyntaxNode, Tree } from "./parser-utils";
import { child, children, labelText, nodeAtPosition } from "./parser-utils";
import { findNodeContext, type NodeContext } from "./definition";
import type { WorkspaceIndex } from "./workspace-index";
import { sourceRefText } from "@satsuma/core";

export interface ActionContext {
  schemaName: string | null;
  fieldPath: string | null;
  mappingName: string | null;
  /**
   * 0-indexed start row of the enclosing `mapping` block, or null when the cursor
   * is not inside one.
   *
   * **This, not `mappingName`, identifies the mapping.** A label is not unique —
   * two namespaces may each declare `mapping load` — and an anonymous block has
   * none at all, so a consumer that asks core about a mapping by label alone gets
   * the first block carrying it. The cursor is already inside the right block, so
   * the row is free to carry and settles the question outright; `satsuma
   * coverage`'s figures and the gutter's disagreed until it did.
   */
  mappingRow: number | null;
  targetSchema: string | null;
}

export function computeActionContext(
  tree: Tree,
  line: number,
  character: number,
  _uri: string,
  _index: WorkspaceIndex,
): ActionContext {
  const node = nodeAtPosition(tree, line, character);
  if (!node) {
    return {
      schemaName: null,
      fieldPath: null,
      mappingName: null,
      mappingRow: null,
      targetSchema: null,
    };
  }

  const ctx = findNodeContext(node);
  const { mappingName, mappingRow, targetSchema } = inferMappingContext(node);

  if (!ctx) {
    return { schemaName: null, fieldPath: null, mappingName, mappingRow, targetSchema };
  }

  return {
    schemaName: inferSchemaName(ctx),
    fieldPath: inferFieldPath(ctx),
    mappingName,
    mappingRow,
    targetSchema,
  };
}

/**
 * Walk up the CST from the cursor node to find the enclosing mapping_block, then
 * extract its name, its start row and the first target schema reference.
 *
 * The row comes from the same node the name does. Returning only the name threw
 * away the one thing that identifies the block — see
 * {@link ActionContext.mappingRow}.
 */
function inferMappingContext(node: SyntaxNode): {
  mappingName: string | null;
  mappingRow: number | null;
  targetSchema: string | null;
} {
  let current: SyntaxNode | null = node;
  while (current) {
    if (current.type === "mapping_block") {
      return {
        mappingName: labelText(current),
        mappingRow: current.startPosition.row,
        targetSchema: extractTargetSchema(current),
      };
    }
    current = current.parent;
  }
  return { mappingName: null, mappingRow: null, targetSchema: null };
}

function extractTargetSchema(mappingNode: SyntaxNode): string | null {
  const body = child(mappingNode, "mapping_body");
  if (!body) return null;
  for (const item of body.namedChildren) {
    if (item.type === "target_block") {
      for (const ref of children(item, "source_ref")) {
        const name = sourceRefText(ref);
        if (name) return name;
      }
    }
  }
  return null;
}

function inferSchemaName(ctx: NodeContext): string | null {
  switch (ctx.kind) {
    case "source_ref":
    case "target_ref":
      return ctx.name;

    case "block_label":
      return ctx.node.parent?.type === "schema_block" ? ctx.name : null;

    case "field_name":
      return ctx.parentName ?? null;

    case "arrow_source":
      return inferSchemaFromPath(ctx.mappingSources ?? [], ctx.rawPath ?? null);

    case "arrow_target":
      return inferSchemaFromPath(ctx.mappingTargets ?? [], ctx.rawPath ?? null);

    // The schema prefix of a qualified arrow path (`customers` in
    // `customers.email`). Which side it belongs to is not carried on the
    // context — checking both lists together is safe because only the one
    // schema actually named by `rawPath` can ever match (gpt-jwek).
    case "arrow_schema":
      return inferSchemaFromPath(arrowSchemaCandidates(ctx), ctx.rawPath ?? null);

    case "nl_ref":
      return inferSchemaFromNlRef(ctx.name);

    default:
      return null;
  }
}

function inferFieldPath(ctx: NodeContext): string | null {
  switch (ctx.kind) {
    case "field_name":
      return ctx.parentName ? `${ctx.parentName}.${ctx.name}` : null;

    case "arrow_source":
      return inferArrowFieldPath(ctx.mappingSources ?? [], ctx.rawPath ?? null);

    case "arrow_target":
      return inferArrowFieldPath(ctx.mappingTargets ?? [], ctx.rawPath ?? null);

    case "arrow_schema":
      return inferArrowFieldPath(arrowSchemaCandidates(ctx), ctx.rawPath ?? null);

    case "nl_ref":
      return ctx.name.includes(".") ? stripPathDecorators(ctx.name) : null;

    default:
      return null;
  }
}

/**
 * Both of a mapping's schema lists, combined, for a context that names the
 * qualified prefix of an arrow path without recording which side it is on.
 */
function arrowSchemaCandidates(ctx: NodeContext): string[] {
  return [...(ctx.mappingSources ?? []), ...(ctx.mappingTargets ?? [])];
}

function inferSchemaFromNlRef(name: string): string | null {
  if (!name.includes(".")) return null;
  const normalized = stripPathDecorators(name);
  const parts = normalized.split(".");
  return parts.length >= 2 ? parts.slice(0, -1).join(".") : null;
}

function inferArrowFieldPath(schemas: string[], rawPath: string | null): string | null {
  const normalizedPath = normalizeArrowPath(rawPath);
  if (!normalizedPath) return null;

  for (const schema of schemas) {
    if (normalizedPath === schema || normalizedPath.startsWith(`${schema}.`)) {
      return normalizedPath;
    }
  }

  return schemas.length === 1 && schemas[0] ? `${schemas[0]}.${normalizedPath}` : null;
}

function inferSchemaFromPath(schemas: string[], rawPath: string | null): string | null {
  const fullPath = inferArrowFieldPath(schemas, rawPath);
  if (!fullPath) {
    return schemas.length === 1 ? (schemas[0] ?? null) : null;
  }

  const parts = fullPath.split(".");
  return parts.length >= 2 ? (parts[0] ?? null) : null;
}

function normalizeArrowPath(rawPath: string | null): string | null {
  if (!rawPath) return null;
  const normalized = stripPathDecorators(rawPath).replace(/^\.+/, "");
  return normalized.length > 0 ? normalized : null;
}

function stripPathDecorators(path: string): string {
  return path.replace(/`/g, "");
}
