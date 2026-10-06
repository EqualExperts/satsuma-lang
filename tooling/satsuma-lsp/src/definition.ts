import { Location } from "vscode-languageserver";
import {
  createAtRefRegex,
  fieldNameText,
  importNameText,
  metricSourceRefs,
  resolveArrowPathInPlace,
  resolvedSegmentsThrough,
  sourceRefText,
  spreadLabelText,
} from "@satsuma/core";
import { resolveArrowField, type ArrowFieldTarget } from "./arrow-field";
import type { SyntaxNode, Tree } from "./parser-utils";
import { child, children, labelText, nodeAtPosition } from "./parser-utils";
import { WorkspaceIndex, resolveDefinition, FieldInfo } from "./workspace-index";

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
    | "metric_source"
    | "arrow_schema"
    | "namespace_name"
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
  /**
   * For arrow_source / arrow_target: the field the cursor names, as the path
   * resolved against its enclosing each/flatten/nested containers and cut at
   * the segment under the cursor (core `resolvedSegmentsThrough`). It may lead
   * with a schema name when the mapping side has several. `name` is its last
   * segment.
   */
  fieldPath?: string[];
  /** The node we identified context from (for range info). */
  node: SyntaxNode;
}

/** Walk up from a node to determine what kind of reference it is. */
export function findNodeContext(startNode: SyntaxNode): NodeContext | null {
  let current: SyntaxNode | null = startNode;

  while (current) {
    const ctx = tryContext(current, startNode);
    if (ctx) return ctx;
    current = current.parent;
  }
  return null;
}

/**
 * The context `node` establishes, if any. `cursorNode` is the node the walk
 * started from; an arrow path uses it to tell which segment is under the
 * cursor.
 */
function tryContext(node: SyntaxNode, cursorNode: SyntaxNode): NodeContext | null {
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

    case "src_path":
      return arrowPathContext(node, cursorNode, "arrow_source", ns);

    case "tgt_path":
      return arrowPathContext(node, cursorNode, "arrow_target", ns);

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

    // A metric's declared provenance: the value of a `source` tag inside a
    // metric's metadata block, e.g. `(metric, source fact_orders)` or
    // `` (metric, source { raw::`crm-contacts`, other }) ``. `workspace-index`
    // indexes each named source as a "metric_source" reference, read by
    // core's metricSourceRefs; reading it the same way here makes the name
    // unquoted and picks the list item under the cursor (gpt-jwek, bsw-iuzs).
    case "value_text": {
      const tag = node.parent;
      if (!tag || tag.type !== "tag_with_value") return null;
      const key = tag.namedChildren[0];
      if (key?.text !== "source") return null;
      const ref = metricSourceUnderCursor(node, cursorNode);
      if (!ref) return null;
      return { kind: "metric_source", name: ref.name, namespace: ns, node: ref.node };
    }

    // Handle identifiers and backtick_names that are inside source_ref, spread, etc.
    case "identifier": {
      // Two reference shapes are plain `identifier` nodes with no dedicated
      // grammar rule of their own, so they must be detected here before
      // falling through: the schema prefix of a qualified arrow path
      // (`s0` in `s0.field_0`) and a namespace's own declared name. Both
      // are indexed as references elsewhere (rename rewrites the arrow
      // prefix; find-references lists the namespace) but neither had a
      // go-to-definition case (gpt-jwek).
      const namespaceCtx = tryNamespaceNameContext(node);
      if (namespaceCtx) return namespaceCtx;
      const arrowSchemaCtx = tryArrowSchemaPrefixContext(node, ns);
      if (arrowSchemaCtx) return arrowSchemaCtx;
      // Neither shape matched — let the parent (source_ref, block_label,
      // src_path, ...) handle it, same as before.
      return null;
    }

    case "backtick_name":
    case "qualified_name":
    case "nl_string":
      // Let the parent handle it
      return null;

    default:
      return null;
  }
}

/**
 * The context of a `src_path` / `tgt_path`: the field it names, resolved
 * against its enclosing containers by core, never by re-reading the text.
 *
 * The path is resolved where it sits, so `.id` inside `each orders -> rows`
 * names `orders.id` on the source side and `rows.id` on the target side, a
 * backtick segment arrives unquoted, and `^.` / `$.` reach the ancestor they
 * escape to (ADR-053). Reading the text instead turned `.id` into an empty
 * first segment and every relative path into "no definition" (bsw-89wr).
 */
