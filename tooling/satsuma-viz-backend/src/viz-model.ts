/**
 * viz-model.ts — shared VizModel assembly for Satsuma visualization consumers.
 *
 * Owns the host-neutral logic that converts parsed files plus a workspace index
 * into VizModel payloads. This module does not know about LSP requests or VS
 * Code webviews; consumers provide trees and scoped workspace indexes.
 */

import type { SyntaxNode, Tree } from "./parser-utils";
import { child, children, labelText, stringText } from "./parser-utils";
import type { FieldInfo, WorkspaceIndex } from "./workspace-index";
import { findReferences, resolveDefinition } from "./workspace-index";
import type { DefinitionLookup } from "@satsuma/core";
import {
  extractAtRefs,
  classifyRef,
  resolveRef,
  sourceRefText as coreSourceRefText,
  fieldNameText as coreFieldNameText,
  extractMetadata,
  expandEntityFields,
  makeEntityRefResolver,
  extractFieldTree,
  isMetricSchema,
} from "@satsuma/core";
import type { MetaEntry, FieldDecl, SpreadEntity } from "@satsuma/core";

// ---------- VizModel protocol types ----------

// All VizModel types and CONSTRAINT_TAGS live in @satsuma/viz-model. Re-export
// them here so backend consumers have one package boundary for viz assembly.
export type {
  VizModel,
  NamespaceGroup,
  SchemaCard,
  FieldEntry,
  MappingBlock,
  ArrowEntry,
  ResolvedAtRef,
  TransformInfo,
  EachBlock,
  FlattenBlock,
  MetricCard,
  MetricFieldEntry,
  FragmentCard,
  NoteBlock,
  CommentEntry,
  MetadataEntry,
  SourceBlockInfo,
  SourceLocation,
} from "@satsuma/viz-model";
export { CONSTRAINT_TAGS } from "@satsuma/viz-model";

// Local type aliases for use within this file's builder functions.
import type {
  VizModel,
  NamespaceGroup,
  SchemaCard,
  FieldEntry,
  MappingBlock,
  ArrowEntry,
  ResolvedAtRef,
  TransformInfo,
  EachBlock,
  FlattenBlock,
  MetricCard,
  MetricFieldEntry,
  FragmentCard,
  NoteBlock,
  CommentEntry,
  MetadataEntry,
  SourceBlockInfo,
  SourceLocation,
} from "@satsuma/viz-model";
import { CONSTRAINT_TAGS } from "@satsuma/viz-model";

// ---------- VizModel builder ----------

export function buildVizModel(
  uri: string,
  tree: Tree,
  wsIndex: WorkspaceIndex,
): VizModel {
  const root = tree.rootNode;
  const fileNotes: NoteBlock[] = [];
  const globalNs: NamespaceGroup = {
    name: null,
    schemas: [],
    mappings: [],
    metrics: [],
    fragments: [],
  };
  const namespaceMap = new Map<string, NamespaceGroup>();

  for (const node of root.namedChildren) {
    if (node.type === "note_block") {
      fileNotes.push(extractNoteBlock(uri, node));
    } else if (node.type === "namespace_block") {
      const nsName = node.childForFieldName?.("name")?.text ?? null;
      if (nsName) {
        const nsGroup = getOrCreateNamespace(namespaceMap, nsName);
        processNamespaceChildren(uri, node, nsGroup, nsName, wsIndex);
      }
    } else {
      processTopLevelBlock(uri, node, globalNs, null, wsIndex);
    }
  }

  // Also collect warning/question comments that are siblings of top-level blocks
  collectTopLevelComments(uri, root, globalNs, namespaceMap);

  const namespaces: NamespaceGroup[] = [];
  if (
    globalNs.schemas.length > 0 ||
    globalNs.mappings.length > 0 ||
    globalNs.metrics.length > 0 ||
    globalNs.fragments.length > 0
  ) {
    namespaces.push(globalNs);
  }
  for (const ns of namespaceMap.values()) {
    namespaces.push(ns);
  }

  // Inject stub SchemaCards for imported schemas referenced in mappings but not
  // defined in this file. Without these stubs the ELK layout silently drops
  // edges to/from imported schemas, making them invisible in the viz graph.
  injectImportedSchemaStubs(namespaces, globalNs, wsIndex);

  // If globalNs was not yet added but now has stubs, include it.
  if (!namespaces.includes(globalNs) && globalNs.schemas.length > 0) {
    namespaces.unshift(globalNs);
  }

  // Pre-resolve all fragment spreads into schema fields so the viz never sees
  // spread placeholders or fragment nodes — spreads are an authoring shorthand only.
  resolveAndStripSpreads(namespaces);

  return { uri, fileNotes, namespaces };
}

// ---------- Imported schema stubs ----------

/**
 * For each mapping sourceRef/targetRef that is not already present as a schema
 * in the model, look it up in wsIndex.definitions. If found (imported schema),
 * create a stub SchemaCard so the overview graph renders the node and its edges.
 *
 * Stubs are added to globalNs (no namespace prefix) or the appropriate named
 * namespace group, matching the namespace embedded in the qualifiedId.
 */
function injectImportedSchemaStubs(
  namespaces: NamespaceGroup[],
  globalNs: NamespaceGroup,
  wsIndex: WorkspaceIndex,
): void {
  // Collect all qualifiedIds already present in the model.
  const knownIds = new Set<string>();
  for (const ns of namespaces) {
    for (const s of ns.schemas) knownIds.add(s.qualifiedId);
  }

  // Collect all mapping refs (source + target) that need a node.
  const needed = new Set<string>();
  for (const ns of namespaces) {
    for (const m of ns.mappings) {
      for (const ref of m.sourceRefs) {
        if (!knownIds.has(ref)) needed.add(ref);
      }
      if (m.targetRef && !knownIds.has(m.targetRef)) needed.add(m.targetRef);
    }
  }

  for (const qualifiedId of needed) {
    const defs = wsIndex.definitions.get(qualifiedId) ?? [];
    const schemaDef = defs.find((d) => d.kind === "schema");
    if (!schemaDef) continue; // Not found in scope — skip.

    // Derive bare id (strip namespace prefix if present).
    const colonIdx = qualifiedId.indexOf("::");
    const bareId = colonIdx >= 0 ? qualifiedId.slice(colonIdx + 2) : qualifiedId;
    const namespace = colonIdx >= 0 ? qualifiedId.slice(0, colonIdx) : null;

    const stub: SchemaCard = {
      id: bareId,
      qualifiedId,
      kind: "schema",
      label: null,
      fields: schemaDef.fields.map((fi) => fieldInfoToEntry(fi, schemaDef.uri)),
      notes: [],
      comments: [],
      metadata: [],
      location: {
        uri: schemaDef.uri,
        line: schemaDef.range.start.line,
        character: schemaDef.range.start.character,
      },
      hasExternalLineage: true,
      spreads: [],
    };

    // Place in the matching namespace group (or globalNs if none).
    if (namespace) {
      const existing = namespaces.find((n) => n.name === namespace);
      if (existing) {
        existing.schemas.push(stub);
      } else {
        // Namespace not yet in the model — create a group for it.
        const newNs: NamespaceGroup = {
          name: namespace,
          schemas: [stub],
          mappings: [],
          metrics: [],
          fragments: [],
        };
        namespaces.push(newNs);
      }
    } else {
      globalNs.schemas.push(stub);
    }
    knownIds.add(qualifiedId);
  }
}

