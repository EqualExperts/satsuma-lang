/**
 * workspace-index.ts — shared workspace index for visualization consumers.
 *
 * Builds and maintains a per-file index of definitions, references, and imports
 * over parsed Satsuma trees. The LSP uses this index for editor features, and
 * the viz backend uses the same structure to assemble import-scoped VizModels.
 *
 * Entity extraction (fields, types) delegates to @satsuma/core functions.
 * Cross-file reference indexing lives here rather than in @satsuma/core because
 * it depends on workspace context that multiple higher-level consumers share.
 *
 * Runtime portability: this module has **zero Node built-in imports** (no
 * `path`/`url`/`fs`). Import-path resolution and the LSP import-suggestion both
 * operate purely on `file://` URI strings via the WHATWG `URL` constructor,
 * which exists identically in Node and the browser. That is what lets the same
 * index power the CLI/LSP/server (file-based) and the in-browser playground
 * (localStorage-backed virtual `file:///` URIs) from one code path. See the
 * "Import resolution" section below and ADR-on-isomorphic-resolver (feature 33).
 */

// Range is a runtime value (Range.create) from vscode-languageserver-types, the
// zero-dependency types package — not the top-level vscode-languageserver, which
// would drag Node-only JSON-RPC server code into the browser bundle (feature 33).
import {
  Range,
} from "vscode-languageserver-types";
import type { SyntaxNode, Tree } from "./parser-utils";
import { nodeRange, child, children, labelText, walkDescendants } from "./parser-utils";
import {
  sourceRefStructuralText as coreSourceRefStructuralText,
  qualifiedNameText as coreQualifiedNameText,
  entryText,
  extractFieldTree,
  isMetricSchema,
  createAtRefRegex,
} from "@satsuma/core";
import type { FieldDecl } from "@satsuma/core";

// ---------- Data structures ----------

export interface FieldInfo {
  /** Field name as authored in the schema or fragment. */
  name: string;
  /** Rendered type text, or null for typeless declarations. */
  type: string | null;
  /** Source span of the field declaration. */
  range: Range;
  /** Nested child fields for record/list_of record structures. */
  children: FieldInfo[];
}

export interface DefinitionEntry {
  /** File URI where the definition is declared. */
  uri: string;
  /** Full block range. */
  range: Range;
  /** Range of the block label used for definition navigation. */
  selectionRange: Range;
  /** Block kind as used by higher-level consumers. */
  kind: "schema" | "fragment" | "transform" | "mapping" | "metric" | "namespace";
  /** Containing namespace, or null for global scope. */
  namespace: string | null;
  /** Declared fields for schema/fragment definitions. */
  fields: FieldInfo[];
}

export interface ReferenceEntry {
  /** File URI where the reference appears. */
  uri: string;
  /** Source span of the reference. */
  range: Range;
  /** Canonical referenced name, qualified when authored that way. */
  name: string;
  /** Semantic usage context for downstream queries. */
  context: "source" | "target" | "spread" | "import" | "arrow" | "metric_source";
}

export interface ImportEntry {
  /** Imported names from the declaration. */
  names: string[];
  /** Reserved for consumers that want to cache explicit resolution. */
  resolvedUri: string | null;
  /** Source span of the import path string. */
  pathRange: Range;
  /** Raw import path text without delimiters. */
  pathText: string;
}

export interface WorkspaceIndex {
  /** name → definition entries. Keys are qualified ("ns::name") or bare. */
  definitions: Map<string, DefinitionEntry[]>;
  /** name → reference entries across the workspace. */
  references: Map<string, ReferenceEntry[]>;
  /** file URI → import entries. */
  imports: Map<string, ImportEntry[]>;
  /** Set of indexed file URIs. */
  indexedFiles: Set<string>;
}

// ---------- Index lifecycle ----------

export function createWorkspaceIndex(): WorkspaceIndex {
  return {
    definitions: new Map(),
    references: new Map(),
    imports: new Map(),
    indexedFiles: new Set(),
  };
}

