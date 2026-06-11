import { Location } from "vscode-languageserver";
import { createAtRefRegex, fieldNameText, qualifiedNameText, sourceRefText } from "@satsuma/core";
import type { SyntaxNode, Tree } from "./parser-utils";
import { child, children, labelText, nodeAtPosition } from "./parser-utils";
import {
  WorkspaceIndex,
  resolveDefinition,
  FieldInfo,
} from "./workspace-index";

/**
 * Compute go-to-definition for the node at the given position.
 * Returns Location(s) pointing to the definition site, or null.
 */
export function computeDefinition(
  tree: Tree,
  line: number,
  character: number,
  uri: string,
  index: WorkspaceIndex,
): Location | Location[] | null {
  const node = nodeAtPosition(tree, line, character);
  if (!node) return null;

  // Check if cursor is on an @ref inside an NL string
  const nlRef = tryNlRefContext(node, line, character);
  if (nlRef) return resolveContext(nlRef, uri, index);

  const ctx = findNodeContext(node);
  if (!ctx) return null;

  return resolveContext(ctx, uri, index);
}

// ---------- Context detection ----------

export interface NodeContext {
  kind:
    | "source_ref"
    | "target_ref"
    | "spread"
    | "import_name"
    | "import_path"
    | "block_label"
    | "field_name"
    | "arrow_source"
    | "arrow_target"
    | "nl_ref"
    | "unknown";
  name: string;
  namespace: string | null;
  /** For field_name context: the qualified enclosing schema/fragment name (e.g. "sfdc_opportunity" or "ns::sfdc_opportunity"). */
  parentName?: string;
  /** For arrow field context: the source/target schemas of the enclosing mapping. */
  mappingSources?: string[];
  mappingTargets?: string[];
  /** Raw path text for arrow and NL field contexts. */
  rawPath?: string;
  /** The node we identified context from (for range info). */
  node: SyntaxNode;
}

/** Walk up from a node to determine what kind of reference it is. */
export function findNodeContext(startNode: SyntaxNode): NodeContext | null {
  let current: SyntaxNode | null = startNode;

  while (current) {
    const ctx = tryContext(current);
    if (ctx) return ctx;
    current = current.parent;
  }
  return null;
}

