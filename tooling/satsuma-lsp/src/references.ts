import { Location } from "vscode-languageserver";
import { fieldNameText } from "@satsuma/core";
import type { SyntaxNode, Tree } from "./parser-utils";
import { child, nodeAtPosition } from "./parser-utils";
import { findNodeContext, resolveArrowContextField, type NodeContext } from "./definition";
import {
  WorkspaceIndex,
  arrowFieldReferenceKeys,
  resolveDefinition,
  findReferences as indexFindReferences,
  resolveReferenceKey,
} from "./workspace-index";

/**
 * Compute all references for the symbol at the given position.
 * Returns Location[] spanning potentially multiple files.
 */
export function computeReferences(
  tree: Tree,
  line: number,
  character: number,
  _uri: string,
  index: WorkspaceIndex,
  includeDeclaration: boolean,
): Location[] {
  const node = nodeAtPosition(tree, line, character);
  if (!node) return [];

  const ctx = findNodeContext(node);
  if (!ctx) return [];

  // Determine the canonical name to search for. A bare name authored inside
  // a namespace binds to the namespace-local definition when one exists, so
  // the reference query must use that qualified key (sl-p256).
  const name = ctx.name;
  if (!name) return [];
  const refKey = resolveReferenceKey(index, name, ctx.namespace ?? null);

  // Use a seen set so qualified + bare lookups never duplicate the same location.
  const seen = new Set<string>();
  const results: Location[] = [];

  function addRef(uri: string, range: import("vscode-languageserver").Range): void {
    const key = `${uri}:${range.start.line}:${range.start.character}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(Location.create(uri, range));
  }

  if (isArrowField(ctx)) {
    // An arrow path names one field, resolved against its containers; it is
    // found under the keys the index files that same resolved field under.
    // The bare-name key is not consulted: it matches every field of that
    // name, so `.id` inside an each would also list the top-level `id`.
    for (const qk of arrowFieldReferenceKeys(arrowSideSchemas(ctx), ctx.fieldPath ?? [])) {
      for (const ref of indexFindReferences(index, qk)) addRef(ref.uri, ref.range);
    }
    if (includeDeclaration) {
      const declared = resolveArrowContextField(ctx, index);
      if (declared) addRef(declared.uri, declared.field.range);
    }
    return results;
  }

  // Add references binding to the canonical key (always)
  for (const ref of indexFindReferences(index, refKey)) {
    addRef(ref.uri, ref.range);
  }

  // Right-click on a field in a schema/fragment definition: also look up the
  // schema-qualified key arrows are indexed under, with the field's full
  // nested path so `orders.id` meets `.id` written inside `each orders`.
  if (ctx.kind === "field_name" && ctx.parentName) {
    const qualKey = `${ctx.parentName}.${declaredFieldPath(ctx.node).join(".")}`;
    for (const ref of indexFindReferences(index, qualKey)) {
      addRef(ref.uri, ref.range);
    }
  }

  // Optionally include the declaration itself
  if (includeDeclaration) {
    const defs = resolveDefinition(index, name, ctx.namespace);
    for (const def of defs) {
      addRef(def.uri, def.selectionRange);
    }
  }

  return results;
}

/** True for a context on an arrow's source or target path. */
function isArrowField(ctx: NodeContext): boolean {
  return ctx.kind === "arrow_source" || ctx.kind === "arrow_target";
}

/** The schemas on the mapping side an arrow-path context sits on. */
function arrowSideSchemas(ctx: NodeContext): string[] {
  return (ctx.kind === "arrow_source" ? ctx.mappingSources : ctx.mappingTargets) ?? [];
}

/**
 * The names of a declared field and of every record field enclosing it,
 * outermost first: `["orders", "id"]` for `id` inside `orders record { }`.
 */
function declaredFieldPath(fieldNameNode: SyntaxNode): string[] {
  const path: string[] = [];
  for (let n: SyntaxNode | null = fieldNameNode; n; n = n.parent) {
    if (n.type !== "field_decl") continue;
    const nameNode = child(n, "field_name");
    const name = nameNode ? fieldNameText(nameNode) : null;
    if (name) path.unshift(name);
  }
  return path;
}
