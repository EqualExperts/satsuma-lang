import { Location } from "vscode-languageserver";
import type { Tree } from "./parser-utils";
import { nodeAtPosition } from "./parser-utils";
import { findNodeContext } from "./definition";
import {
  WorkspaceIndex,
  resolveDefinition,
  findReferences as indexFindReferences,
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

  // Determine the canonical name to search for
  const name = ctx.name;
  if (!name) return [];

  // Use a seen set so qualified + bare lookups never duplicate the same location.
  const seen = new Set<string>();
  const results: Location[] = [];

  function addRef(uri: string, range: import("vscode-languageserver").Range): void {
    const key = `${uri}:${range.start.line}:${range.start.character}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(Location.create(uri, range));
  }

  // Add bare-name references (always)
  for (const ref of indexFindReferences(index, name)) {
    addRef(ref.uri, ref.range);
  }

  // Also look up schema-qualified references (schema.field) so we find all
  // arrow occurrences of a field regardless of how they were indexed.
  const qualKeys: string[] = [];

  if (ctx.kind === "field_name" && ctx.parentName) {
    // Right-click on field in schema/fragment definition
    qualKeys.push(`${ctx.parentName}.${name}`);
  } else if (ctx.kind === "arrow_source" && ctx.mappingSources) {
    // Right-click on field in arrow left-hand side
    for (const schema of ctx.mappingSources) qualKeys.push(`${schema}.${name}`);
  } else if (ctx.kind === "arrow_target" && ctx.mappingTargets) {
    // Right-click on field in arrow right-hand side
    for (const schema of ctx.mappingTargets) qualKeys.push(`${schema}.${name}`);
  }

  for (const qk of qualKeys) {
    for (const ref of indexFindReferences(index, qk)) {
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