/**
 * Return the set of file URIs transitively reachable from `entryUri` via
 * import declarations indexed in `index`. Always includes `entryUri` itself.
 *
 * Import path strings are resolved relative to the importing file's directory.
 * Files not present in `index.indexedFiles` are silently skipped.
 */
export function getImportReachableUris(
  entryUri: string,
  index: WorkspaceIndex,
): Set<string> {
  const visited = new Set<string>();
  const queue = [entryUri];

  while (queue.length > 0) {
    const uri = queue.pop()!;
    if (visited.has(uri)) continue;
    visited.add(uri);

    const imports = index.imports.get(uri);
    if (!imports) continue;

    for (const imp of imports) {
      if (!imp.pathText) continue;
      const resolved = resolveImportUri(uri, imp.pathText);
      if (resolved && index.indexedFiles.has(resolved) && !visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return visited;
}

/**
 * Create a new WorkspaceIndex containing only entries whose file URI is in
 * `reachableUris`. The original index is unchanged. Use this to scope
 * resolution (completions, go-to-def, etc.) to the import graph of one file.
 */
export function createScopedIndex(
  index: WorkspaceIndex,
  reachableUris: Set<string>,
): WorkspaceIndex {
  const scoped = createWorkspaceIndex();

  for (const uri of index.indexedFiles) {
    if (reachableUris.has(uri)) scoped.indexedFiles.add(uri);
  }

  for (const [uri, entries] of index.imports) {
    if (reachableUris.has(uri)) scoped.imports.set(uri, entries);
  }

  for (const [name, entries] of index.definitions) {
    const filtered = entries.filter((e) => reachableUris.has(e.uri));
    if (filtered.length > 0) scoped.definitions.set(name, filtered);
  }

  for (const [name, entries] of index.references) {
    const filtered = entries.filter((e) => reachableUris.has(e.uri));
    if (filtered.length > 0) scoped.references.set(name, filtered);
  }

  return scoped;
}

// ---------- Import resolution (isomorphic: Node and browser) ----------
//
// Import paths are resolved against the importing file's URI using the WHATWG
// `URL` constructor. `new URL(pathText, importerUri)` reproduces the previous
// `fileURLToPath → dirname → resolve → pathToFileURL` round-trip byte-for-byte
// for `file://` URIs (relative, `./`, `../`, absolute, and bare-name cases),
// while working natively in the browser where Node's `path`/`url` do not exist.
// The browser playground indexes documents under virtual `file:///` URIs so
// `index.indexedFiles.has(resolved)` matches across runtimes (feature 33 §1a).

/**
 * Build the suggested import statement for a name defined in `defUri`,
 * as seen from `currentUri`. Used by the LSP "add missing import" quick-fix.
 *
 * Computes the relative path between the two `file://` URIs with a pure
 * pathname diff (no Node `path.relative`), keeping this module browser-safe.
 * Falls back to a placeholder path when either URI is unparseable.
 */
export function buildImportSuggestion(
  currentUri: string,
  name: string,
  defUri: string,
): string {
  const rel = relativeUriPath(currentUri, defUri);
  if (rel === null) return `import { ${name} } from "..."`;
  // Import paths must be explicitly relative; bare paths read as bare-name imports.
  const relPath = rel.startsWith(".") ? rel : `./${rel}`;
  return `import { ${name} } from "${relPath}"`;
}

/** Resolve an import path relative to the importing file URI. Returns null on failure. */
function resolveImportUri(importerUri: string, pathText: string): string | null {
  try {
    return new URL(pathText, importerUri).toString();
  } catch {
    return null;
  }
}

/**
 * Relative path from the directory of `fromUri` to `toUri`, both `file://`
 * URIs — a pure replacement for `path.relative(dirname(from), to)`.
 *
 * Operates on the decoded URI pathnames (so percent-encoded characters become
 * real path characters, matching `fileURLToPath`'s output) and follows POSIX
 * `path.relative` semantics: walk up out of the source directory with `..`
 * segments, then descend into the target. Returns null if either URI cannot be
 * parsed. Browser-safe — no Node `path`/`url`.
 */
function relativeUriPath(fromUri: string, toUri: string): string | null {
  let from: URL;
  let to: URL;
  try {
    from = new URL(fromUri);
    to = new URL(toUri);
  } catch {
    return null;
  }

  // Decode to real path text and split into non-empty segments. Dropping the
  // last segment of `from` yields its containing directory (dirname).
  const fromSegments = decodeURIComponent(from.pathname).split("/").filter(Boolean);
  fromSegments.pop();
  const toSegments = decodeURIComponent(to.pathname).split("/").filter(Boolean);

  // Skip the shared leading segments, then go up for what remains of the source
  // directory and down into what remains of the target.
  let shared = 0;
  while (
    shared < fromSegments.length &&
    shared < toSegments.length &&
    fromSegments[shared] === toSegments[shared]
  ) {
    shared++;
  }

  const up = fromSegments.slice(shared).map(() => "..");
  const down = toSegments.slice(shared);
  return [...up, ...down].join("/");
}

/** Index (or re-index) a single file. Replaces any existing entries for the URI. */
export function indexFile(index: WorkspaceIndex, uri: string, tree: Tree): void {
  // Remove old entries for this file first
  removeFile(index, uri);

  index.indexedFiles.add(uri);

  // Extract from top-level nodes
  const root = tree.rootNode;
  for (const node of root.namedChildren) {
    indexTopLevel(index, uri, node, null);
  }
}

/** Remove all entries for a file URI from the index. */
export function removeFile(index: WorkspaceIndex, uri: string): void {
  index.indexedFiles.delete(uri);
  index.imports.delete(uri);

  // Remove definitions belonging to this URI
  for (const [key, entries] of index.definitions) {
    const remaining = entries.filter((e) => e.uri !== uri);
    if (remaining.length === 0) {
      index.definitions.delete(key);
    } else {
      index.definitions.set(key, remaining);
    }
  }

  // Remove references belonging to this URI
  for (const [key, entries] of index.references) {
    const remaining = entries.filter((e) => e.uri !== uri);
    if (remaining.length === 0) {
      index.references.delete(key);
    } else {
      index.references.set(key, remaining);
    }
  }
}

// ---------- Queries ----------

/** Resolve a name to its definitions, considering namespace context. */
export function resolveDefinition(
  index: WorkspaceIndex,
  name: string,
  currentNamespace: string | null,
): DefinitionEntry[] {
  // 1. If the name is already qualified (contains ::), look up directly
  if (name.includes("::")) {
    return index.definitions.get(name) ?? [];
  }

  // 2. Try namespace-qualified first
  if (currentNamespace) {
    const qualified = `${currentNamespace}::${name}`;
    const scoped = index.definitions.get(qualified);
    if (scoped && scoped.length > 0) return scoped;
  }

  // 3. Fall back to global
  return index.definitions.get(name) ?? [];
}

/** Find all references to a name. */
export function findReferences(
  index: WorkspaceIndex,
  name: string,
): ReferenceEntry[] {
  const results: ReferenceEntry[] = [];

  // Direct match
  const direct = index.references.get(name);
  if (direct) results.push(...direct);

  // If the name is qualified (ns::foo), also check for bare references
  // that could resolve to this qualified name
  if (name.includes("::")) {
    const bare = name.split("::").pop()!;
    const bareRefs = index.references.get(bare);
    if (bareRefs) {
      // Only include bare refs that are in files where the namespace context matches
      // For simplicity, include all bare refs — the caller can filter by context
      results.push(...bareRefs);
    }
  }

  // If the name is bare, also check for qualified forms
  if (!name.includes("::")) {
    for (const [key, entries] of index.references) {
      if (key.endsWith(`::${name}`) && key !== name) {
        results.push(...entries);
      }
    }
  }

  return results;
}

/** Get all block names, optionally filtered by kind. */
export function allBlockNames(
  index: WorkspaceIndex,
  kind?: DefinitionEntry["kind"],
): Array<{ name: string; entry: DefinitionEntry }> {
  const results: Array<{ name: string; entry: DefinitionEntry }> = [];
  for (const [name, entries] of index.definitions) {
    for (const entry of entries) {
      if (!kind || entry.kind === kind) {
        results.push({ name, entry });
      }
    }
  }
  return results;
}

/** Get fields for a schema or fragment by name, considering namespace. */
export function getFields(
  index: WorkspaceIndex,
  name: string,
  currentNamespace: string | null,
): FieldInfo[] {
  const defs = resolveDefinition(index, name, currentNamespace);
  for (const def of defs) {
    if (def.fields.length > 0) return def.fields;
  }
  return [];
}

/** Count unique references to a name, optionally filtered by context. */
export function countReferences(
  index: WorkspaceIndex,
  name: string,
  contextFilter?: ReferenceEntry["context"][],
): number {
  const refs = index.references.get(name) ?? [];
  if (!contextFilter) return refs.length;
  return refs.filter((r) => contextFilter.includes(r.context)).length;
}

/** Find distinct mapping names that reference a given schema as source or target. */
export function findMappingsUsing(
  index: WorkspaceIndex,
  schemaName: string,
): string[] {
  const refs = findReferences(index, schemaName);
  const mappingRefs = refs.filter(
    (r) => r.context === "source" || r.context === "target",
  );
  // Deduplicate by URI + parent mapping (approximate: use URI since each mapping body is in one file)
  const seen = new Set<string>();
  for (const ref of mappingRefs) {
    seen.add(`${ref.uri}:${ref.range.start.line}`);
  }
  return [...seen];
}

// ---------- Extraction (per file) ----------

// In v2, metrics are schema_block nodes with (metric, ...) metadata.
// The schema_block entry defaults to "schema"; indexTopLevel upgrades it to
// "metric" for nodes that pass isMetricSchema().
const BLOCK_KINDS: Record<string, DefinitionEntry["kind"]> = {
  schema_block: "schema",
  fragment_block: "fragment",
  transform_block: "transform",
  mapping_block: "mapping",
  namespace_block: "namespace",
};

function indexTopLevel(
  index: WorkspaceIndex,
  uri: string,
  node: SyntaxNode,
  namespace: string | null,
): void {
  const kind = BLOCK_KINDS[node.type];

  if (node.type === "namespace_block") {
    const namespaceNameNode = node.childForFieldName?.("name") ?? null;
    const nsName = namespaceNameNode?.text ?? null;
    if (nsName && namespaceNameNode) {
      // Register the namespace itself as a definition
      addDefinition(index, nsName, {
        uri,
        range: nodeRange(node),
        selectionRange: nodeRange(namespaceNameNode),
        kind: "namespace",
        namespace: null,
        fields: [],
      });

      // Index children within the namespace
      for (const ch of node.namedChildren) {
        if (BLOCK_KINDS[ch.type]) {
          indexTopLevel(index, uri, ch, nsName);
        }
      }
    }
    return;
  }

  if (node.type === "import_decl") {
    indexImport(index, uri, node);
    return;
  }

  if (!kind) return;

  // Metric schemas are schema_block nodes decorated with (metric, ...) metadata.
  // Upgrade the kind from "schema" to "metric" so the index correctly classifies them.
  const effectiveKind: DefinitionEntry["kind"] =
    kind === "schema" && isMetricSchema(child(node, "metadata_block"))
      ? "metric"
      : kind;

  const name = labelText(node);
  if (!name) return;

  const qualifiedName = namespace ? `${namespace}::${name}` : name;
  const lblNode = child(node, "block_label");
  const selectionRange = lblNode ? nodeRange(lblNode) : nodeRange(node);

  // Extract fields for schema/fragment blocks (metric schemas also have schema_body)
  const fields = (effectiveKind === "schema" || effectiveKind === "metric" || effectiveKind === "fragment")
    ? extractFields(child(node, "schema_body"))
    : [];

  addDefinition(index, qualifiedName, {
    uri,
    range: nodeRange(node),
    selectionRange,
    kind: effectiveKind,
    namespace,
    fields,
  });

  // Extract references from mapping bodies
  if (effectiveKind === "mapping") {
    indexMappingRefs(index, uri, node, namespace);
  }

  // Extract metric source references
  if (effectiveKind === "metric") {
    indexMetricRefs(index, uri, node, namespace);
  }

  // Extract fragment spread references from schema/fragment bodies
  if (effectiveKind === "schema" || effectiveKind === "fragment") {
    const body = child(node, "schema_body");
    if (body) {
      indexSpreadRefs(index, uri, body);
    }
  }
}

function indexImport(index: WorkspaceIndex, uri: string, node: SyntaxNode): void {
  const importNames = children(node, "import_name");
  const importPath = child(node, "import_path");

  const names: string[] = [];
  for (const nameNode of importNames) {
    const text = importNameText(nameNode);
    if (text) names.push(text);
  }

  // Extract the import path text using core's entryText for delimiter stripping
  let pathText = "";
  if (importPath) {
    const inner = importPath.namedChildren[0];
    pathText = entryText(inner ?? importPath) ?? "";
  }

  const entry: ImportEntry = {
    names,
    resolvedUri: null, // Caller resolves paths
    pathRange: importPath ? nodeRange(importPath) : nodeRange(node),
    pathText,
  };

  const existing = index.imports.get(uri) ?? [];
  existing.push(entry);
  index.imports.set(uri, existing);

  // Register each imported name as a reference
  for (const nameNode of importNames) {
    const text = importNameText(nameNode);
    if (text) {
      addReference(index, text, {
        uri,
        range: nodeRange(nameNode),
        name: text,
        context: "import",
      });
    }
  }
}

function indexMappingRefs(
  index: WorkspaceIndex,
  uri: string,
  mappingNode: SyntaxNode,
  _namespace: string | null,
): void {
  const body = child(mappingNode, "mapping_body");
  if (!body) return;

  for (const ch of body.namedChildren) {
    if (ch.type === "source_block") {
      for (const ref of children(ch, "source_ref")) {
        const name = sourceRefStructuralText(ref);
        if (name) {
          addReference(index, name, {
            uri,
            range: nodeRange(ref),
            name,
            context: "source",
          });
        }
      }
    } else if (ch.type === "target_block") {
      for (const ref of children(ch, "source_ref")) {
        const name = sourceRefStructuralText(ref);
        if (name) {
          addReference(index, name, {
            uri,
            range: nodeRange(ref),
            name,
            context: "target",
          });
        }
      }
    }

    // Index spread refs inside mapping body
    if (ch.type === "source_block" || ch.type === "target_block") continue;
    indexArrowSpreadRefs(index, uri, ch);
  }

  // Index field-level references from arrow src_path / tgt_path nodes
  indexArrowFieldRefs(index, uri, body);

  // Index @refs and backtick refs inside NL strings in arrows
  indexNlRefs(index, uri, body);
}

function indexArrowSpreadRefs(
  index: WorkspaceIndex,
  uri: string,
  node: SyntaxNode,
): void {
  // Walk all descendants looking for fragment_spread nodes
  walkDescendants(node, (n) => {
    if (n.type === "fragment_spread") {
      const sl = child(n, "spread_label");
      const name = sl ? spreadLabelText(sl) : null;
      if (name) {
        addReference(index, name, {
          uri,
          range: nodeRange(n),
          name,
          context: "spread",
        });
      }
    }
  });
}

function indexArrowFieldRefs(
  index: WorkspaceIndex,
  uri: string,
  body: SyntaxNode,
): void {
  const sourceSchemas = getMappingBodySchemas(body, "source_block");
  const targetSchemas = getMappingBodySchemas(body, "target_block");

  walkDescendants(body, (n) => {
    if (n.type !== "src_path" && n.type !== "tgt_path") return;
    const isSrc = n.type === "src_path";
    const schemas = isSrc ? sourceSchemas : targetSchemas;

    const fieldName = extractArrowFieldName(n);    // first segment / bare name
    const fullPath = extractArrowFullPath(n);       // full dotted path, namespace-stripped

    if (!fieldName) return;

    // Bare field name — existing behaviour
    addReference(index, fieldName, {
      uri,
      range: nodeRange(n),
      name: fieldName,
      context: "arrow",
    });

    // schema.fullPath — canonical qualified keys, matching CLI index-builder
    if (fullPath) {
      for (const schema of schemas) {
        const qualKey = `${schema}.${fullPath}`;
        addReference(index, qualKey, {
          uri,
          range: nodeRange(n),
          name: qualKey,
          context: "arrow",
        });
      }
      // Also index the full path without a schema prefix when it differs from
      // the bare name (nested paths like CdtTrfTxInf.DbtrAgt.BIC)
      if (fullPath !== fieldName) {
        addReference(index, fullPath, {
          uri,
          range: nodeRange(n),
          name: fullPath,
          context: "arrow",
        });
      }
    }
  });
}

/** Extract the schemas named in a source_block or target_block within a mapping body. */
function getMappingBodySchemas(body: SyntaxNode, blockType: string): string[] {
  const names: string[] = [];
  for (const ch of body.namedChildren) {
    if (ch.type === blockType) {
      for (const ref of children(ch, "source_ref")) {
        const name = sourceRefStructuralText(ref);
        if (name) names.push(name);
      }
    }
  }
  return names;
}

/**
 * Extract the full field path from a src_path or tgt_path node —
 * strips any leading dot (relative paths) and namespace prefix (ns::field).
 * Returns the dotted field path, e.g. "Amount", "CdtTrfTxInf.DbtrAgt.BIC",
 * or "field name" for a backtick-quoted first segment.
 */
function extractArrowFullPath(pathNode: SyntaxNode): string | null {
  const text = pathNode.text;
  if (!text) return null;

  // Backtick path: `field name` or `field name`.nested — strip backticks from first seg
  if (text.startsWith("`")) {
    const endTick = text.indexOf("`", 1);
    if (endTick <= 0) return null;
    const firstSeg = text.slice(1, endTick);
    const rest = text.slice(endTick + 1); // e.g. ".nested" or ""
    return rest.startsWith(".") ? firstSeg + rest : firstSeg;
  }

  // Strip leading dot from relative paths (.field → field)
  const stripped = text.startsWith(".") ? text.slice(1) : text;

  // Strip namespace prefix (ns::field → field)
  const nsIdx = stripped.indexOf("::");
  return (nsIdx >= 0 ? stripped.slice(nsIdx + 2) : stripped) || null;
}

/** Extract the first-segment field name from a src_path or tgt_path node. */
function extractArrowFieldName(pathNode: SyntaxNode): string | null {
  const text = pathNode.text;
  if (!text) return null;

  // Handle backtick paths: `field name` or `field name`.sub
  if (text.startsWith("`")) {
    const endTick = text.indexOf("`", 1);
    if (endTick > 0) return text.slice(1, endTick);
    return null;
  }

  // Handle relative paths: .field or .parent.field — strip leading dot
  const stripped = text.startsWith(".") ? text.slice(1) : text;

  // Take the first segment (before any dots)
  const firstSegment = stripped.split(".")[0]!;

  // Handle namespaced: ns::field → take field part
  if (firstSegment.includes("::")) {
    return firstSegment.split("::").pop() ?? null;
  }

  return firstSegment || null;
}

const NL_AT_REF_RE = createAtRefRegex();

function indexNlRefs(
  index: WorkspaceIndex,
  uri: string,
  body: SyntaxNode,
): void {
  walkDescendants(body, (n) => {
    if (n.type !== "nl_string" && n.type !== "multiline_string") return;

    const text = n.text;
    const startRow = n.startPosition.row;
    const startCol = n.startPosition.column;

    // Index @refs
    NL_AT_REF_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = NL_AT_REF_RE.exec(text)) !== null) {
      // Strip leading @ and backtick delimiters
      const rawRef = match[0].slice(1);
      const refName = rawRef.replace(/`([^`]+)`/g, "$1");

      const range = offsetToRange(text, match.index, match[0].length, startRow, startCol);
      addReference(index, refName, {
        uri,
        range,
        name: refName,
        context: "arrow",
      });
    }

  });
}

/** Convert an offset within a node's text to an LSP Range. */
function offsetToRange(
  text: string,
  offset: number,
  length: number,
  nodeStartRow: number,
  nodeStartCol: number,
): Range {
  // Find the row/col of the offset
  let row = 0;
  let col = 0;
  for (let i = 0; i < offset; i++) {
    if (text[i] === "\n") {
      row++;
      col = 0;
    } else {
      col++;
    }
  }
  const startLine = nodeStartRow + row;
  const startChar = row === 0 ? nodeStartCol + col : col;

  // Find the row/col of offset + length
  let endRow = row;
  let endCol = col;
  for (let i = offset; i < offset + length; i++) {
    if (text[i] === "\n") {
      endRow++;
      endCol = 0;
    } else {
      endCol++;
    }
  }
  const endLine = nodeStartRow + endRow;
  const endChar = endRow === 0 ? nodeStartCol + endCol : (endRow === row ? (row === 0 ? nodeStartCol + endCol : endCol) : endCol);

  return Range.create(startLine, startChar, endLine, endChar);
}

function indexSpreadRefs(
  index: WorkspaceIndex,
  uri: string,
  body: SyntaxNode,
): void {
  for (const spread of children(body, "fragment_spread")) {
    const sl = child(spread, "spread_label");
    const name = sl ? spreadLabelText(sl) : null;
    if (name) {
      addReference(index, name, {
        uri,
        range: nodeRange(spread),
        name,
        context: "spread",
      });
    }
  }
}

function indexMetricRefs(
  index: WorkspaceIndex,
  uri: string,
  metricNode: SyntaxNode,
  _namespace: string | null,
): void {
  // Metric sources are in the metadata block as "source <name>" key-value pairs
  const meta = child(metricNode, "metadata_block");
  if (!meta) return;

  walkDescendants(meta, (n) => {
    if (n.type === "tag_with_value") {
      const keyNode = n.namedChildren[0];
      if (keyNode?.text === "source") {
        // Value can be identifier, qualified_name, or braced list (inside value_text)
        const valNode = n.namedChildren[1];
        if (valNode) {
          const name = valNode.text;
          addReference(index, name, {
            uri,
            range: nodeRange(valNode),
            name,
            context: "metric_source",
          });
        }
      }
    }
  });
}

// ---------- Field extraction ----------
//
// Delegates to core's extractFieldTree() for the canonical field tree structure,
// then maps each FieldDecl to a FieldInfo with LSP Range data. The CST
// field_decl nodes are walked in parallel to derive precise ranges.

/**
 * Extract fields from a schema_body using core's extractFieldTree(), then
 * map to FieldInfo records with LSP Range data from the parallel CST nodes.
 */
function extractFields(body: SyntaxNode | null): FieldInfo[] {
  if (!body) return [];
  const fieldTree = extractFieldTree(body);
  const fieldNodes = children(body, "field_decl");
  return fieldTree.fields.map((decl, i) =>
    fieldDeclToInfo(decl, fieldNodes[i] ?? null),
  );
}

/**
 * Convert a core FieldDecl to an LSP FieldInfo, deriving the Range from
 * the parallel CST field_name node when available, otherwise from the
 * decl's startRow/startColumn.
 */
function fieldDeclToInfo(decl: FieldDecl, cstNode: SyntaxNode | null): FieldInfo {
  // Build the type string: core uses "record" for nested, LSP distinguishes list_of variants
  let type: string | null = decl.type || null;
  if (decl.isList && decl.type === "record") type = "list_of record";
  else if (decl.isList && decl.type) type = `list_of ${decl.type}`;
  else if (decl.isList) type = "list_of";

  // Range from CST node (precise) or from core position data (approximate)
  const nameNode = cstNode ? child(cstNode, "field_name") : null;
  const range = nameNode
    ? nodeRange(nameNode)
    : Range.create(decl.startRow ?? 0, decl.startColumn ?? 0, decl.startRow ?? 0, (decl.startColumn ?? 0) + decl.name.length);

  // Recurse for nested fields
  const nestedBody = cstNode ? child(cstNode, "schema_body") : null;
  const nestedNodes = nestedBody ? children(nestedBody, "field_decl") : [];
  const fieldChildren = (decl.children ?? []).map((childDecl, j) =>
    fieldDeclToInfo(childDecl, nestedNodes[j] ?? null),
  );

  return { name: decl.name, type, range, children: fieldChildren };
}

// ---------- Text extraction helpers ----------
//
// These delegate to @satsuma/core cst-utils for the standard CST text
// extraction logic. Only LSP-specific adapters (importNameText, spreadLabelText,
// extractArrowFullPath) remain here because they handle grammar forms or
// multi-word patterns not needed by the general-purpose core helpers.

/**
 * Extract the structural schema/fragment name from a source_ref node.
 * NL join descriptions inside `source {}` are intentionally ignored.
 */
function sourceRefStructuralText(ref: SyntaxNode): string | null {
  return coreSourceRefStructuralText(ref);
}

/**
 * Extract import name text from an import_name node.
 * Handles qualified_name (ns::name), backtick_name, and identifier children.
 * LSP-specific: import_name nodes are only relevant for workspace indexing.
 */
function importNameText(node: SyntaxNode): string | null {
  const qn = child(node, "qualified_name");
  if (qn) return coreQualifiedNameText(qn);
  const quoted = child(node, "backtick_name");
  if (quoted) return quoted.text.slice(1, -1);
  const id = child(node, "identifier");
  if (id) return id.text;
  return null;
}

/**
 * Extract text from a spread_label node, handling multi-word spreads.
 * Multi-word spreads use identifier + continuation_word children (sl-3ccy).
 * LSP-specific: the core spread extractor in extract.ts has its own version.
 */
function spreadLabelText(node: SyntaxNode): string | null {
  const qn = child(node, "qualified_name");
  if (qn) return coreQualifiedNameText(qn);
  const quoted = child(node, "backtick_name");
  if (quoted) return quoted.text.slice(1, -1);
  const ids = node.namedChildren.filter((c: SyntaxNode) => c.type === "identifier" || c.type === "continuation_word");
  if (ids.length > 0) return ids.map((i: SyntaxNode) => i.text).join(" ");
  return node.text;
}

// ---------- Internal helpers ----------

function addDefinition(
  index: WorkspaceIndex,
  name: string,
  entry: DefinitionEntry,
): void {
  const existing = index.definitions.get(name) ?? [];
  existing.push(entry);
  index.definitions.set(name, existing);
}

function addReference(
  index: WorkspaceIndex,
  name: string,
  entry: ReferenceEntry,
): void {
  const existing = index.references.get(name) ?? [];
  existing.push(entry);
  index.references.set(name, existing);
}

// ---------- Test-only exports ----------
//
// `resolveImportUri` is private (consumers reach it through
// getImportReachableUris), but the resolver parity test needs to compare it
// directly against the old Node `path`-based output. Exposed here rather than
// widening the public API, matching the `_testInternals` convention in
// viz-model.ts. Named distinctly from viz-model's `_testInternals` so the
// package barrel's `export *` stays unambiguous.
export const _resolverTestInternals = {
  resolveImportUri,
  relativeUriPath,
};