function tryContext(node: SyntaxNode): NodeContext | null {
  const ns = findEnclosingNamespace(node);

  switch (node.type) {
    case "source_ref": {
      const name = sourceRefText(node);
      if (!name) return null;
      // _source_entry is a hidden grammar rule that inlines away, so a
      // source_ref's parent is the source_block/target_block itself (sl-0tgo).
      const inTarget = node.parent?.type === "target_block";
      return {
        kind: inTarget ? "target_ref" : "source_ref",
        name,
        namespace: ns,
        node,
      };
    }

    case "spread_label": {
      const name = spreadLabelText(node);
      if (!name) return null;
      return { kind: "spread", name, namespace: ns, node };
    }

    case "fragment_spread": {
      const sl = child(node, "spread_label");
      const name = sl ? spreadLabelText(sl) : null;
      if (!name) return null;
      return { kind: "spread", name, namespace: ns, node: sl ?? node };
    }

    case "import_name": {
      const name = importNameText(node);
      if (!name) return null;
      return { kind: "import_name", name, namespace: null, node };
    }

    case "import_path": {
      const text = importPathText(node);
      if (!text) return null;
      return { kind: "import_path", name: text, namespace: null, node };
    }

    case "block_label": {
      const block = node.parent;
      if (!block) return null;
      const name = labelText(block);
      if (!name) return null;
      const qualName = ns ? `${ns}::${name}` : name;
      return { kind: "block_label", name: qualName, namespace: ns, node };
    }

    case "field_name": {
      const name = fieldNameText(node);
      if (!name) return null;
      const block = findEnclosingBlock(node);
      const blockName = block ? labelText(block) : null;
      const parentName = blockName ? (ns ? `${ns}::${blockName}` : blockName) : undefined;
      return { kind: "field_name", name, namespace: ns, parentName, node };
    }

    case "src_path": {
      const pathText = extractPathFieldName(node);
      const rawPath = extractPathText(node);
      if (!pathText || !rawPath) return null;
      const mapping = findEnclosingMapping(node);
      return {
        kind: "arrow_source",
        name: pathText,
        namespace: ns,
        node,
        rawPath,
        mappingSources: mapping ? getMappingSchemaRefs(mapping, "source_block") : [],
        mappingTargets: mapping ? getMappingSchemaRefs(mapping, "target_block") : [],
      };
    }

    case "tgt_path": {
      const pathText = extractPathFieldName(node);
      const rawPath = extractPathText(node);
      if (!pathText || !rawPath) return null;
      const mapping = findEnclosingMapping(node);
      return {
        kind: "arrow_target",
        name: pathText,
        namespace: ns,
        node,
        rawPath,
        mappingSources: mapping ? getMappingSchemaRefs(mapping, "source_block") : [],
        mappingTargets: mapping ? getMappingSchemaRefs(mapping, "target_block") : [],
      };
    }

    case "at_ref": {
      // @ref CST node in bare pipe text or metadata value text
      const rawRef = node.text.slice(1); // strip leading @
      const refName = rawRef.replace(/`([^`]+)`/g, "$1");
      const mapping = findEnclosingMapping(node);
      return {
        kind: "nl_ref",
        name: refName,
        namespace: ns,
        node,
        mappingSources: mapping ? getMappingSchemaRefs(mapping, "source_block") : [],
        mappingTargets: mapping ? getMappingSchemaRefs(mapping, "target_block") : [],
      };
    }

    // Handle identifiers and backtick_names that are inside source_ref, spread, etc.
    case "identifier":
    case "backtick_name":
    case "qualified_name":
    case "nl_string":
      // Let the parent handle it
      return null;

    default:
      return null;
  }
}

// ---------- Resolution ----------

function resolveContext(
  ctx: NodeContext,
  _uri: string,
  index: WorkspaceIndex,
): Location | Location[] | null {
  switch (ctx.kind) {
    case "source_ref":
    case "target_ref": {
      const defs = resolveDefinition(index, ctx.name, ctx.namespace);
      return defsToLocations(defs);
    }

    case "spread": {
      // Try fragment first, then transform
      let defs = resolveDefinition(index, ctx.name, ctx.namespace);
      if (defs.length === 0) {
        // Multi-word spreads might need different resolution
        defs = resolveDefinition(index, ctx.name, ctx.namespace);
      }
      return defsToLocations(defs);
    }

    case "import_name": {
      const defs = resolveDefinition(index, ctx.name, null);
      return defsToLocations(defs);
    }

    case "import_path": {
      // The name is the raw path text — the server must resolve it to a URI.
      // We return null here; the server wiring resolves import paths.
      return null;
    }

    case "block_label": {
      // Cursor is on a definition — return itself (useful for peek)
      const defs = resolveDefinition(index, ctx.name, ctx.namespace);
      return defsToLocations(defs);
    }

    case "field_name": {
      // For field names, look in the enclosing schema/fragment
      const block = findEnclosingBlock(ctx.node);
      if (!block) return null;
      const blockName = labelText(block);
      if (!blockName) return null;
      const ns = findEnclosingNamespace(ctx.node);
      const qualName = ns ? `${ns}::${blockName}` : blockName;
      const defs = resolveDefinition(index, qualName, ns);
      for (const def of defs) {
        const loc = findFieldInDef(def, ctx.name);
        if (loc) return loc;
      }
      return null;
    }

    case "arrow_source": {
      // Look up field in source schemas of the enclosing mapping
      const schemas = ctx.mappingSources ?? [];
      return resolveFieldInSchemas(index, schemas, ctx.name, ctx.namespace);
    }

    case "arrow_target": {
      // Look up field in target schemas of the enclosing mapping
      const schemas = ctx.mappingTargets ?? [];
      return resolveFieldInSchemas(index, schemas, ctx.name, ctx.namespace);
    }

    case "nl_ref": {
      // Try as a block name first (schema, fragment, etc.)
      const blockDefs = resolveDefinition(index, ctx.name, ctx.namespace);
      if (blockDefs.length > 0) return defsToLocations(blockDefs);

      // Try as a field name in the enclosing mapping's source/target schemas
      const allSchemas = [
        ...(ctx.mappingSources ?? []),
        ...(ctx.mappingTargets ?? []),
      ];
      const fieldLoc = resolveFieldInSchemas(index, allSchemas, ctx.name, ctx.namespace);
      if (fieldLoc) return fieldLoc;

      // Try as a dotted path (e.g., "schema.field")
      if (ctx.name.includes(".")) {
        const parts = ctx.name.split(".");
        const schemaName = parts[0]!;
        const fieldName = parts[parts.length - 1]!;
        return resolveFieldInSchemas(index, [schemaName], fieldName, ctx.namespace);
      }

      return null;
    }

    default:
      return null;
  }
}

function defsToLocations(
  defs: Array<{ uri: string; selectionRange: import("vscode-languageserver").Range }>,
): Location | Location[] | null {
  if (defs.length === 0) return null;
  if (defs.length === 1 && defs[0]) {
    return Location.create(defs[0].uri, defs[0].selectionRange);
  }
  return defs.map((d) => Location.create(d.uri, d.selectionRange));
}

function findFieldInDef(
  def: { uri: string; fields: FieldInfo[] },
  fieldName: string,
): Location | null {
  const match = findFieldRecursive(def.fields, fieldName);
  if (match) {
    return Location.create(def.uri, match.range);
  }
  return null;
}

function findFieldRecursive(fields: FieldInfo[], name: string): FieldInfo | null {
  for (const f of fields) {
    if (f.name === name) return f;
    const nested = findFieldRecursive(f.children, name);
    if (nested) return nested;
  }
  return null;
}

/** Resolve a field name by searching across multiple schema definitions. */
function resolveFieldInSchemas(
  index: WorkspaceIndex,
  schemaNames: string[],
  fieldName: string,
  namespace: string | null,
): Location | null {
  for (const schemaName of schemaNames) {
    const defs = resolveDefinition(index, schemaName, namespace);
    for (const def of defs) {
      const loc = findFieldInDef(def, fieldName);
      if (loc) return loc;
    }
  }
  return null;
}

// ---------- Tree helpers ----------

function findEnclosingNamespace(node: SyntaxNode): string | null {
  let current: SyntaxNode | null = node.parent;
  while (current) {
    if (current.type === "namespace_block") {
      return current.childForFieldName("name")?.text ?? null;
    }
    current = current.parent;
  }
  return null;
}

function findEnclosingBlock(node: SyntaxNode): SyntaxNode | null {
  let current: SyntaxNode | null = node.parent;
  while (current) {
    if (
      current.type === "schema_block" ||
      current.type === "fragment_block" ||
      current.type === "transform_block" ||
      current.type === "mapping_block"
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

// ---------- Text extraction ----------

function spreadLabelText(node: SyntaxNode): string | null {
  const qn = child(node, "qualified_name");
  if (qn) return qualifiedNameText(qn) ?? qn.text;
  const quoted = child(node, "backtick_name");
  if (quoted) return quoted.text.slice(1, -1);
  const ids = node.namedChildren.filter((c) => c.type === "identifier");
  if (ids.length > 0) return ids.map((i) => i.text).join(" ");
  return node.text;
}

function importNameText(node: SyntaxNode): string | null {
  const qn = child(node, "qualified_name");
  if (qn) return qualifiedNameText(qn) ?? qn.text;
  const quoted = child(node, "backtick_name");
  if (quoted) return quoted.text.slice(1, -1);
  const id = child(node, "identifier");
  if (id) return id.text;
  return null;
}

function importPathText(node: SyntaxNode): string | null {
  // import_path is an alias for nl_string
  const text = node.text;
  if (text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1);
  return text;
}

// ---------- Arrow field helpers ----------

/** Find the enclosing mapping_block node. */
function findEnclosingMapping(node: SyntaxNode): SyntaxNode | null {
  let current: SyntaxNode | null = node.parent;
  while (current) {
    if (current.type === "mapping_block") return current;
    current = current.parent;
  }
  return null;
}

/** Extract the first segment of a path (the field name before any dots). */
function extractPathFieldName(pathNode: SyntaxNode): string | null {
  // src_path / tgt_path wraps a _path_expr which can be:
  //   field_path (identifier.identifier...), relative_field_path (.identifier...),
  //   backtick_path, namespaced_path
  const text = pathNode.text;
  if (!text) return null;

  // Handle backtick paths: `field name`
  if (text.startsWith("`") && text.endsWith("`")) {
    return text.slice(1, -1).split(".")[0] ?? null;
  }

  // Handle dotted paths: take the first segment
  const firstSegment = text.split(".")[0]!;
  // Handle namespaced: ns::field → take field part
  if (firstSegment.includes("::")) {
    return firstSegment.split("::").pop() ?? null;
  }
  return firstSegment;
}

function extractPathText(pathNode: SyntaxNode): string | null {
  const text = pathNode.text.trim();
  return text.length > 0 ? text : null;
}

/** Get schema names referenced in a mapping's source or target block. */
function getMappingSchemaRefs(
  mappingNode: SyntaxNode,
  blockType: "source_block" | "target_block",
): string[] {
  const body = child(mappingNode, "mapping_body");
  if (!body) return [];

  const names: string[] = [];
  for (const ch of body.namedChildren) {
    if (ch.type === blockType) {
      for (const ref of children(ch, "source_ref")) {
        const name = sourceRefText(ref);
        if (name) names.push(name);
      }
    }
  }
  return names;
}

// ---------- NL reference detection ----------

const AT_REF_RE = createAtRefRegex();

/**
 * Check if the cursor is on an @ref reference inside an NL string.
 * Returns a NodeContext with kind "nl_ref" if so.
 */
function tryNlRefContext(
  node: SyntaxNode,
  line: number,
  character: number,
): NodeContext | null {
  // The node itself might be the nl_string, or it might be a descendant.
  // Walk up to find the nl_string or multiline_string node.
  let nlNode: SyntaxNode | null = node;
  while (nlNode) {
    if (nlNode.type === "nl_string" || nlNode.type === "multiline_string") break;
    nlNode = nlNode.parent;
  }
  if (!nlNode) return null;

  const text = nlNode.text;
  const nodeStartRow = nlNode.startPosition.row;
  const nodeStartCol = nlNode.startPosition.column;

  // Calculate cursor offset within the node text
  let cursorOffset: number;
  if (line === nodeStartRow) {
    cursorOffset = character - nodeStartCol;
  } else {
    const lines = text.split("\n");
    let offset = 0;
    for (let i = 0; i < line - nodeStartRow; i++) {
      offset += (lines[i]?.length ?? 0) + 1; // +1 for newline
    }
    cursorOffset = offset + character;
  }

  // Find which ref (backtick or @ref) the cursor is within
  // Try @ref first (preferred modern syntax)
  AT_REF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = AT_REF_RE.exec(text)) !== null) {
    const refStart = match.index;
    const refEnd = refStart + match[0].length;
    if (cursorOffset >= refStart && cursorOffset < refEnd) {
      // Strip leading @ and backtick delimiters from the ref name
      const rawRef = match[0].slice(1);
      const refName = rawRef.replace(/`([^`]+)`/g, "$1");
      const ns = findEnclosingNamespace(nlNode);
      const mapping = findEnclosingMapping(nlNode);
      return {
        kind: "nl_ref",
        name: refName,
        namespace: ns,
        node: nlNode,
        mappingSources: mapping ? getMappingSchemaRefs(mapping, "source_block") : [],
        mappingTargets: mapping ? getMappingSchemaRefs(mapping, "target_block") : [],
      };
    }
  }



  return null;
}
