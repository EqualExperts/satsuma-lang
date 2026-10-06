/**
 * references.ts — find-references for the symbol under the cursor.
 *
 * Block names (schemas, fragments, transforms, mappings) are found through the
 * index's name-keyed references, re-resolved per namespace (sl-p256). Fields
 * are different: an arrow path names a field only once the mapping's schemas,
 * the enclosing each/flatten and the shadow rule are taken into account, so
 * arrow uses of a field are found by resolving each candidate arrow segment
 * with the same lookup go-to-definition uses (arrow-field.ts). A query from a
 * declaration and a query from an arrow both reduce to "this declared field",
 * so they return the same set (bsw-89wr).
 */

import { Location, type Range } from "vscode-languageserver";
import { fieldNameText } from "@satsuma/core";
import type { SyntaxNode, Tree } from "./parser-utils";
import { child, nodeAtPosition, nodeRange } from "./parser-utils";
import { findNodeContext, resolveArrowContextField, type NodeContext } from "./definition";
import { findArrowSegmentsNaming } from "./arrow-field";
import {
  WorkspaceIndex,
  canonicalizeFileUri,
  resolveDefinition,
  findReferences as indexFindReferences,
  resolveReferenceKey,
} from "./workspace-index";

/** A declared field, identified by where its name is declared. */
interface FieldDeclarationSite {
  /** Canonical URI of the declaring file. */
  uri: string;
  /** Range of the field's name in its declaration. */
  range: Range;
  /** The field's name. */
  name: string;
  /**
   * `owner.path.to.field` — the key NL `@schema.field` mentions of it are
   * indexed under (gpt-fjo7). Null when the owner is unknown.
   */
  qualifiedKey: string | null;
}

/**
 * Compute all references for the symbol at the given position.
 * Returns Location[] spanning potentially multiple files.
 */
export function computeReferences(
  tree: Tree,
  line: number,
  character: number,
  uri: string,
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

  // Use a seen set so overlapping lookups never duplicate the same location.
  const seen = new Set<string>();
  const results: Location[] = [];

  function addRef(refUri: string, range: Range): void {
    const key = `${refUri}:${range.start.line}:${range.start.character}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(Location.create(refUri, range));
  }

  // ---------- Fields: from an arrow path or a declaration ----------

  if (isArrowField(ctx) || ctx.kind === "field_name") {
    const site = isArrowField(ctx)
      ? arrowFieldSite(ctx, index)
      : declarationSite(ctx, canonicalizeFileUri(uri));
    if (!site) {
      // An arrow path no declared field matches has no other uses we can
      // attribute to it; report just this site.
      if (isArrowField(ctx)) addRef(uri, nodeRange(ctx.node));
      return results;
    }
    for (const ref of fieldReferences(index, site, ctx.name)) addRef(ref.uri, ref.range);
    if (includeDeclaration) addRef(site.uri, site.range);
    return results;
  }

  // ---------- Block names ----------

  const refKey = resolveReferenceKey(index, name, ctx.namespace ?? null);
  for (const ref of indexFindReferences(index, refKey)) {
    addRef(ref.uri, ref.range);
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

/**
 * Every use of a declared field: the arrow segments that resolve to it, and
 * the NL `@` mentions filed under its bare or qualified name. Only those two
 * kinds of reference name a field; the arrow entries filed under name keys
 * are left out because they are filed by spelling, so a bare `id` key holds
 * every arrow starting with `id`, whichever field it names.
 */
function fieldReferences(
  index: WorkspaceIndex,
  site: FieldDeclarationSite,
  cursorName: string,
): Array<{ uri: string; range: Range }> {
  const found: Array<{ uri: string; range: Range }> = [
    ...findArrowSegmentsNaming(index, site.name, site.uri, site.range),
  ];
  const nameKeys = [cursorName, ...(site.qualifiedKey ? [site.qualifiedKey] : [])];
  for (const key of nameKeys) {
    found.push(...indexFindReferences(index, key).filter((ref) => ref.context === "nl"));
  }
  return found;
}

/** The declared field an arrow-path context names, or null when none does. */
function arrowFieldSite(ctx: NodeContext, index: WorkspaceIndex): FieldDeclarationSite | null {
  const target = resolveArrowContextField(ctx, index);
  if (!target) return null;
  return {
    uri: target.uri,
    range: target.field.range,
    name: target.field.name,
    qualifiedKey: `${target.schemaKey}.${target.localPath.join(".")}`,
  };
}

/** The declared field a `field_name` context sits on, in the file `uri`. */
function declarationSite(ctx: NodeContext, uri: string): FieldDeclarationSite {
  return {
    uri,
    range: nodeRange(ctx.node),
    name: ctx.name,
    qualifiedKey: ctx.parentName
      ? `${ctx.parentName}.${declaredFieldPath(ctx.node).join(".")}`
      : null,
  };
}

/** True for a context on an arrow's source or target path. */
function isArrowField(ctx: NodeContext): boolean {
  return ctx.kind === "arrow_source" || ctx.kind === "arrow_target";
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