/**
 * Convert a FieldInfo (from the workspace index) to a FieldEntry (for the viz
 * model). Constraints, notes, and comments are left empty for stub schemas.
 */
function fieldInfoToEntry(fi: FieldInfo, defUri: string): FieldEntry {
  return {
    name: fi.name,
    type: fi.type ?? "",
    constraints: [],
    metadata: [],
    notes: [],
    comments: [],
    children: fi.children.map((c: FieldInfo) => fieldInfoToEntry(c, defUri)),
    location: {
      uri: defUri,
      line: fi.range.start.line,
      character: fi.range.start.character,
    },
  };
}

// ---------- Spread resolution ----------
//
// Delegates to core's expandEntityFields() for the actual spread expansion,
// using callbacks built from the viz model's namespace data. After expansion,
// fragment entries are stripped from the model — spreads are an authoring
// shorthand only.

/**
 * Pre-resolve all fragment spreads into schema fields, then strip fragment
 * nodes from every namespace group.
 *
 * Resolution is cross-namespace (a schema in `src` can spread `common::frag`),
 * namespace-relative (a bare `...frag` resolves within the schema's own
 * namespace first), and transitive (a fragment may itself spread another
 * fragment). Core's expandEntityFields() handles cycle detection and
 * diamond-shaped graphs. Spreads that resolve are replaced by their fields and
 * removed; spreads that don't resolve are left in place so the schema card can
 * surface the dangling reference instead of silently dropping it.
 */
function resolveAndStripSpreads(namespaces: NamespaceGroup[]): void {
  // Build a flat entity lookup for spread resolution across all namespaces.
  const entityMap = new Map<string, SpreadEntity>();
  for (const ns of namespaces) {
    for (const f of ns.fragments) {
      entityMap.set(f.id, fragmentToSpreadEntity(f));
    }
    for (const s of ns.schemas) {
      entityMap.set(s.qualifiedId, schemaToSpreadEntity(s));
    }
  }

  const resolveRef = makeEntityRefResolver(entityMap);
  const lookupFragment = (key: string) => entityMap.get(key) ?? null;

  // Expand schema spreads using core and append resulting fields. The schema's
  // own namespace is the resolution context, so a bare `...audit` inside
  // `namespace crm` finds the fragment keyed `crm::audit` (sl-22ym).
  for (const ns of namespaces) {
    for (const s of ns.schemas) {
      if (s.spreads.length === 0) continue;
      const spreadEntity = schemaToSpreadEntity(s);
      const expanded = expandEntityFields(spreadEntity, ns.name, resolveRef, lookupFragment);
      const extraFields: FieldEntry[] = expanded.map((ef) => expandedFieldToEntry(ef));
      s.fields = [...s.fields, ...extraFields];
      // Keep spreads that could not be resolved: the schema card renders them
      // as a "… spreads X" indicator, which beats silently losing the reference.
      s.spreads = s.spreads.filter((name) => resolveRef(name, ns.name) === null);
    }
    // Fragments are resolved away — remove them so the viz never renders them.
    ns.fragments = [];
  }
}

/** Convert a FragmentCard to core's SpreadEntity interface for spread expansion. */
function fragmentToSpreadEntity(f: FragmentCard): SpreadEntity {
  return {
    fields: f.fields.map(fieldEntryToDecl),
    hasSpreads: f.spreads.length > 0,
    spreads: f.spreads,
  };
}

/** Convert a SchemaCard to core's SpreadEntity interface for spread expansion. */
function schemaToSpreadEntity(s: SchemaCard): SpreadEntity {
  return {
    fields: s.fields.map(fieldEntryToDecl),
    hasSpreads: s.spreads.length > 0,
    spreads: s.spreads,
  };
}

/** Convert a viz FieldEntry to core's FieldDecl for spread expansion input. */
function fieldEntryToDecl(fe: FieldEntry): FieldDecl {
  return {
    name: fe.name,
    type: fe.type,
    children: fe.children.map(fieldEntryToDecl),
  };
}

/** Convert a core ExpandedField (FieldDecl) back to a viz FieldEntry for display. */
function expandedFieldToEntry(decl: FieldDecl): FieldEntry {
  return {
    name: decl.name,
    type: decl.type,
    constraints: [],
    metadata: [],
    notes: [],
    comments: [],
    children: (decl.children ?? []).map(expandedFieldToEntry),
    location: { uri: "", line: 0, character: 0 },
  };
}

// ---------- Top-level processing ----------

function getOrCreateNamespace(
  map: Map<string, NamespaceGroup>,
  name: string,
): NamespaceGroup {
  let ns = map.get(name);
  if (!ns) {
    ns = { name, schemas: [], mappings: [], metrics: [], fragments: [] };
    map.set(name, ns);
  }
  return ns;
}

function processNamespaceChildren(
  uri: string,
  nsNode: SyntaxNode,
  group: NamespaceGroup,
  namespace: string,
  wsIndex: WorkspaceIndex,
): void {
  for (const ch of nsNode.namedChildren) {
    processTopLevelBlock(uri, ch, group, namespace, wsIndex);
  }
}

function processTopLevelBlock(
  uri: string,
  node: SyntaxNode,
  group: NamespaceGroup,
  namespace: string | null,
  wsIndex: WorkspaceIndex,
): void {
  switch (node.type) {
    case "schema_block": {
      // Metric schemas are schema_blocks decorated with (metric, ...) metadata.
      // Route them to extractMetric so they appear in the metrics panel, not schemas.
      const metaBlock = child(node, "metadata_block");
      if (isMetricSchema(metaBlock)) {
        group.metrics.push(extractMetric(uri, node, namespace));
      } else {
        group.schemas.push(extractSchema(uri, node, namespace, wsIndex));
      }
      break;
    }
    case "fragment_block":
      group.fragments.push(extractFragment(uri, node, namespace));
      break;
    case "mapping_block":
      group.mappings.push(extractMapping(uri, node, namespace, wsIndex));
      break;
  }
}

/**
 * Collect warning_comment and question_comment nodes that appear as siblings
 * of blocks — at the file root and inside namespace blocks (sl-ebs9) — and
 * attach each to the nearest preceding schema/mapping/metric/fragment of the
 * same scope. Comments inside a namespace must resolve against that
 * namespace's group, not the global one, or they vanish from the model and
 * the warnings/questions pane undercounts.
 */
