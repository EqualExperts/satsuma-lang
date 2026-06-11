import type { SyntaxNode, Tree } from "./parser-utils";
import { child, children, labelText, nodeAtPosition } from "./parser-utils";
import { findNodeContext, type NodeContext } from "./definition";
import type { WorkspaceIndex } from "./workspace-index";
import { sourceRefText } from "@satsuma/core";

export interface ActionContext {
  schemaName: string | null;
  fieldPath: string | null;
  mappingName: string | null;
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
    return { schemaName: null, fieldPath: null, mappingName: null, targetSchema: null };
  }

  const ctx = findNodeContext(node);
  const { mappingName, targetSchema } = inferMappingContext(node);

  if (!ctx) {
    return { schemaName: null, fieldPath: null, mappingName, targetSchema };
  }

  return {
    schemaName: inferSchemaName(ctx),
    fieldPath: inferFieldPath(ctx),
    mappingName,
    targetSchema,
  };
}

/**
 * Walk up the CST from the cursor node to find an enclosing named mapping_block,
 * then extract the mapping name and the first target schema reference.
 */
function inferMappingContext(
  node: SyntaxNode,
): { mappingName: string | null; targetSchema: string | null } {
  let current: SyntaxNode | null = node;
  while (current) {
    if (current.type === "mapping_block") {
      const mappingName = labelText(current);
      const targetSchema = extractTargetSchema(current);
      return { mappingName, targetSchema };
    }
    current = current.parent;
  }
  return { mappingName: null, targetSchema: null };
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

    case "nl_ref":
      return ctx.name.includes(".") ? stripPathDecorators(ctx.name) : null;

    default:
      return null;
  }
}

function inferSchemaFromNlRef(name: string): string | null {
  if (!name.includes(".")) return null;
  const normalized = stripPathDecorators(name);
  const parts = normalized.split(".");
  return parts.length >= 2 ? parts.slice(0, -1).join(".") : null;
}

function inferArrowFieldPath(
  schemas: string[],
  rawPath: string | null,
): string | null {
  const normalizedPath = normalizeArrowPath(rawPath);
  if (!normalizedPath) return null;

  for (const schema of schemas) {
    if (
      normalizedPath === schema ||
      normalizedPath.startsWith(`${schema}.`)
    ) {
      return normalizedPath;
    }
  }

  return schemas.length === 1 && schemas[0]
    ? `${schemas[0]}.${normalizedPath}`
    : null;
}

function inferSchemaFromPath(
  schemas: string[],
  rawPath: string | null,
): string | null {
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
