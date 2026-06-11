/**
 * nl-ref.ts — Extract and resolve @ref references from NL strings
 *
 * Parses NL strings inside transform pipe steps for @ref references
 * (e.g., `@source_schema`, `@schema.field`, `@ns::schema.field`),
 * classifies them, and optionally resolves them against a DefinitionLookup callback.
 *
 * The DefinitionLookup abstraction decouples this module from WorkspaceIndex
 * so both the CLI and LSP can share it (ADR-006).
 */

import type { FieldDecl, SyntaxNode } from "./types.js";
import { expandEntityFields } from "./spread-expand.js";
import type { SpreadEntity, EntityRefResolver, SpreadEntityLookup } from "./spread-expand.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AtRef {
  ref: string;
  offset: number;
}

export type RefClassification =
  | "namespace-qualified-field"
  | "namespace-qualified-schema"
  | "dotted-field"
  | "bare";

export interface Resolution {
  resolved: boolean;
  resolvedTo: { kind: string; name: string } | null;
}

export interface MappingSourcesTargets {
  sources: string[];
  targets: string[];
  namespace?: string | null;
}

/**
 * Lookup abstraction for resolving NL refs against an index.
 * Implementations provide access to schemas, fragments, transforms, and mappings
 * without exposing the concrete index type.
 */
export interface DefinitionLookup {
  hasSchema(key: string): boolean;
  getSchema(key: string): SchemaLike | null | undefined;
  hasFragment(key: string): boolean;
  getFragment(key: string): SpreadEntity | null | undefined;
  hasTransform(key: string): boolean;
  getMapping(key: string): MappingSourcesTargets | null | undefined;
  /** Iterate all schema entries for workspace-wide fallback resolution. */
  iterateSchemas?(): Iterable<[string, SchemaLike]>;
  /** Expand fragment spreads for a schema. Provided by the consumer's own spread logic. */
  expandSpreads?(entity: SpreadEntity, currentNs: string | null): FieldDecl[];
}

interface SchemaLike {
  fields: FieldDecl[];
  hasSpreads: boolean;
  spreads?: string[];
  namespace?: string | null;
}

export interface NLRefDataItem {
  text: string;
  mapping: string;
  namespace: string | null;
  targetField: string | null;
  /** Where in the mapping body this NL text came from. Source block NL text
   * describes join conditions and filters — it must not generate NL-derived
   * arrows. Absent means an arrow body or note block. */
  context?: "source_block";
  line: number;
  column: number;
  file: string;
}

export interface ResolvedNLRef {
  ref: string;
  classification: RefClassification;
  resolved: boolean;
  resolvedTo: { kind: string; name: string } | null;
  /** Index key of the owning mapping, ALREADY namespace-qualified
   * ("crm::load") when the mapping lives in a namespace. Do not prepend
   * `namespace` again — double-qualifying breaks lookups (sl-qxn5, sl-njej). */
  mapping: string;
  /** Namespace the ref was authored in, kept for scope-aware resolution.
   * Informational alongside `mapping`, which already embeds it. */
  namespace: string | null;
  targetField: string | null;
  /** Propagated from the source NLRefDataItem. "source_block" means the ref
   * came from a join condition or filter expression, not an arrow body. */
  context?: "source_block";
  file: string;
  line: number;
  column: number;
}

// ── Canonical key helper ──────────────────────────────────────────────────────

/**
 * Convert an internal index key to a canonical reference string.
 * If the key already contains "::", it is returned as-is.
 * Otherwise, it is prefixed with "::" to produce the canonical form.
 */
function canonicalKey(key: string): string {
  if (key.includes("::")) return key;
  return `::${key}`;
}

// ── Extraction ────────────────────────────────────────────────────────────────