function collectTopLevelComments(
  uri: string,
  root: SyntaxNode,
  globalNs: NamespaceGroup,
  namespaceMap: Map<string, NamespaceGroup>,
): void {
  collectSiblingComments(uri, root.children, globalNs);

  for (const node of root.namedChildren) {
    if (node.type !== "namespace_block") continue;
    const nsName = node.childForFieldName?.("name")?.text ?? null;
    const group = nsName ? namespaceMap.get(nsName) : undefined;
    if (group) {
      collectSiblingComments(uri, node.children, group);
    }
  }
}

/** Attach each standalone //! and //? among `siblings` to the nearest
 *  preceding block found in `group`. */
function collectSiblingComments(
  uri: string,
  siblings: SyntaxNode[],
  group: NamespaceGroup,
): void {
  for (let i = 0; i < siblings.length; i++) {
    const node = siblings[i]!;
    if (node.type !== "warning_comment" && node.type !== "question_comment") {
      continue;
    }
    const entry: CommentEntry = {
      kind: node.type === "warning_comment" ? "warning" : "question",
      text: extractCommentText(node),
      location: nodeLocation(uri, node),
    };

    // Attach to the nearest preceding schema/mapping/metric/fragment
    const target = findPrecedingBlock(siblings, i, group);
    if (target) {
      target.push(entry);
    }
  }
}

function findPrecedingBlock(
  allNodes: SyntaxNode[],
  commentIndex: number,
  group: NamespaceGroup,
): CommentEntry[] | null {
  // Walk backwards from the comment to find the preceding block
  for (let j = commentIndex - 1; j >= 0; j--) {
    const prev = allNodes[j]!;
    if (prev.type === "schema_block") {
      const name = labelText(prev);
      const schema = group.schemas.find((s) => s.id === name);
      if (schema) return schema.comments;
    }
    if (prev.type === "mapping_block") {
      const name = labelText(prev);
      const mapping = group.mappings.find((m) => m.id === name);
      if (mapping) return mapping.comments;
    }
    if (prev.type === "schema_block" && isMetricSchema(child(prev, "metadata_block"))) {
      const name = labelText(prev);
      const metric = group.metrics.find((m) => m.id === name);
      if (metric) return metric.comments;
    }
    if (prev.type === "fragment_block") {
      const name = labelText(prev);
      const frag = group.fragments.find((f) => f.id === name);
      if (frag) return frag.comments;
    }
  }
  return null;
}

/**
 * Strip the comment marker prefix and surrounding whitespace from a comment node.
 *
 * The grammar exposes three comment node types that share the same shape but
 * different lead-in markers:
 *   - `line_comment`     → `// text`   (2-char prefix)
 *   - `warning_comment`  → `//! text`  (3-char prefix)
 *   - `question_comment` → `//? text`  (3-char prefix)
 *
 * The viz model only renders the human-readable payload, so we strip the marker
 * here rather than at every call site.
 */
function extractCommentText(node: SyntaxNode): string {
  const text = node.text;
  if (text.startsWith("//!") || text.startsWith("//?")) {
    return text.slice(3).trim();
  }
  return text.slice(2).trim();
}

// ---------- Schema extraction ----------

/**
 * Build a SchemaCard from a `schema_block` CST node.
 *
 * A schema's display identity is split across two CST locations: the bare
 * `name` (used as the local id and for cross-file resolution) and an optional
 * `note "..."` tag inside its metadata block (used as the human-friendly
 * label). We compute `qualifiedId` here so downstream consumers can resolve
 * cross-namespace references without re-deriving the namespace prefix.
 *
 * `hasExternalLineage` is computed eagerly because the viz needs to render a
 * "shared" badge before the user opens the card; doing it lazily would require
 * a workspace scan on every render.
 */
function extractSchema(
  uri: string,
  node: SyntaxNode,
  namespace: string | null,
  wsIndex: WorkspaceIndex,
): SchemaCard {
  const name = labelText(node) ?? "unknown";
  const qualifiedId = namespace ? `${namespace}::${name}` : name;
  const body = child(node, "schema_body");
  const meta = child(node, "metadata_block");

  return {
    id: name,
    qualifiedId,
    kind: "schema",
    label: extractSchemaLabel(meta),
    fields: body ? extractFieldEntries(uri, body) : [],
    notes: extractNotes(uri, node),
    comments: extractComments(uri, node),
    metadata: meta ? extractMetadataEntries(meta) : [],
    location: nodeLocation(uri, node),
    hasExternalLineage: checkExternalLineage(qualifiedId, uri, wsIndex),
    spreads: body ? extractSpreads(body) : [],
  };
}

/** Extract spread names from a schema_body node using core's extractFieldTree. */
function extractSpreads(body: SyntaxNode): string[] {
  return extractFieldTree(body).spreads;
}

/**
 * Find a schema's display label by looking for a `note "..."` entry in its
 * metadata block.
 *
 * The grammar represents `note` two ways depending on context: as a dedicated
 * `note_tag` node (the canonical form) and as a generic `tag_with_value` whose
 * key is the literal `"note"` (the fallback form, used in some recovery paths
 * and for backwards compatibility). We accept both so a single piece of user
 * input renders consistently regardless of which production matched it.
 */
function extractSchemaLabel(meta: SyntaxNode | null): string | null {
  if (!meta) return null;
  for (const ch of meta.namedChildren) {
    if (ch.type === "note_tag") {
      const str = child(ch, "nl_string") ?? child(ch, "multiline_string");
      return str ? stringText(str) : null;
    }
    // Also handle tag_with_value form (e.g., note "desc")
    if (ch.type === "tag_with_value") {
      const key = ch.namedChildren[0];
      if (key?.text === "note") {
        const val = ch.namedChildren[1];
        return val ? stripQuotes(val.text) : null;
      }
    }
  }
  return null;
}

function checkExternalLineage(
  qualifiedId: string,
  currentUri: string,
  wsIndex: WorkspaceIndex,
): boolean {
  const refs = findReferences(wsIndex, qualifiedId);
  return refs.some((r) => r.uri !== currentUri);
}

// ---------- Fragment extraction ----------

/**
 * Build a FragmentCard from a `fragment_block` CST node.
 *
 * Fragments are field-only entities — they have no metadata block and no
 * mapping context, so the structure is much simpler than a schema. We still
 * extract spreads and notes because fragments may compose other fragments
 * (transitive spreads are resolved later by `expandSpreads`).
 */
function extractFragment(uri: string, node: SyntaxNode, namespace: string | null): FragmentCard {
  const localName = labelText(node) ?? "unknown";
  const id = namespace ? `${namespace}::${localName}` : localName;
  const body = child(node, "schema_body");

  return {
    id,
    fields: body ? extractFieldEntries(uri, body) : [],
    spreads: body ? extractSpreads(body) : [],
    notes: extractNotes(uri, node),
    comments: extractComments(uri, node),
    location: nodeLocation(uri, node),
  };
}