function arrowPathContext(
  pathNode: SyntaxNode,
  cursorNode: SyntaxNode,
  kind: "arrow_source" | "arrow_target",
  ns: string | null,
): NodeContext | null {
  const inPlace = resolveArrowPathInPlace(pathNode);
  const rawPath = extractPathText(pathNode);
  if (!inPlace || !rawPath) return null;
  const fieldPath = resolvedSegmentsThrough(inPlace, cursorNode);
  const name = fieldPath[fieldPath.length - 1];
  if (!name) return null;
  const mapping = findEnclosingMapping(pathNode);
  return {
    kind,
    name,
    namespace: ns,
    node: pathNode,
    rawPath,
    fieldPath,
    mappingSources: mapping ? getMappingSchemaRefs(mapping, "source_block") : [],
    mappingTargets: mapping ? getMappingSchemaRefs(mapping, "target_block") : [],
  };
}

/**
 * The declared field an arrow_source / arrow_target context names, looked up
 * by its full resolved path among the schemas on its side of the mapping.
 * Null for any other context kind, or when no schema declares the path.
 * Shared by go-to-definition, find-references and hover so all three agree.
 */
export function resolveArrowContextField(
  ctx: NodeContext,
  index: WorkspaceIndex,
): ArrowFieldTarget | null {
  if (!ctx.fieldPath) return null;
  const schemas =
    ctx.kind === "arrow_source"
      ? ctx.mappingSources
      : ctx.kind === "arrow_target"
        ? ctx.mappingTargets
        : undefined;
  if (!schemas) return null;
  return resolveArrowField(index, schemas, ctx.fieldPath, ctx.namespace);
}

/**
 * A `namespace`'s own declared name (`namespace ns_a { ... }`). It is a plain
 * `identifier` — namespaces use `field("name", $.identifier)`, not the
 * `block_label` syntax schemas and mappings share — so nothing in
 * `tryContext`'s other cases ever matched it (gpt-jwek).
 */
function tryNamespaceNameContext(identifierNode: SyntaxNode): NodeContext | null {
  const block = identifierNode.parent;
  if (!block || block.type !== "namespace_block") return null;
  // Compared with `.equals()`, not `===` — see the identical note in
  // tryArrowSchemaPrefixContext.
  if (!block.childForFieldName("name").equals(identifierNode)) return null;
  // A namespace_block is never nested (spec: namespaces are flat), so this
  // name is never itself inside another namespace.
  return {
    kind: "namespace_name",
    name: identifierNode.text,
    namespace: null,
    node: identifierNode,
  };
}

/**
 * The schema prefix of a qualified arrow path (`s0` in `s0.field_0`), written
 * when a mapping's side has more than one schema. `workspace-index` indexes
 * this identifier as a reference to the schema itself — which is what makes
 * renaming the schema rewrite the prefix — but the enclosing `src_path`/
 * `tgt_path` case always treats a path's first segment as a *field* name of
 * the mapping's schemas, and a schema name never is one (gpt-jwek). Detected
 * at the identifier itself so a later segment (the real field name) still
 * falls through unchanged to that case.
 */
function tryArrowSchemaPrefixContext(
  identifierNode: SyntaxNode,
  ns: string | null,
): NodeContext | null {
  const pathNode = identifierNode.parent;
  if (!pathNode || pathNode.type !== "field_path") return null;
  // Only a path's first segment can name a schema; later segments are never
  // this identifier once the length check below passes. Compared with
  // `.equals()` rather than `===` — web-tree-sitter mints a fresh wrapper
  // object on every `.namedChildren` access, so two wrappers over the same
  // underlying node are never reference-equal.
  const firstSegment = pathNode.namedChildren[0];
  if (!firstSegment || !firstSegment.equals(identifierNode) || pathNode.namedChildren.length < 2) {
    return null;
  }

  const wrapper = pathNode.parent;
  const isSource = wrapper?.type === "src_path";
  const isTarget = wrapper?.type === "tgt_path";
  if (!wrapper || (!isSource && !isTarget)) return null;

  const mapping = findEnclosingMapping(wrapper);
  const schemas = mapping
    ? getMappingSchemaRefs(mapping, isSource ? "source_block" : "target_block")
    : [];
  const name = identifierNode.text;
  if (!schemas.includes(name)) return null;
  if (!isSchemaPrefixAfterResolution(wrapper, identifierNode)) return null;

  // Carried alongside the schema name, not used to find it: `action-context.ts`
  // infers the full field path (e.g. "customers.email") from the same
  // schema-list shape `src_path`/`tgt_path` contexts carry, resolving the path
  // through core and keeping `rawPath` only as its fallback.
  return {
    kind: "arrow_schema",
    name,
    namespace: ns,
    node: identifierNode,
    rawPath: extractPathText(wrapper) ?? undefined,
    mappingSources: mapping ? getMappingSchemaRefs(mapping, "source_block") : [],
    mappingTargets: mapping ? getMappingSchemaRefs(mapping, "target_block") : [],
  };
}

