import {
  Range,
  WorkspaceEdit,
  TextEdit,
} from "vscode-languageserver";
import type { Tree } from "./parser-utils";
import { nodeRange, nodeAtPosition } from "./parser-utils";
import { findNodeContext, NodeContext } from "./definition";
import {
  WorkspaceIndex,
  resolveDefinition,
  findReferences,
  resolveReferenceKey,
} from "./workspace-index";

/**
 * Validate that the cursor is on a renameable symbol and return its range.
 */
export function prepareRename(
  tree: Tree,
  line: number,
  character: number,
  _uri: string,
  _index: WorkspaceIndex,
): { range: Range; placeholder: string } | null {
  const node = nodeAtPosition(tree, line, character);
  if (!node) return null;

  const ctx = findNodeContext(node);
  if (!ctx) return null;

  // Only allow rename on these context types
  const renameable = new Set<NodeContext["kind"]>([
    "block_label",
    "source_ref",
    "target_ref",
    "spread",
    "import_name",
  ]);

  if (!renameable.has(ctx.kind)) return null;

  // The placeholder must be exactly the text the range covers: clients
  // prefill it and replace the range verbatim with whatever the user accepts.
  // For block labels inside a namespace ctx.name is qualified ("a::foo") but
  // ctx.node covers only the bare label — returning the qualified form wrote
  // "a::foo2" INTO the label, yielding a doubly-qualified name (sl-kilo).
  const placeholder =
    ctx.namespace && ctx.name.startsWith(`${ctx.namespace}::`)
      ? ctx.name.slice(ctx.namespace.length + 2)
      : ctx.name;

  return {
    range: nodeRange(ctx.node),
    placeholder,
  };
}

/**
 * Compute a workspace-wide rename for the symbol at the cursor position.
 */
export function computeRename(
  tree: Tree,
  line: number,
  character: number,
  _uri: string,
  index: WorkspaceIndex,
  newName: string,
): WorkspaceEdit | null {
  const node = nodeAtPosition(tree, line, character);
  if (!node) return null;

  const ctx = findNodeContext(node);
  if (!ctx) return null;

  const oldName = ctx.name;
  if (!oldName || oldName === newName) return null;

  // Check for duplicate: if newName already exists as a definition, refuse
  const existingDefs = resolveDefinition(index, newName, ctx.namespace);
  if (existingDefs.length > 0) {
    // Name collision — return null (server will send error to client)
    return null;
  }

  // Collect all edit locations
  const changes: Record<string, TextEdit[]> = {};

  // 1. Rename the definition site(s)
  const defs = resolveDefinition(index, oldName, ctx.namespace);
  for (const def of defs) {
    addEdit(changes, def.uri, def.selectionRange, newName);
  }

  // 2. Rename all reference sites. Query by the canonical key the symbol
  // binds to — a bare name inside a namespace binds to the namespace-local
  // definition, and findReferences returns only refs resolving to that key,
  // so same-named symbols in other namespaces are never touched (sl-p256).
  const refs = findReferences(index, resolveReferenceKey(index, oldName, ctx.namespace ?? null));
  const oldBare = oldName.includes("::") ? oldName.split("::").pop()! : oldName;
  for (const ref of refs) {
    // For references authored qualified ("ns::oldName"), only replace the
    // name part — rewriting the whole range would delete the "ns::" prefix.
    if (ref.name.includes("::")) {
      const colonIdx = ref.name.indexOf("::");
      const bareInRef = ref.name.slice(colonIdx + 2);
      if (bareInRef === oldBare) {
        // Adjust range to only cover the part after "::"
        const prefixLen = colonIdx + 2;
        const adjusted: Range = {
          start: {
            line: ref.range.start.line,
            character: ref.range.start.character + prefixLen,
          },
          end: ref.range.end,
        };
        addEdit(changes, ref.uri, adjusted, newName);
        continue;
      }
    }
    addEdit(changes, ref.uri, ref.range, newName);
  }

  if (Object.keys(changes).length === 0) return null;

  return { changes };
}

// ---------- Helpers ----------

function addEdit(
  changes: Record<string, TextEdit[]>,
  uri: string,
  range: Range,
  newText: string,
): void {
  if (!changes[uri]) {
    changes[uri] = [];
  }
  changes[uri].push(TextEdit.replace(range, newText));
}