// ---------- Field extraction ----------
//
// Uses core's extractFieldTree() for the canonical field tree structure (name,
// type, children, metadata, isList), then enriches each FieldDecl with
// viz-specific data (constraints, notes, comments, location) by walking the
// CST field_decl nodes in parallel. This ensures type computation is
// consistent with core while preserving the rich per-field annotations the
// viz needs for rendering.

/**
 * Extract field entries from a schema_body node using core's extractFieldTree().
 * Enriches core's FieldDecl records with viz-specific constraint, note, and
 * comment data by walking the parallel CST nodes.
 */
function extractFieldEntries(uri: string, body: SyntaxNode): FieldEntry[] {
  const fieldTree = extractFieldTree(body);
  const fieldNodes = children(body, "field_decl");

  // Core's extractFieldTree returns fields in the same order as field_decl
  // children, so we can zip them together for enrichment.
  return fieldTree.fields.map((decl, i) => {
    const cstNode = fieldNodes[i];
    return fieldDeclToEntry(decl, uri, cstNode ?? null);
  });
}

/**
 * Convert a core FieldDecl to a viz FieldEntry, enriching with CST-derived
 * notes, comments, constraints, and location from the parallel CST node.
 */
function fieldDeclToEntry(
  decl: FieldDecl,
  uri: string,
  cstNode: SyntaxNode | null,
): FieldEntry {
  // Derive constraints from core's metadata entries
  const constraints = extractConstraintsFromMeta(decl.metadata ?? []);

  // Build the type string: core uses "record" for nested, but viz distinguishes
  // "list_of record", "list_of <type>", and plain types.
  let type = decl.type;
  if (decl.isList && decl.type === "record") type = "list_of record";
  else if (decl.isList && decl.type) type = `list_of ${decl.type}`;
  else if (decl.isList) type = "list_of";

  // Child fields: recursively zip with nested CST nodes
  const nestedBody = cstNode ? child(cstNode, "schema_body") : null;
  const nestedCstNodes = nestedBody ? children(nestedBody, "field_decl") : [];
  const fieldChildren = (decl.children ?? []).map((childDecl, j) =>
    fieldDeclToEntry(childDecl, uri, nestedCstNodes[j] ?? null),
  );

  // Location: from CST field_name node if available, else from decl row/column
  const nameNode = cstNode ? child(cstNode, "field_name") : null;
  const location = nameNode
    ? nodeLocation(uri, nameNode)
    : { uri, line: decl.startRow ?? 0, character: decl.startColumn ?? 0 };

  return {
    name: decl.name,
    type,
    constraints,
    metadata: metaEntriesToViz(decl.metadata ?? []),
    notes: cstNode ? extractNotes(uri, cstNode) : [],
    comments: cstNode ? extractComments(uri, cstNode) : [],
    children: fieldChildren,
    location,
  };
}

/**
 * Extract constraint tags from core MetaEntry[] records.
 * Constraints are bare tags (pk, required, pii, etc.) or tag_with_value
 * entries whose key is a known constraint.
 */
function extractConstraintsFromMeta(entries: MetaEntry[]): string[] {
  const constraints: string[] = [];
  for (const entry of entries) {
    if (entry.kind === "tag" && CONSTRAINT_TAGS.has(entry.tag)) {
      constraints.push(entry.tag);
    } else if (entry.kind === "kv" && CONSTRAINT_TAGS.has(entry.key)) {
      constraints.push(entry.key);
    }
  }
  return constraints;
}


// ---------- Mapping extraction ----------

/** Build a DefinitionLookup from the LSP WorkspaceIndex for NL @-ref resolution. */
function makeVizLookup(wsIndex: WorkspaceIndex): DefinitionLookup {
  return {
    hasSchema: (key) => (wsIndex.definitions.get(key)?.some((d) => d.kind === "schema") ?? false),
    getSchema: (key) => {
      const def = wsIndex.definitions.get(key)?.find((d) => d.kind === "schema");
      if (!def) return null;
      return { fields: def.fields.map((f) => ({ name: f.name, type: f.type ?? "" })), hasSpreads: false };
    },
    hasFragment: (key) => (wsIndex.definitions.get(key)?.some((d) => d.kind === "fragment") ?? false),
    getFragment: (key) => {
      const def = wsIndex.definitions.get(key)?.find((d) => d.kind === "fragment");
      if (!def) return null;
      return { fields: def.fields.map((f) => ({ name: f.name, type: f.type ?? "" })), hasSpreads: false };
    },
    hasTransform: (key) => (wsIndex.definitions.get(key)?.some((d) => d.kind === "transform") ?? false),
    getMapping: () => null,
    iterateSchemas: function* () {
      for (const [key, defs] of wsIndex.definitions) {
        const schemaDef = defs.find((d) => d.kind === "schema");
        if (schemaDef) {
          yield [key, { fields: schemaDef.fields.map((f) => ({ name: f.name, type: f.type ?? "" })), hasSpreads: false }] as [string, { fields: { name: string; type: string }[]; hasSpreads: boolean }];
        }
      }
    },
  };
}

/** Resolve NL @-refs in a transform against the workspace index. */
function resolveTransformAtRefs(
  transform: ReturnType<typeof extractTransform>,
  sources: string[],
  targets: string[],
  namespace: string | null,
  wsIndex: WorkspaceIndex,
): ResolvedAtRef[] {
  if (!transform.text) return [];
  const lookup = makeVizLookup(wsIndex);
  const ctx = { sources, targets, namespace };
  return extractAtRefs(transform.text).map((br) => {
    const resolution = resolveRef(br.ref, ctx, lookup);
    return {
      ref: br.ref,
      classification: classifyRef(br.ref),
      resolved: resolution.resolved,
      resolvedTo: resolution.resolvedTo ?? null,
    };
  });
}

/**
 * Resolve a schema reference name to its fully-qualified form by looking up
 * the workspace index. If the schema is defined within a namespace and the ref
 * is bare (no :: prefix), qualifies it with the definition's namespace.
 * Returns the original refName if no matching schema definition is found.
 */
function resolveMappingRef(
  refName: string,
  namespace: string | null,
  wsIndex: WorkspaceIndex,
): string {
  // Already fully qualified — return as-is
  if (refName.includes("::")) return refName;

  const defs = resolveDefinition(wsIndex, refName, namespace);
  const schemaDef = defs.find((d) => d.kind === "schema");
  if (!schemaDef) return refName;

  // Qualify with the definition's namespace if it has one
  return schemaDef.namespace
    ? `${schemaDef.namespace}::${refName}`
    : refName;
}