/**
 * Whether `segment` is still the first segment of `pathNode` once core has
 * resolved the path against its enclosing each/flatten containers.
 *
 * Only then can it be a schema prefix. Inside `each orders`, `src.x` resolves
 * to `orders.src.x`: `src` is a field of the container that merely shares a
 * schema's name, and reading it as the prefix traced and jumped to the
 * top-level `src.x` instead (bsw-pv7a). At mapping-body level, or after a
 * `$.` escape to the root, the authored first segment stays first.
 */
function isSchemaPrefixAfterResolution(pathNode: SyntaxNode, segment: SyntaxNode): boolean {
  const inPlace = resolveArrowPathInPlace(pathNode);
  if (!inPlace) return true;
  return resolvedSegmentsThrough(inPlace, segment).length === 1;
}

// ---------- Resolution ----------

function resolveContext(
  ctx: NodeContext,
  _uri: string,
  index: WorkspaceIndex,
): Location | Location[] | null {
  switch (ctx.kind) {
    case "source_ref":
    case "target_ref":
    case "metric_source":
    case "arrow_schema":
    case "namespace_name": {
      // A metric's `source` value, an arrow's qualified schema prefix and a
      // namespace's own name all resolve the same way as a plain source/
      // target reference: look the name up as a definition directly (gpt-jwek).
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

    case "arrow_source":
    case "arrow_target": {
      const target = resolveArrowContextField(ctx, index);
      return target ? Location.create(target.uri, target.field.range) : null;
    }

    case "nl_ref": {
      // Try as a block name first (schema, fragment, etc.)
      const blockDefs = resolveDefinition(index, ctx.name, ctx.namespace);
      if (blockDefs.length > 0) return defsToLocations(blockDefs);

      // Try as a field name in the enclosing mapping's source/target schemas
      const allSchemas = [...(ctx.mappingSources ?? []), ...(ctx.mappingTargets ?? [])];
      const fieldLoc = resolveFieldInSchemas(index, allSchemas, ctx.name, ctx.namespace);
      if (fieldLoc) return fieldLoc;

      // Try as a dotted path (e.g., "schema.field")
      if (ctx.name.includes(".")) {
        const parts = ctx.name.split(".");
        // A string containing "." always splits into at least 2 parts, so
        // both ends are defined; the fallbacks exist only for
        // noUncheckedIndexedAccess.
        const [schemaName = "", fieldName = ""] = [parts[0], parts[parts.length - 1]];
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
      return current.childForFieldName("name").text;
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

/**
 * The metric source a cursor inside a `source` tag's value names: the list
 * item containing the cursor node, or the sole item when the cursor sits on
 * the value itself (a brace or the whitespace of a one-name list). Null when
 * the cursor is between items of a longer list. The name comes from core's
 * metricSourceRefs; the node returned is this package's view of the same
 * list item, for range information.
 */
function metricSourceUnderCursor(
  value: SyntaxNode,
  cursorNode: SyntaxNode,
): { name: string; node: SyntaxNode } | null {
  const refs = metricSourceRefs(value);
  const contains = (n: { startIndex: number; endIndex: number }) =>
    cursorNode.startIndex >= n.startIndex && cursorNode.endIndex <= n.endIndex;
  const ref = refs.find((r) => contains(r.node)) ?? (refs.length === 1 ? refs[0] : undefined);
  if (!ref) return null;
  const node = value.namedChildren.find((c) => c.startIndex === ref.node.startIndex) ?? value;
  return { name: ref.name, node };
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
function tryNlRefContext(node: SyntaxNode, line: number, character: number): NodeContext | null {
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