// @ref pattern: @identifier, @schema.field, @ns::schema.field, @`backtick`.field.
//
// The lookbehind requires the @ to be at start-of-string, after whitespace, or
// after a small set of opening/separator punctuation. Without it, email-like
// patterns (`user@example.com`) and SQL LIKE wildcards (`%@test.internal`)
// produced spurious matches and false-positive unresolved-nl-ref warnings
// (sl-gl21). The allowed prefix set intentionally excludes `%`, letters,
// digits, `_` and `.` so that `%@foo` and `user@bar` are not extracted, while
// `(@foo`, `[@foo`, `, @foo` and start-of-string `@foo` still are.
//
// Quotes, `=` and `:` are allowed prefixes (sl-74m6): NL prose legitimately
// abuts refs against them — `"@customers" table`, `where id =@customers.id`,
// `key:@customers.id` — and none of those shapes overlap the email/wildcard
// false positives the lookbehind exists to block.
//
// AT_REF_PATTERN is the canonical source. Consumers that need a fresh regex
// instance (because /g state is mutable) should call createAtRefRegex(); this
// is the single source of truth shared by core, the LSP, the viz backend and
// the viz UI to avoid drift between copies.
export const AT_REF_PATTERN = "(?<=^|[\\s(\\[{,;\"'=:])@(`[^`]+`|[a-zA-Z_][a-zA-Z0-9_-]*)(?:::(`[^`]+`|[a-zA-Z_][a-zA-Z0-9_-]*))?(?:\\.(`[^`]+`|[a-zA-Z_][a-zA-Z0-9_-]*))*";

/**
 * Build a fresh global @ref regex. Always returns a new instance so callers
 * never share `lastIndex` state with each other.
 */
export function createAtRefRegex(): RegExp {
  return new RegExp(AT_REF_PATTERN, "g");
}

const AT_REF_RE = createAtRefRegex();

/**
 * Compute the 1-based (line, column) of an @ref inside an NL string, given
 * the string's start position and the byte offset of the @ within the string.
 *
 * Multiline NL strings (`"""..."""`) may contain @refs on any line of the body.
 * A naive `column = startColumn + offset` calculation only works on the first
 * line — once a newline is crossed, the column resets relative to the start of
 * that line. This helper handles both cases and is the single source of truth
 * for diagnostic positions of NL refs (sl-2ji3).
 *
 * @param item   The NL ref source item; only `text`, `line`, `column` are read.
 *               `item.line` and `item.column` are 0-based (CST positions).
 * @param offset Byte offset of the `@` character within `item.text`.
 * @returns      1-based `{line, column}` suitable for diagnostic reporting.
 */
export function computeNLRefPosition(
  item: { text: string; line: number; column: number },
  offset: number,
): { line: number; column: number } {
  const textBefore = item.text.slice(0, offset);
  const newlines = (textBefore.match(/\n/g) ?? []).length;
  const line = item.line + newlines + 1;
  let column: number;
  if (newlines > 0) {
    // After a newline the column resets — count from the last `\n` in the
    // prefix to the @ character. The `\n` itself sits at index `lastNl`, so
    // the next character is column 1, giving `offset - lastNl`.
    const lastNl = textBefore.lastIndexOf("\n");
    column = offset - lastNl;
  } else {
    // No newline crossed — the @ is on the same line as the string opener,
    // so add the offset to the string's start column (+1 to make 1-based).
    column = item.column + offset + 1;
  }
  return { line, column };
}

/**
 * Extract @ref mentions from a single NL string.
 */