/**
 * Build a MappingBlock from a `mapping_block` CST node.
 *
 * A mapping has the richest structure of any block: source/target schemas,
 * direct arrows, computed arrows, `each` and `flatten` sub-blocks, plus
 * note blocks both inside and outside the mapping body. We collect them in
 * one pass over `mapping_body.namedChildren` so the resulting `MappingBlock`
 * preserves the user's authoring order — important for diagram layout, where
 * arrow order is meaningful to the reader.
 *
 * Two precedence rules to be aware of:
 *  1. Source and target refs are resolved against the workspace index using
 *     the enclosing namespace, so an unqualified `customers` inside a
 *     `namespace crm { ... }` block resolves to `crm::customers`.
 *  2. NL @-refs inside arrow transforms are resolved *after* sources/targets
 *     are known, because the resolver needs the mapping context (sources +
 *     targets) to disambiguate bare field names.
 *
 * Note blocks may appear inside `mapping_body` or as direct children of the
 * `mapping_block` node depending on placement; we collect from both locations
 * so the user's choice of placement does not change rendering.
 */
function extractMapping(
  uri: string,
  node: SyntaxNode,
  namespace: string | null,
  wsIndex: WorkspaceIndex,
): MappingBlock {
  const name = labelText(node) ?? "unknown";
  const body = child(node, "mapping_body");

  const sourceRefs: string[] = [];
  const arrows: ArrowEntry[] = [];
  const eachBlocks: EachBlock[] = [];
  const flattenBlocks: FlattenBlock[] = [];
  let sourceBlock: SourceBlockInfo | null = null;
  let targetRef = "";
  const notes: NoteBlock[] = [];

  if (body) {
    for (const ch of body.namedChildren) {
      switch (ch.type) {
        case "source_block":
          sourceBlock = extractSourceBlock(ch);
          if (sourceBlock.schemas.length > 0) {
            const resolvedSchemas = sourceBlock.schemas.map((ref) =>
              resolveMappingRef(ref, namespace, wsIndex)
            );
            sourceBlock = { ...sourceBlock, schemas: resolvedSchemas };
            sourceRefs.push(...resolvedSchemas);
          }
          break;
        case "target_block":
          for (const ref of children(ch, "source_ref")) {
            const refName = sourceRefText(ref);
            if (refName) targetRef = resolveMappingRef(refName, namespace, wsIndex);
          }
          break;
        case "map_arrow":
          arrows.push(extractArrow(uri, ch));
          break;
        case "computed_arrow":
          arrows.push(extractComputedArrow(uri, ch));
          break;
        case "each_block":
          eachBlocks.push(extractEachBlock(uri, ch));
          break;
        case "flatten_block":
          flattenBlocks.push(extractFlattenBlock(uri, ch));
          break;
        case "note_block":
          notes.push(extractNoteBlock(uri, ch));
          break;
      }
    }
  }

  // Also collect notes from the mapping block itself (outside mapping_body)
  for (const ch of node.namedChildren) {
    if (ch.type === "note_block") {
      notes.push(extractNoteBlock(uri, ch));
    }
  }

  // Resolve NL @-refs in arrow transforms against the workspace index.
  const targets = targetRef ? [targetRef] : [];
  for (const arrow of arrows) {
    if (arrow.transform && arrow.transform.kind === "nl") {
      const atRefs = resolveTransformAtRefs(arrow.transform, sourceRefs, targets, namespace, wsIndex);
      if (atRefs.length > 0) arrow.transform.atRefs = atRefs;
    }
  }

  // The mapping's own metadata block, e.g. `mapping m (airflow, note "...")`.
  const meta = child(node, "metadata_block");

  return {
    id: name,
    sourceRefs,
    targetRef,
    arrows,
    eachBlocks,
    flattenBlocks,
    sourceBlock,
    metadata: meta ? extractMetadataEntries(meta) : [],
    notes,
    comments: extractComments(uri, node),
    location: nodeLocation(uri, node),
  };
}

/**
 * Extract a mapping's `source { ... }` block into schema refs and an optional
 * join description.
 *
 * The grammar overloads `source_ref`: it normally wraps a schema name
 * (identifier / backtick / qualified_name), but it can also wrap a bare NL
 * string when the user is documenting a join condition (e.g.
 * `source { customers, orders, "joined on customer_id" }`). We disambiguate by
 * checking which child the source_ref actually contains: if it has only an
 * NL string and no name child, it is a join description; otherwise it is a
 * schema reference.
 */
function extractSourceBlock(node: SyntaxNode): SourceBlockInfo {
  const schemas: string[] = [];
  let joinDescription: string | null = null;
  const filters: string[] = [];

  for (const ch of node.namedChildren) {
    if (ch.type === "source_ref") {
      // An NL string inside a source_ref is a join description, not a schema name
      const nlChild = child(ch, "nl_string") ?? child(ch, "multiline_string");
      if (nlChild && !child(ch, "identifier") && !child(ch, "backtick_name") && !child(ch, "qualified_name")) {
        joinDescription = stringText(nlChild);
      } else {
        const name = sourceRefText(ch);
        if (name) schemas.push(name);
      }
    } else if (ch.type === "nl_string" || ch.type === "multiline_string") {
      joinDescription = stringText(ch);
    }
  }

  return { schemas, joinDescription, filters };
}

/**
 * Extract a direct mapping arrow (`src -> tgt`) from a `map_arrow` node.
 *
 * Direct arrows always have at least one source path, exactly one target
 * path, and an optional pipe chain (transform). The transform is left null
 * (rather than a synthetic pass-through) so renderers can distinguish between
 * an explicit identity transform and the absence of one.
 */
function extractArrow(uri: string, node: SyntaxNode): ArrowEntry {
  const srcPaths = children(node, "src_path");
  const tgtPath = child(node, "tgt_path");
  const pipeChain = child(node, "pipe_chain");
  const meta = child(node, "metadata_block");

  const sourceFields = srcPaths.map((sp) => pathText(sp));
  const targetField = tgtPath ? pathText(tgtPath) : "";

  return {
    sourceFields,
    targetField,
    transform: pipeChain ? extractTransform(pipeChain) : null,
    metadata: meta ? extractMetadataEntries(meta) : [],
    comments: extractComments(uri, node),
    location: nodeLocation(uri, node),
  };
}

/**
 * Extract a computed arrow (`-> tgt = transform`) from a `computed_arrow` node.
 *
 * Computed arrows have no source paths — the value is produced entirely by the
 * pipe chain (a literal, a constant expression, or an NL transform that
 * references @-refs). We return an `ArrowEntry` with an empty `sourceFields`
 * array so the viz can render direct and computed arrows through a single
 * code path while still distinguishing them when needed.
 */
function extractComputedArrow(uri: string, node: SyntaxNode): ArrowEntry {
  const tgtPath = child(node, "tgt_path");
  const pipeChain = child(node, "pipe_chain");
  const meta = child(node, "metadata_block");

  return {
    sourceFields: [],
    targetField: tgtPath ? pathText(tgtPath) : "",
    transform: pipeChain ? extractTransform(pipeChain) : null,
    metadata: meta ? extractMetadataEntries(meta) : [],
    comments: extractComments(uri, node),
    location: nodeLocation(uri, node),
  };
}

/**
 * Extract transform info from a pipe_chain node.
 *
 * After Feature 28 all pipe steps are NL — bare tokens, quoted strings, and
 * spreads are all human/LLM-interpreted text. The only special case is a
 * standalone map literal, which gets kind "map" for distinct rendering.
 */
function extractTransform(pipeChain: SyntaxNode): TransformInfo {
  const pipeSteps = children(pipeChain, "pipe_step");

  // Detect standalone map literal — the only non-NL transform kind
  const hasMap = pipeSteps.some((step) => child(step, "map_literal") !== null);

  // Collect step texts (all content is NL, including bare tokens)
  const steps: string[] = [];
  for (const step of pipeSteps) {
    const pipeText = child(step, "pipe_text");
    if (pipeText) {
      steps.push(pipeText.text);
    }
  }

  const kind: TransformInfo["kind"] = hasMap ? "map" : "nl";

  return {
    kind,
    text: pipeChain.text,
    steps,
  };
}

/**
 * Extract an `each` sub-block — a per-list-element mapping nested inside a
 * parent mapping.
 *
 * `each` may itself contain further `each` blocks (e.g. mapping a list of
 * orders, each containing a list of line items), so we recurse to build a
 * nested structure rather than flattening. Computed arrows are valid inside
 * `each` and are collected alongside direct arrows.
 */
function extractEachBlock(uri: string, node: SyntaxNode): EachBlock {
  const srcPath = child(node, "src_path");
  const tgtPath = child(node, "tgt_path");
  const arrows: ArrowEntry[] = [];
  const nestedEach: EachBlock[] = [];

  for (const ch of node.namedChildren) {
    if (ch.type === "map_arrow") {
      arrows.push(extractArrow(uri, ch));
    } else if (ch.type === "computed_arrow") {
      arrows.push(extractComputedArrow(uri, ch));
    } else if (ch.type === "each_block") {
      nestedEach.push(extractEachBlock(uri, ch));
    }
  }

  return {
    sourceField: srcPath ? pathText(srcPath) : "",
    targetField: tgtPath ? pathText(tgtPath) : "",
    arrows,
    nestedEach,
    location: nodeLocation(uri, node),
  };
}

/**
 * Extract a `flatten` sub-block — collapses a list source into a flat target
 * by mapping each element's fields directly without an enclosing record.
 *
 * Unlike `each`, flatten does not nest: it has a single source path and a set
 * of arrows that target fields on the parent mapping's target. We do not
 * recurse into nested `flatten` blocks because the grammar does not permit
 * them.
 */
function extractFlattenBlock(uri: string, node: SyntaxNode): FlattenBlock {
  const srcPath = child(node, "src_path");
  const arrows: ArrowEntry[] = [];

  for (const ch of node.namedChildren) {
    if (ch.type === "map_arrow") {
      arrows.push(extractArrow(uri, ch));
    } else if (ch.type === "computed_arrow") {
      arrows.push(extractComputedArrow(uri, ch));
    }
  }

  return {
    sourceField: srcPath ? pathText(srcPath) : "",
    arrows,
    location: nodeLocation(uri, node),
  };
}

// ---------- Metric extraction ----------

/**
 * Build a MetricCard from a `schema_block` decorated with the `metric` tag.
 *
 * In v2 a metric is *not* a separate top-level production: it is a normal
 * `schema_block` whose metadata block carries `metric` plus a set of metric
 * keys (`source`, `grain`, `slice`, `filter`, `metric_name`). The label is
 * carried by `metric_name "..."` rather than the schema-level `note "..."`,
 * so we look for that tag specifically rather than reusing
 * `extractSchemaLabel`. The fields use a different shape too — each field can
 * carry a `measure` annotation (additive / non_additive / semi_additive) —
 * which is why metric fields go through `extractMetricFields` instead of the
 * normal `extractFieldEntries` path.
 */
function extractMetric(
  uri: string,
  node: SyntaxNode,
  namespace: string | null,
): MetricCard {
  const name = labelText(node) ?? "unknown";
  const qualifiedId = namespace ? `${namespace}::${name}` : name;
  const meta = child(node, "metadata_block");
  const body = child(node, "schema_body");

  // Extract the display label from the metric_name tag inside the metadata_block.
  // In v2, metrics are schema blocks — the old positional nl_string is gone;
  // the display name is now carried by the metric_name tag_with_value entry.
  let label: string | null = null;
  if (meta) {
    for (const ch of meta.namedChildren) {
      if (
        ch.type === "tag_with_value" &&
        ch.namedChildren[0]?.text === "metric_name"
      ) {
        const val = ch.namedChildren[1];
        const strNode = val?.namedChildren.find(
          (c) => c.type === "nl_string" || c.type === "multiline_string",
        );
        if (strNode) label = stringText(strNode);
        break;
      }
    }
  }

  const source: string[] = [];
  let grain: string | null = null;
  const slices: string[] = [];
  let filter: string | null = null;

  if (meta) {
    extractMetricMetadata(meta, source, slices, (g) => (grain = g), (f) => (filter = f));
  }

  return {
    id: name,
    qualifiedId,
    label,
    source,
    grain,
    slices,
    filter,
    fields: body ? extractMetricFields(uri, body) : [],
    notes: extractNotes(uri, node),
    comments: extractComments(uri, node),
    location: nodeLocation(uri, node),
  };
}

/**
 * Pull metric-specific tags out of a metadata block into separate buckets.
 *
 * `source` and `slices` use the array form because both can be braced lists
 * (`source { customers, orders }`, `slice { region, segment }`). `grain` and
 * `filter` are scalar so they are passed back through setter callbacks rather
 * than out-params on the same array — keeping the call sites readable.
 *
 * The `value_text` wrapper handles braced/multi-value forms; for single-value
 * tags the value is a plain identifier or string and we read its text
 * directly. We deliberately do not validate the tag values here — semantic
 * validation lives in `satsuma-core` and runs against the index, not the CST.
 */
function extractMetricMetadata(
  meta: SyntaxNode,
  source: string[],
  slices: string[],
  setGrain: (g: string) => void,
  setFilter: (f: string) => void,
): void {
  for (const ch of meta.namedChildren) {
    if (ch.type === "tag_with_value") {
      const key = ch.namedChildren[0];
      const val = ch.namedChildren[1];
      if (!key || !val) continue;
      switch (key.text) {
        case "source":
          // value_text may contain multiple identifiers for braced source lists
          if (val.type === "value_text") {
            for (const item of val.namedChildren) {
              if (item.type === "identifier" || item.type === "qualified_name") {
                source.push(item.text);
              }
            }
          } else {
            source.push(val.text);
          }
          break;
        case "grain":
          if (val.type === "value_text") {
            const id = val.namedChildren[0];
            if (id) setGrain(id.text);
          } else {
            setGrain(val.text);
          }
          break;
        case "filter":
          setFilter(stripQuotes(val.text));
          break;
      }
    }
    // slice_body is a separate node type for slice { ... }
    if (ch.type === "slice_body") {
      for (const item of ch.namedChildren) {
        if (item.type === "identifier") {
          slices.push(item.text);
        }
      }
    }
  }
}