export function extractAtRefs(text: string): AtRef[] {
  const refs: AtRef[] = [];
  let match;

  AT_REF_RE.lastIndex = 0;
  while ((match = AT_REF_RE.exec(text)) !== null) {
    const rawRef = match[0].slice(1); // remove @
    const ref = rawRef.replace(/`([^`]+)`/g, "$1");
    refs.push({ ref, offset: match.index });
  }

  return refs;
}

// ── Classification ────────────────────────────────────────────────────────────

/**
 * Classify an @ref by its syntactic form.
 */
export function classifyRef(ref: string): RefClassification {
  if (ref.includes("::")) {
    return ref.includes(".") ? "namespace-qualified-field" : "namespace-qualified-schema";
  }
  if (ref.includes(".")) return "dotted-field";
  return "bare";
}

// ── Resolution ────────────────────────────────────────────────────────────────

interface MappingContext {
  sources: string[];
  targets: string[];
  namespace: string | null;
}

function getExpandedFields(schema: SchemaLike, lookup: DefinitionLookup): FieldDecl[] {
  if (!schema.hasSpreads) return [];
  if (lookup.expandSpreads) {
    return lookup.expandSpreads(schema as SpreadEntity, schema.namespace ?? null);
  }
  // Default: use core's expandEntityFields with basic lookup
  const resolveRef: EntityRefResolver = (ref, ns) => {
    if (ref.includes("::")) return lookup.hasFragment(ref) ? ref : null;
    if (ns) {
      const nsKey = `${ns}::${ref}`;
      if (lookup.hasFragment(nsKey)) return nsKey;
    }
    if (lookup.hasFragment(ref)) return ref;
    return null;
  };
  const lookupFrag: SpreadEntityLookup = (key) => lookup.getFragment(key) ?? null;
  return expandEntityFields(schema as SpreadEntity, schema.namespace ?? null, resolveRef, lookupFrag);
}

/**
 * Check if a field tree contains a field with the given name (flat or nested).
 */
function hasField(fields: FieldDecl[], name: string): boolean {
  for (const f of fields) {
    if (f.name === name) return true;
    if (f.children && hasField(f.children, name)) return true;
  }
  return false;
}

/**
 * Check if a dotted path resolves to a nested field within a field tree.
 *
 * Tries two strategies in order:
 *  1. matchPath — treat the path as anchored from the root of the field tree.
 *  2. searchNestedPath — search for the path starting from any nested record
 *     field, to handle refs that omit leading path segments.
 */
function hasNestedFieldPath(fields: FieldDecl[], path: string): boolean {
  const segments = path.split(".");
  if (matchPath(fields, segments)) return true;
  return searchNestedPath(fields, segments);
}

/**
 * Walk the field tree following each segment of the path in order.
 * Returns true only if every segment resolves at its expected nesting level
 * (i.e., the path is anchored at the top of the given field list).
 */
function matchPath(fields: FieldDecl[], segments: string[]): boolean {
  let current = fields;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const field = current.find((f) => f.name === seg);
    if (!field) return false;
    if (i < segments.length - 1) {
      if (!field.children || field.children.length === 0) return false;
      current = field.children;
    }
  }
  return true;
}

/**
 * Recursively search all record fields for a subtree where matchPath succeeds.
 * Used when the ref omits a leading path component (e.g., writing "city"
 * instead of "address.city") — we descend into record children to find a match.
 */
function searchNestedPath(fields: FieldDecl[], segments: string[]): boolean {
  for (const f of fields) {
    if (f.children) {
      if (matchPath(f.children, segments)) return true;
      if (searchNestedPath(f.children, segments)) return true;
    }
  }
  return false;
}

function hasFieldWithSpreads(schema: SchemaLike, fieldName: string, lookup: DefinitionLookup): boolean {
  if (fieldName.includes(".")) {
    if (hasNestedFieldPath(schema.fields, fieldName)) return true;
    if (!schema.hasSpreads) return false;
    const expanded = getExpandedFields(schema, lookup);
    return hasNestedFieldPath([...schema.fields, ...expanded], fieldName);
  }
  if (hasField(schema.fields, fieldName)) return true;
  if (!schema.hasSpreads) return false;
  const expanded = getExpandedFields(schema, lookup);
  return hasField(expanded, fieldName);
}

/**
 * Resolve a single @ref string to a concrete definition in the workspace index.
 *
 * Resolution cases (tried in order):
 *
 *  Case 1 — namespace-qualified schema ref (e.g. "crm::customers"):
 *    Looked up directly in schemas/fragments/transforms by qualified key.
 *
 *  Case 2 — namespace-qualified field ref (e.g. "crm::customers.account_id"):
 *    Split at the first "." after "::"; the left side is the schema ref, the
 *    right side is the field path. Resolved against that schema's field tree.
 *
 *  Case 3 — dotted-field ref (e.g. "customers.account_id" or "address.city"):
 *    First, the prefix before the first "." is matched against schema names in
 *    the mapping context (sources + targets). If a match is found, the suffix
 *    is resolved as a field on that schema. If no match is found, a second pass
 *    searches the entire workspace (see the fallback comment inside the branch).
 *
 *  Case 4 — bare identifier (e.g. "account_id"):
 *    Searched as a field name on each schema in the mapping context. Falls back
 *    to a workspace-wide field search when the mapping context has no schemas.
 *    Then tried as a schema/fragment/transform name (with namespace prefix if
 *    the mapping is inside a namespace block).
 */
/**
 * Resolve a mapping-context schema name to the key it is indexed under.
 *
 * Source/target lists come from extraction, which records names exactly as
 * authored: a bare name inside a namespaced mapping ("customers") usually
 * refers to a sibling schema indexed under "ns::customers". Looking it up
 * raw made every bare @field ref against a namespaced source schema report
 * as unresolved (sl-98cz). Try the namespace-qualified form first, then fall
 * back to the raw name so global schemas referenced from inside a namespace
 * still resolve.
 */
function contextSchemaKey(name: string, namespace: string | null, lookup: DefinitionLookup): string {
  if (namespace && !name.includes("::")) {
    const qualified = `${namespace}::${name}`;
    if (lookup.hasSchema(qualified)) return qualified;
  }
  return name;
}

export function resolveRef(ref: string, mappingContext: MappingContext, lookup: DefinitionLookup): Resolution {
  const classification = classifyRef(ref);

  if (classification === "namespace-qualified-schema") {
    if (lookup.hasSchema(ref)) return { resolved: true, resolvedTo: { kind: "schema", name: canonicalKey(ref) } };
    if (lookup.hasFragment(ref)) return { resolved: true, resolvedTo: { kind: "fragment", name: canonicalKey(ref) } };
    if (lookup.hasTransform(ref)) return { resolved: true, resolvedTo: { kind: "transform", name: canonicalKey(ref) } };
    return { resolved: false, resolvedTo: null };
  }

  if (classification === "namespace-qualified-field") {
    const dotIdx = ref.indexOf(".", ref.indexOf("::") + 2);
    const schemaRef = ref.slice(0, dotIdx);
    const fieldName = ref.slice(dotIdx + 1);
    const schema = lookup.getSchema(schemaRef);
    if (schema && hasFieldWithSpreads(schema, fieldName, lookup)) {
      return { resolved: true, resolvedTo: { kind: "field", name: `${canonicalKey(schemaRef)}.${fieldName}` } };
    }
    return { resolved: false, resolvedTo: null };
  }

  if (classification === "dotted-field") {
    const dotIdx = ref.indexOf(".");
    const schemaName = ref.slice(0, dotIdx);
    const fieldName = ref.slice(dotIdx + 1);

    const allSchemas = [...(mappingContext.sources ?? []), ...(mappingContext.targets ?? [])];
    for (const s of allSchemas) {
      const key = contextSchemaKey(s, mappingContext.namespace, lookup);
      const schema = lookup.getSchema(key);
      if (schema && hasNestedFieldPath(schema.fields, ref)) {
        return { resolved: true, resolvedTo: { kind: "field", name: `${canonicalKey(key)}.${ref}` } };
      }
      if (schema?.hasSpreads) {
        const expanded = getExpandedFields(schema, lookup);
        if (hasNestedFieldPath([...schema.fields, ...expanded], ref)) {
          return { resolved: true, resolvedTo: { kind: "field", name: `${canonicalKey(key)}.${ref}` } };
        }
      }
    }

    for (const s of allSchemas) {
      const nsIdx = s.indexOf("::");
      const baseName = nsIdx !== -1 ? s.slice(nsIdx + 2) : s;
      if (baseName === schemaName || s === schemaName) {
        const key = contextSchemaKey(s, mappingContext.namespace, lookup);
        const schema = lookup.getSchema(key);
        if (schema && hasFieldWithSpreads(schema, fieldName, lookup)) {
          return { resolved: true, resolvedTo: { kind: "field", name: `${canonicalKey(key)}.${fieldName}` } };
        }
      }
    }

    // Workspace-wide fallback: the dotted ref's schema name didn't match any
    // source or target in the mapping context (e.g. the ref is in a note block
    // with no mapping context, or it refers to an intermediate schema that
    // isn't listed as a source/target). Search all schemas in the workspace so
    // the ref can still resolve — the cost is a broader match surface, but
    // false positives are unlikely given the requirement to also match the field.
    if (lookup.iterateSchemas) {
      for (const [key, schema] of lookup.iterateSchemas()) {
        const nsIdx = key.indexOf("::");
        const baseName = nsIdx !== -1 ? key.slice(nsIdx + 2) : key;
        if (baseName === schemaName || key === schemaName) {
          if (hasFieldWithSpreads(schema, fieldName, lookup)) {
            return { resolved: true, resolvedTo: { kind: "field", name: `${canonicalKey(key)}.${fieldName}` } };
          }
        }
        // Also try as nested path within this schema
        if (hasNestedFieldPath(schema.fields, ref)) {
          return { resolved: true, resolvedTo: { kind: "field", name: `${canonicalKey(key)}.${ref}` } };
        }
      }
    }
    return { resolved: false, resolvedTo: null };
  }

  // Bare identifier
  const allSchemaNames = [...(mappingContext.sources ?? []), ...(mappingContext.targets ?? [])];
  for (const s of allSchemaNames) {
    const key = contextSchemaKey(s, mappingContext.namespace, lookup);
    const schema = lookup.getSchema(key);
    if (schema && hasFieldWithSpreads(schema, ref, lookup)) {
      return { resolved: true, resolvedTo: { kind: "field", name: `${canonicalKey(key)}.${ref}` } };
    }
  }

  // When there is no mapping context (e.g. standalone notes), fall back to
  // searching all workspace schemas for the bare field name.
  if (allSchemaNames.length === 0 && lookup.iterateSchemas) {
    for (const [key, schema] of lookup.iterateSchemas()) {
      if (hasFieldWithSpreads(schema, ref, lookup)) {
        return { resolved: true, resolvedTo: { kind: "field", name: `${canonicalKey(key)}.${ref}` } };
      }
    }
  }

  if (mappingContext.namespace) {
    const nsRef = `${mappingContext.namespace}::${ref}`;
    if (lookup.hasSchema(nsRef)) return { resolved: true, resolvedTo: { kind: "schema", name: canonicalKey(nsRef) } };
    if (lookup.hasFragment(nsRef)) return { resolved: true, resolvedTo: { kind: "fragment", name: canonicalKey(nsRef) } };
    if (lookup.hasTransform(nsRef)) return { resolved: true, resolvedTo: { kind: "transform", name: canonicalKey(nsRef) } };
  }

  if (lookup.hasSchema(ref)) return { resolved: true, resolvedTo: { kind: "schema", name: canonicalKey(ref) } };
  if (lookup.hasFragment(ref)) return { resolved: true, resolvedTo: { kind: "fragment", name: canonicalKey(ref) } };
  if (lookup.hasTransform(ref)) return { resolved: true, resolvedTo: { kind: "transform", name: canonicalKey(ref) } };

  return { resolved: false, resolvedTo: null };
}

// ── CST Walking ───────────────────────────────────────────────────────────────

/** NLRefDataItem without the file path — used during CST walking before the
 * file path is known. */
export type NLRefDataItemNoFile = Omit<NLRefDataItem, "file">;

/**
 * Extract NL ref data from a CST root node. Called during file extraction
 * while the tree is still valid.
 */
export function extractNLRefData(rootNode: SyntaxNode): NLRefDataItemNoFile[] {
  const results: NLRefDataItemNoFile[] = [];
  walkMappings(rootNode, null, results);
  return results;
}

function walkMappings(node: SyntaxNode, namespace: string | null, results: NLRefDataItemNoFile[]): void {
  for (const c of node.namedChildren) {
    if (c.type === "namespace_block") {
      const nsName = c.namedChildren.find((x) => x.type === "identifier");
      walkMappings(c, nsName?.text ?? null, results);
    } else if (c.type === "mapping_block") {
      extractMappingNLRefs(c, namespace, results);
    } else if (c.type === "transform_block") {
      extractTransformNLRefs(c, namespace, results);
    } else if (c.type === "note_block") {
      extractStandaloneNoteRefs(c, namespace, null, results);
    } else if (c.type === "schema_block" || c.type === "fragment_block") {
      extractBlockNoteRefs(c, namespace, results);
    }
  }
}

function extractMappingNLRefs(mappingNode: SyntaxNode, namespace: string | null, results: NLRefDataItemNoFile[]): void {
  const lbl = mappingNode.namedChildren.find((c) => c.type === "block_label");
  const inner = lbl?.namedChildren[0];
  let mappingName = inner?.text ?? null;
  if (inner?.type === "backtick_name") mappingName = mappingName!.slice(1, -1);
  if (!mappingName) {
    mappingName = `<anon>@:${mappingNode.startPosition.row}`;
  }

  const body = mappingNode.namedChildren.find((c) => c.type === "mapping_body");
  if (!body) return;

  walkArrowsForNL(body, mappingName, namespace, null, results);
}

// Collect the ref-bearing nodes carried by a single pipe step. A step is one
// of three shapes: pipe_text (NL strings and bare at_refs are direct
// children), a map literal (NL strings live inside each entry's key and
// value — sl-74m6: refs in `map { "x": "see @customers.id" }` must reach
// lineage and validation), or a fragment spread (never carries NL text).
//
// Bare at_refs matter because the grammar parses unquoted pipe text
// structurally: `a -> b { derived from @b }` yields an at_ref node with no
// surrounding NL string, so a string-only walk never sees it (bptar-l6n8).
function nlRefNodesInPipeStep(step: SyntaxNode): SyntaxNode[] {
  const isNL = (n: SyntaxNode) =>
    n.type === "nl_string" || n.type === "multiline_string" || n.type === "at_ref";
  const inner = step.namedChildren[0];
  if (!inner) return [];
  if (inner.type === "pipe_text") return inner.namedChildren.filter(isNL);
  if (inner.type === "map_literal") {
    return inner.namedChildren
      .filter((e) => e.type === "map_entry")
      .flatMap((e) => e.namedChildren)            // map_key and map_value parts
      .flatMap((part) => part.namedChildren.filter(isNL));
  }
  return [];
}

// The text payload of one ref-bearing node, or null when it cannot contain a
// ref. Quoted NL strings are unwrapped from their delimiters; a bare at_ref
// keeps its "@name" text verbatim so the downstream regex scan finds the ref
// at offset zero, making position math identical to the quoted case.
function nlRefText(node: SyntaxNode): string | null {
  const text =
    node.type === "multiline_string" ? node.text.slice(3, -3) :
    node.type === "nl_string" ? node.text.slice(1, -1) :
    node.text; // at_ref
  return text.includes("`") || /@[a-zA-Z_`]/.test(text) ? text : null;
}