/**
 * Extract metric fields with their `measure` annotations.
 *
 * Metric fields use a flat shape (no nested children) because measures only
 * apply to leaf-level numeric fields. We do not delegate to
 * `extractFieldEntries` because that path enriches with constraints, comments,
 * and recursion — none of which are relevant or rendered for metric fields.
 */
function extractMetricFields(uri: string, body: SyntaxNode): MetricFieldEntry[] {
  const fields: MetricFieldEntry[] = [];
  for (const fieldNode of children(body, "field_decl")) {
    const nameNode = child(fieldNode, "field_name");
    if (!nameNode) continue;
    const name = fieldNameText(nameNode);
    if (!name) continue;

    const typeExpr = child(fieldNode, "type_expr");
    const meta = child(fieldNode, "metadata_block");

    let measure: MetricFieldEntry["measure"] = null;
    if (meta) {
      measure = extractMeasure(meta);
    }

    fields.push({
      name,
      type: typeExpr?.text ?? "",
      measure,
      notes: extractNotes(uri, fieldNode),
      location: nodeLocation(uri, nameNode),
    });
  }
  return fields;
}

/**
 * Determine the measure kind for a metric field from its metadata block.
 *
 * The measure tag has three valid forms with different defaults:
 *  - bare `measure`              → defaults to `"additive"`
 *  - `measure: additive`         → explicit, same as bare
 *  - `measure: non_additive`     → counts/distinct (cannot be summed across slices)
 *  - `measure: semi_additive`    → balances/snapshots (summable across some dims)
 *
 * Any other value falls back to `"additive"` rather than `null` so the field
 * is still treated as a measure; `null` is reserved for fields that have no
 * `measure` tag at all (i.e. dimension fields).
 */
function extractMeasure(
  meta: SyntaxNode,
): MetricFieldEntry["measure"] {
  for (const ch of meta.namedChildren) {
    // Bare "measure" tag appears as tag_token in the CST
    if (ch.type === "tag_token") {
      const text = ch.namedChildren[0]?.text ?? ch.text;
      if (text === "measure") return "additive";
    }
    if (ch.type === "tag_with_value") {
      const key = ch.namedChildren[0];
      if (key?.text === "measure") {
        const val = ch.namedChildren[1];
        if (val) {
          // value_text wraps the actual value identifier
          const valueText = val.type === "value_text"
            ? (val.namedChildren[0]?.text ?? val.text)
            : val.text;
          if (valueText === "additive" || valueText === "non_additive" || valueText === "semi_additive") {
            return valueText;
          }
        }
        return "additive";
      }
    }
  }
  return null;
}

// ---------- Notes & comments extraction ----------

/**
 * Extract a `note "..."` block. The string child may be either `nl_string`
 * (single-line) or `multiline_string` (triple-quoted); we record which one
 * was used so renderers can preserve formatting (multi-line notes are shown
 * with line breaks; single-line notes are wrapped to fit the card width).
 */
function extractNoteBlock(uri: string, node: SyntaxNode): NoteBlock {
  let text = "";
  let isMultiline = false;
  for (const ch of node.namedChildren) {
    if (ch.type === "multiline_string") {
      text = stringText(ch) ?? "";
      isMultiline = true;
    } else if (ch.type === "nl_string") {
      text = stringText(ch) ?? "";
    }
  }
  return { text, isMultiline, location: nodeLocation(uri, node) };
}

/**
 * Collect every note attached to a CST node, regardless of where the user
 * placed it.
 *
 * Notes can appear in two distinct CST locations and we treat them as a
 * single conceptual list:
 *  1. As `note_block` children inside the entity body — the canonical form,
 *     used for free-standing prose attached to a schema/mapping/metric.
 *  2. As `note_tag` entries inside the entity's `metadata_block` — the
 *     compact inline form (`{ note: "short label" }`).
 *
 * Both forms produce identical `NoteBlock` records so the renderer does not
 * need to know which one the user wrote.
 */
function extractNotes(uri: string, node: SyntaxNode): NoteBlock[] {
  const notes: NoteBlock[] = [];
  for (const ch of node.namedChildren) {
    if (ch.type === "note_block") {
      notes.push(extractNoteBlock(uri, ch));
    }
  }
  // Also check metadata_block for note_tag nodes
  const meta = child(node, "metadata_block");
  if (meta) {
    for (const ch of meta.namedChildren) {
      if (ch.type === "note_tag") {
        const str = child(ch, "nl_string") ?? child(ch, "multiline_string");
        if (str) {
          notes.push({
            text: stringText(str) ?? "",
            isMultiline: str.type === "multiline_string",
            location: nodeLocation(uri, ch),
          });
        }
      }
    }
  }
  return notes;
}

/**
 * Extract //! and //? comments. In the CST these appear as warning_comment
 * and question_comment nodes — either as children or siblings of the node.
 */
function extractComments(uri: string, node: SyntaxNode): CommentEntry[] {
  const comments: CommentEntry[] = [];

  // Check children (all children, not just named) for comment nodes
  for (const ch of node.children) {
    if (ch.type === "warning_comment") {
      comments.push({
        kind: "warning",
        text: extractCommentText(ch),
        location: nodeLocation(uri, ch),
      });
    } else if (ch.type === "question_comment") {
      comments.push({
        kind: "question",
        text: extractCommentText(ch),
        location: nodeLocation(uri, ch),
      });
    }
  }

  // Also check siblings: warning/question comments after this node on the same line
  // or immediately following as separate sibling nodes
  const parent = node.parent;
  if (parent) {
    const siblings = parent.children;
    const nodeIndex = siblings.indexOf(node);
    if (nodeIndex >= 0) {
      for (let i = nodeIndex + 1; i < siblings.length; i++) {
        const sib = siblings[i]!;
        if (sib.type === "warning_comment" && sib.startPosition.row === node.endPosition.row) {
          comments.push({
            kind: "warning",
            text: extractCommentText(sib),
            location: nodeLocation(uri, sib),
          });
        } else if (sib.type === "question_comment" && sib.startPosition.row === node.endPosition.row) {
          comments.push({
            kind: "question",
            text: extractCommentText(sib),
            location: nodeLocation(uri, sib),
          });
        } else {
          break;
        }
      }
    }
  }

  return comments;
}

// ---------- Metadata extraction ----------
//
// Delegates to core's extractMetadata() for CST parsing, then maps the
// rich MetaEntry discriminated union to the viz model's flat {key, value}
// MetadataEntry shape.

/**
 * Map core's MetaEntry[] to the viz model's flat MetadataEntry[] shape.
 *
 * Mapping rules:
 * - tag  → {key: tagName, value: ""}
 * - kv   → {key: keyName, value: valueText}
 * - note → {key: "note", value: noteText}
 * - enum → {key: "enum", value: "val1 | val2 | ..."} (joined for display)
 * - slice → skipped (handled separately by metric metadata extraction)
 */