function extractTransformNLRefs(transformNode: SyntaxNode, namespace: string | null, results: NLRefDataItemNoFile[]): void {
  const lbl = transformNode.namedChildren.find((c) => c.type === "block_label");
  const inner = lbl?.namedChildren[0];
  let transformName = inner?.text ?? "";
  if (inner?.type === "backtick_name") transformName = transformName.slice(1, -1);

  const pipeChain = transformNode.namedChildren.find((c) => c.type === "pipe_chain");
  if (!pipeChain) return;

  for (const step of pipeChain.namedChildren) {
    if (step.type === "pipe_step") {
      for (const nlNode of nlRefNodesInPipeStep(step)) {
        const text = nlRefText(nlNode);
        if (text !== null) {
          results.push({
            text,
            mapping: `transform:${transformName}`,
            namespace,
            targetField: null,
            line: nlNode.startPosition.row,
            column: nlNode.startPosition.column,
          });
        }
      }
    }
  }
}

function extractStandaloneNoteRefs(
  noteNode: SyntaxNode,
  namespace: string | null,
  parentLabel: string | null,
  results: NLRefDataItemNoFile[],
): void {
  for (const inner of noteNode.namedChildren) {
    if (inner.type === "nl_string" || inner.type === "multiline_string") {
      const text = inner.type === "multiline_string"
        ? inner.text.slice(3, -3)
        : inner.text.slice(1, -1);
      if (text.includes("`") || /@[a-zA-Z_`]/.test(text)) {
        results.push({
          text,
          mapping: parentLabel ? `note:${parentLabel}` : "note:",
          namespace,
          targetField: null,
          line: inner.startPosition.row,
          column: inner.startPosition.column,
        });
      }
    }
  }
}

function extractBlockNoteRefs(
  blockNode: SyntaxNode,
  namespace: string | null,
  results: NLRefDataItemNoFile[],
): void {
  const lbl = blockNode.namedChildren.find((c) => c.type === "block_label");
  const inner = lbl?.namedChildren[0];
  let blockName = inner?.text ?? "";
  if (inner?.type === "backtick_name") blockName = blockName.slice(1, -1);

  // Metric schemas are schema_block nodes — they use the "schema:" prefix.
  // (The old "metric:" prefix was for the removed metric_block type.)
  const blockTypePrefix = blockNode.type === "schema_block" ? "schema:"
    : blockNode.type === "fragment_block" ? "fragment:"
    : "";
  const parentLabel = `${blockTypePrefix}${blockName}`;

  // Also scan inline (note "...") metadata in the block declaration header.
  // For example: `schema my_schema (note "Derived from @upstream")` — the note
  // text lives in a note_tag inside metadata_block, not in a note_block child.
  const meta = blockNode.namedChildren.find((c) => c.type === "metadata_block");
  if (meta) {
    const noteTag = meta.namedChildren.find((c) => c.type === "note_tag");
    if (noteTag) {
      // note_tag has the same nl_string/multiline_string children as note_block.
      extractStandaloneNoteRefs(noteTag, namespace, parentLabel, results);
    }
  }

  // In v2, all schema-like blocks use schema_body (metric_body is removed).
  const bodyTypes = ["schema_body"];
  for (const child of blockNode.namedChildren) {
    if (child.type === "note_block") {
      extractStandaloneNoteRefs(child, namespace, parentLabel, results);
    } else if (bodyTypes.includes(child.type)) {
      for (const bodyChild of child.namedChildren) {
        if (bodyChild.type === "note_block") {
          extractStandaloneNoteRefs(bodyChild, namespace, parentLabel, results);
        }
      }
    }
  }
}

function walkArrowsForNL(
  node: SyntaxNode,
  mappingName: string,
  namespace: string | null,
  targetField: string | null,
  results: NLRefDataItemNoFile[],
): void {
  for (const c of node.namedChildren) {
    if (c.type === "note_block") {
      for (const inner of c.namedChildren) {
        if (inner.type === "nl_string" || inner.type === "multiline_string") {
          const text = inner.type === "multiline_string"
            ? inner.text.slice(3, -3)
            : inner.text.slice(1, -1);
          if (text.includes("`") || /@[a-zA-Z_`]/.test(text)) {
            results.push({
              text,
              mapping: mappingName,
              namespace,
              targetField: null,
              line: inner.startPosition.row,
              column: inner.startPosition.column,
            });
          }
        }
      }
      continue;
    }
    if (c.type === "source_block") {
      // NL text inside a source block describes join conditions and row filters,
      // not data flow arrows. Mark these items so callers (e.g. arrow derivation)
      // can skip them — but still include them for nl-refs reporting.
      const nlNodes = [
        ...c.namedChildren.filter((x) => x.type === "nl_string" || x.type === "multiline_string"),
        ...c.namedChildren
          .filter((x) => x.type === "source_ref")
          .flatMap((x) => x.namedChildren.filter((y) => y.type === "nl_string" || y.type === "multiline_string")),
      ];
      for (const nlNode of nlNodes) {
        const text = nlNode.type === "multiline_string"
          ? nlNode.text.slice(3, -3)
          : nlNode.text.slice(1, -1);
        if (text.includes("`") || /@[a-zA-Z_`]/.test(text)) {
          results.push({
            text,
            mapping: mappingName,
            namespace,
            targetField: null,
            context: "source_block",
            line: nlNode.startPosition.row,
            column: nlNode.startPosition.column,
          });
        }
      }
      continue;
    }
    if (c.type === "each_block" || c.type === "flatten_block") {
      const tgtNode = c.namedChildren.find((x) => x.type === "tgt_path");
      const tgt = extractPathText(tgtNode) ?? targetField;
      walkArrowsForNL(c, mappingName, namespace, tgt, results);
      continue;
    }
    if (c.type === "map_arrow" || c.type === "computed_arrow" || c.type === "nested_arrow") {
      const tgtNode = c.namedChildren.find((x) => x.type === "tgt_path");
      const tgt = extractPathText(tgtNode) ?? targetField;

      const pipeChain = c.namedChildren.find((x) => x.type === "pipe_chain");
      if (pipeChain) {
        for (const step of pipeChain.namedChildren) {
          if (step.type === "pipe_step") {
            for (const nlNode of nlRefNodesInPipeStep(step)) {
              const text = nlRefText(nlNode);
              if (text !== null) {
                results.push({
                  text,
                  mapping: mappingName,
                  namespace,
                  targetField: tgt,
                  line: nlNode.startPosition.row,
                  column: nlNode.startPosition.column,
                });
              }
            }
          }
        }
      }

      walkArrowsForNL(c, mappingName, namespace, tgt, results);
    }
  }
}

function extractPathText(pathNode: SyntaxNode | undefined): string | null {
  if (!pathNode) return null;
  const inner = pathNode.namedChildren[0];
  if (!inner) return pathNode.text;
  if (inner.type === "backtick_path") return inner.text.slice(1, -1);
  return inner.text;
}

// ── High-level resolution ─────────────────────────────────────────────────────

/**
 * Process pre-extracted NL ref data into fully resolved reference records.
 *
 * @param nlRefData - Items extracted during file parsing (with file path)
 * @param lookup - Consumer-provided index accessor callbacks
 */
export function resolveAllNLRefs(
  nlRefData: NLRefDataItem[],
  lookup: DefinitionLookup,
): ResolvedNLRef[] {
  const results: ResolvedNLRef[] = [];

  for (const item of nlRefData) {
    const atRefs = extractAtRefs(item.text);
    const mappingKey = item.namespace
      ? `${item.namespace}::${item.mapping}`
      : item.mapping;
    const mapping = lookup.getMapping(mappingKey);
    const mappingContext: MappingContext = {
      sources: mapping?.sources ?? [],
      targets: mapping?.targets ?? [],
      namespace: item.namespace,
    };

    for (const { ref, offset } of atRefs) {
      const classification = classifyRef(ref);
      const resolution = resolveRef(ref, mappingContext, lookup);

      // Use the shared helper, then convert back to the 0-based line that
      // ResolvedNLRef has historically returned (consumers add +1 themselves).
      const pos = computeNLRefPosition(item, offset);
      const line = pos.line - 1;
      const column = pos.column;

      results.push({
        ref,
        classification,
        resolved: resolution.resolved,
        resolvedTo: resolution.resolvedTo,
        mapping: mappingKey,
        namespace: item.namespace,
        targetField: item.targetField,
        context: item.context,
        file: item.file,
        line,
        column,
      });
    }
  }

  return results;
}

// ── Scope prefix handling ─────────────────────────────────────────────────────
//
// extractStandaloneNoteRefs and extractBlockNoteRefs use internal scope
// prefixes (e.g. "note:metric:", "note:schema:") in the mapping field to
// track which block a ref came from. These prefixes are implementation
// details and must not leak into consumer-facing output.

/** Internal scope prefixes used in NLRefDataItem.mapping, ordered longest-first. */
const NL_REF_SCOPE_PREFIXES = [
  "note:metric:",
  "note:schema:",
  "note:fragment:",
  "note:",
  "transform:",
] as const;

/**
 * Strip internal scope prefixes from an NL ref mapping name.
 * Returns the bare entity name (e.g. "churn_rate" from "note:metric:churn_rate").
 * Standalone file-level notes (mapping = "note:") return "(file-level note)".
 */
export function stripNLRefScopePrefix(mapping: string): string {
  for (const prefix of NL_REF_SCOPE_PREFIXES) {
    if (mapping.startsWith(prefix)) {
      const stripped = mapping.slice(prefix.length);
      return stripped || "(file-level note)";
    }
  }
  return mapping;
}

/**
 * Check if a schema reference from an NL block is declared in the mapping's
 * source or target list.
 */
export function isSchemaInMappingSources(schemaRef: string, mapping: MappingSourcesTargets | null | undefined): boolean {
  if (!mapping) return false;
  const allRefs = [...(mapping.sources ?? []), ...(mapping.targets ?? [])];
  return allRefs.some((r) => r === schemaRef || canonicalKey(r) === schemaRef);
}