function metaEntriesToViz(entries: MetaEntry[]): MetadataEntry[] {
  const result: MetadataEntry[] = [];
  for (const entry of entries) {
    switch (entry.kind) {
      case "tag":
        result.push({ key: entry.tag, value: "" });
        break;
      case "kv":
        result.push({ key: entry.key, value: entry.value });
        break;
      case "note":
        result.push({ key: "note", value: entry.text });
        break;
      case "enum":
        result.push({ key: "enum", value: entry.values.join(" | ") });
        break;
      case "slice":
        // Slices are handled separately by extractMetricMetadata
        break;
    }
  }
  return result;
}

/** Extract metadata from a metadata_block CST node as viz MetadataEntry[]. */
function extractMetadataEntries(meta: SyntaxNode): MetadataEntry[] {
  return metaEntriesToViz(extractMetadata(meta));
}

// ---------- Text helpers ----------
//
// Standard text extraction is delegated to @satsuma/core cst-utils.
// Only nodeLocation() and pathText() remain here as viz-specific helpers.

/** Extract text from a source_ref node. Delegates to core sourceRefText. */
function sourceRefText(ref: SyntaxNode): string | null {
  return coreSourceRefText(ref);
}

/** Extract field name text. Delegates to core fieldNameText. */
function fieldNameText(nameNode: SyntaxNode): string | null {
  return coreFieldNameText(nameNode);
}

/**
 * Extract path text from a src_path or tgt_path node, stripping backtick
 * delimiters. This is viz-specific because it handles the raw path node
 * directly (not a source_ref or field_name node).
 */
function pathText(node: SyntaxNode): string {
  const text = node.text;
  if (text.startsWith("`") && text.endsWith("`")) {
    return text.slice(1, -1);
  }
  return text;
}

/**
 * Strip surrounding quote delimiters from a text value.
 * Delegates to core stringText for nl_string nodes; for plain text values
 * (e.g. from value_text nodes), strips quotes manually.
 */
function stripQuotes(text: string): string {
  if ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

/**
 * Convert a CST node's start position to a SourceLocation for the viz model.
 * This is the only helper that cannot move to core — it creates a SourceLocation
 * (a viz-model type) that combines a file URI with a line/character position.
 */
function nodeLocation(uri: string, node: SyntaxNode): SourceLocation {
  return {
    uri,
    line: node.startPosition.row,
    character: node.startPosition.column,
  };
}

// ---------- Multi-file merge (full transitive lineage) ----------

/**
 * Merge multiple per-file VizModels into a single model that represents the
 * full transitive lineage reachable from `primaryUri`.
 *
 * The primary file's entities appear first and win any dedup ties. Schemas are
 * deduped by `qualifiedId`, mappings by `id` + source URI, metrics by
 * `qualifiedId`, and fragments by `id`. This means stub schemas injected by
 * `injectImportedSchemaStubs` are naturally superseded when the upstream file's
 * full definition is present.
 *
 * @param primaryUri - The file URI that anchors the lineage view.
 * @param models     - One VizModel per import-reachable file (including the primary).
 */
export function mergeVizModels(
  primaryUri: string,
  models: VizModel[],
): VizModel {
  if (models.length === 0) {
    return { uri: primaryUri, fileNotes: [], namespaces: [] };
  }
  if (models.length === 1) return models[0]!;

  // Put primary model first so its entities take precedence in dedup.
  const sorted = [...models].sort((a, b) =>
    a.uri === primaryUri ? -1 : b.uri === primaryUri ? 1 : 0,
  );

  // Global dedup sets — track what has already been included.
  const seenSchemas = new Set<string>();
  const seenMappings = new Set<string>();
  const seenMetrics = new Set<string>();
  const seenFragments = new Set<string>();

  /** Dedup key for a mapping: id + source URI (same name in different files = different mappings). */
  const mappingKey = (m: MappingBlock): string =>
    `${m.id}@${m.location.uri}`;

  // Accumulate merged namespace groups keyed by namespace name (null = global).
  const nsMap = new Map<string | null, NamespaceGroup>();

  function getOrCreate(nsName: string | null): NamespaceGroup {
    let ns = nsMap.get(nsName);
    if (!ns) {
      ns = { name: nsName, schemas: [], mappings: [], metrics: [], fragments: [] };
      nsMap.set(nsName, ns);
    }
    return ns;
  }

  for (const model of sorted) {
    for (const ns of model.namespaces) {
      const target = getOrCreate(ns.name);

      for (const s of ns.schemas) {
        if (!seenSchemas.has(s.qualifiedId)) {
          seenSchemas.add(s.qualifiedId);
          target.schemas.push(s);
        }
      }
      for (const m of ns.mappings) {
        const key = mappingKey(m);
        if (!seenMappings.has(key)) {
          seenMappings.add(key);
          target.mappings.push(m);
        }
      }
      for (const mt of ns.metrics) {
        if (!seenMetrics.has(mt.qualifiedId)) {
          seenMetrics.add(mt.qualifiedId);
          target.metrics.push(mt);
        }
      }
      for (const f of ns.fragments) {
        if (!seenFragments.has(f.id)) {
          seenFragments.add(f.id);
          target.fragments.push(f);
        }
      }
    }
  }

  // Only include the primary file's notes — upstream file notes would be noise.
  const primary = sorted[0]!;
  const fileNotes = primary.uri === primaryUri ? primary.fileNotes : [];

  // Build ordered namespace list: global first (if present), then named.
  const namespaces: NamespaceGroup[] = [];
  const globalNs = nsMap.get(null);
  if (globalNs && (globalNs.schemas.length > 0 || globalNs.mappings.length > 0 ||
      globalNs.metrics.length > 0 || globalNs.fragments.length > 0)) {
    namespaces.push(globalNs);
  }
  for (const [name, ns] of nsMap) {
    if (name !== null && (ns.schemas.length > 0 || ns.mappings.length > 0 ||
        ns.metrics.length > 0 || ns.fragments.length > 0)) {
      namespaces.push(ns);
    }
  }

  return { uri: primaryUri, fileNotes, namespaces };
}

// Test-only re-exports of the per-builder helpers. Not part of the public
// API; the leading underscore signals "do not import from production code".
// Exists so test/viz-model-builders.test.js can exercise each builder
// against a parsed CST node in isolation.
export const _testInternals = {
  extractSchema,
  extractFragment,
  extractMapping,
  extractMetric,
  extractMetricMetadata,
  extractMetricFields,
  extractMeasure,
  extractFieldEntries,
  extractSpreads,
  extractSchemaLabel,
  extractSourceBlock,
  extractArrow,
  extractComputedArrow,
  extractTransform,
  extractEachBlock,
  extractFlattenBlock,
  extractNoteBlock,
  extractNotes,
  extractComments,
  extractCommentText,
  extractMetadataEntries,
};
