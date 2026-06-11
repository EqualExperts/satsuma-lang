import {
  CompletionItem,
  CompletionItemKind,
} from "vscode-languageserver";
import type { SyntaxNode, Tree } from "./parser-utils";
import { child, nodeAtPosition } from "./parser-utils";
import { sourceRefStructuralText } from "@satsuma/core";
import {
  WorkspaceIndex,
  allBlockNames,
  getFields,
  FieldInfo,
} from "./workspace-index";

/**
 * Compute context-aware completions at the given position.
 */
export function computeCompletions(
  tree: Tree,
  line: number,
  character: number,
  _uri: string,
  index: WorkspaceIndex,
): CompletionItem[] {
  const node = nodeAtPosition(tree, line, character);
  if (!node) return [];

  const ctx = detectCompletionContext(node);
  if (!ctx) return [];

  return completionsForContext(ctx, index, tree);
}

// ---------- Context detection ----------

type CompletionContext =
  | { kind: "source_target"; blockType: "source" | "target" }
  | { kind: "spread" }
  | { kind: "metadata" }
  | { kind: "pipe_chain" }
  | { kind: "import_name" }
  | { kind: "namespace_member"; nsName: string }
  | { kind: "arrow_source"; schemas: string[] }
  | { kind: "arrow_target"; schemas: string[] };

function detectCompletionContext(node: SyntaxNode): CompletionContext | null {
  let current: SyntaxNode | null = node;

  while (current) {
    // Inside a source block body → suggest schema names
    if (current.type === "source_block") {
      return { kind: "source_target", blockType: "source" };
    }

    // Inside a target block body → suggest schema names
    if (current.type === "target_block") {
      return { kind: "source_target", blockType: "target" };
    }

    // Inside metadata block → suggest vocabulary tokens
    if (current.type === "metadata_block") {
      return { kind: "metadata" };
    }

    // Inside a pipe chain → suggest transform functions
    if (current.type === "pipe_chain" || current.type === "_arrow_transform_body") {
      return { kind: "pipe_chain" };
    }

    // Fragment spread context
    if (current.type === "fragment_spread" || current.type === "spread_label") {
      return { kind: "spread" };
    }

    // Import declaration → suggest block names
    if (current.type === "import_decl") {
      // Check if cursor is after "from" (in import path) or between { }
      const importPath = child(current, "import_path");
      if (importPath && isInsideNode(node, importPath)) {
        // Inside import path — file path completions (deferred)
        return null;
      }
      return { kind: "import_name" };
    }

    // Arrow source/target path → suggest field names
    if (current.type === "src_path") {
      const schemas = findMappingSchemas(current, "source");
      if (schemas.length > 0) {
        return { kind: "arrow_source", schemas };
      }
    }

    if (current.type === "tgt_path") {
      const schemas = findMappingSchemas(current, "target");
      if (schemas.length > 0) {
        return { kind: "arrow_target", schemas };
      }
    }

    // Mapping body (but not inside a specific block) — could be arrow context
    if (current.type === "mapping_body") {
      // Check if the node text looks like a partial arrow path
      // If we're just at a bare identifier inside mapping_body, offer field completions
      const schemas = findMappingSchemasFromBody(current, "source");
      if (schemas.length > 0) {
        return { kind: "arrow_source", schemas };
      }
    }

    current = current.parent;
  }

  return null;
}

// ---------- Completion generators ----------

function completionsForContext(
  ctx: CompletionContext,
  index: WorkspaceIndex,
  _tree: Tree,
): CompletionItem[] {
  switch (ctx.kind) {
    case "source_target":
      return schemaCompletions(index);

    case "spread":
      return spreadCompletions(index);

    case "metadata":
      return metadataCompletions();

    case "pipe_chain":
      return pipeChainCompletions(index);

    case "import_name":
      return importNameCompletions(index);

    case "namespace_member":
      return namespaceMemberCompletions(index, ctx.nsName);

    case "arrow_source":
      return fieldCompletions(index, ctx.schemas);

    case "arrow_target":
      return fieldCompletions(index, ctx.schemas);
  }
}

function schemaCompletions(index: WorkspaceIndex): CompletionItem[] {
  return allBlockNames(index, "schema").map(({ name, entry }) => ({
    label: name,
    kind: CompletionItemKind.Class,
    detail: `schema (${entry.fields.length} fields)`,
  }));
}

function spreadCompletions(index: WorkspaceIndex): CompletionItem[] {
  const items: CompletionItem[] = [];

  for (const { name, entry } of allBlockNames(index, "fragment")) {
    items.push({
      label: name,
      kind: CompletionItemKind.Interface,
      detail: `fragment (${entry.fields.length} fields)`,
    });
  }

  for (const { name } of allBlockNames(index, "transform")) {
    items.push({
      label: name,
      kind: CompletionItemKind.Function,
      detail: "transform",
    });
  }

  return items;
}

function metadataCompletions(): CompletionItem[] {
  return METADATA_TOKENS.map((t) => ({
    label: t.name,
    kind: CompletionItemKind.Keyword,
    detail: t.description,
  }));
}

function pipeChainCompletions(index: WorkspaceIndex): CompletionItem[] {
  const items: CompletionItem[] = TRANSFORM_FUNCTIONS.map((t) => ({
    label: t.name,
    kind: CompletionItemKind.Function,
    detail: t.description,
    insertText: t.snippet ?? t.name,
  }));

  // Also offer transform/fragment spreads
  for (const { name } of allBlockNames(index, "transform")) {
    items.push({
      label: `...${name}`,
      kind: CompletionItemKind.Function,
      detail: "transform spread",
    });
  }

  return items;
}

function importNameCompletions(index: WorkspaceIndex): CompletionItem[] {
  const items: CompletionItem[] = [];
  const kindMap: Record<string, CompletionItemKind> = {
    schema: CompletionItemKind.Class,
    fragment: CompletionItemKind.Interface,
    transform: CompletionItemKind.Function,
    mapping: CompletionItemKind.Function,
    metric: CompletionItemKind.Constant,
    namespace: CompletionItemKind.Module,
  };

  for (const { name, entry } of allBlockNames(index)) {
    items.push({
      label: name,
      kind: kindMap[entry.kind] ?? CompletionItemKind.Text,
      detail: entry.kind,
    });
  }

  return items;
}

function namespaceMemberCompletions(
  index: WorkspaceIndex,
  nsName: string,
): CompletionItem[] {
  const items: CompletionItem[] = [];
  const prefix = `${nsName}::`;

  for (const { name, entry } of allBlockNames(index)) {
    if (name.startsWith(prefix)) {
      const shortName = name.slice(prefix.length);
      items.push({
        label: shortName,
        kind: CompletionItemKind.Class,
        detail: `${entry.kind} in ${nsName}`,
      });
    }
  }

  return items;
}

function fieldCompletions(
  index: WorkspaceIndex,
  schemas: string[],
): CompletionItem[] {
  const items: CompletionItem[] = [];
  const seen = new Set<string>();

  for (const schemaName of schemas) {
    const fields = getFields(index, schemaName, null);
    addFieldItems(items, fields, seen);
  }

  return items;
}

function addFieldItems(
  items: CompletionItem[],
  fields: FieldInfo[],
  seen: Set<string>,
): void {
  for (const f of fields) {
    if (seen.has(f.name)) continue;
    seen.add(f.name);
    items.push({
      label: f.name,
      kind: CompletionItemKind.Field,
      detail: f.type ?? undefined,
    });
  }
}

// ---------- Mapping schema helpers ----------

function findMappingSchemas(
  pathNode: SyntaxNode,
  blockType: "source" | "target",
): string[] {
  // Walk up to find the enclosing mapping_body
  let current: SyntaxNode | null = pathNode.parent;
  while (current) {
    if (current.type === "mapping_body") {
      return findMappingSchemasFromBody(current, blockType);
    }
    current = current.parent;
  }
  return [];
}

function findMappingSchemasFromBody(
  body: SyntaxNode,
  blockType: "source" | "target",
): string[] {
  const targetType = blockType === "source" ? "source_block" : "target_block";
  const schemas: string[] = [];

  for (const ch of body.namedChildren) {
    if (ch.type === targetType) {
      // Extract source_ref children
      for (const ref of ch.namedChildren) {
        if (ref.type === "source_ref") {
          const name = sourceRefStructuralText(ref);
          if (name) schemas.push(name);
        }
      }
    }
  }

  return schemas;
}

function isInsideNode(inner: SyntaxNode, outer: SyntaxNode): boolean {
  const iStart = inner.startIndex;
  const iEnd = inner.endIndex;
  return iStart >= outer.startIndex && iEnd <= outer.endIndex;
}

// ---------- Vocabulary constants ----------

const METADATA_TOKENS: Array<{ name: string; description: string }> = [
  { name: "pk", description: "Primary key" },
  { name: "required", description: "Field must not be null" },
  { name: "optional", description: "Field may be null" },
  { name: "unique", description: "Values must be unique" },
  { name: "indexed", description: "Field is indexed" },
  { name: "pii", description: "Personally identifiable information" },
  { name: "encrypt", description: "Field requires encryption" },
  { name: "enum", description: "Enumerated values" },
  { name: "default", description: "Default value" },
  { name: "format", description: "Value format constraint" },
  { name: "ref", description: "Foreign key reference" },
  { name: "xpath", description: "XPath selector for XML sources" },
  { name: "filter", description: "Row filter condition" },
  { name: "note", description: "Annotation note" },
  { name: "scd", description: "Slowly changing dimension" },
  { name: "scd2", description: "SCD Type 2 with history" },
  { name: "deprecated", description: "Deprecated field" },
  { name: "sensitive", description: "Sensitive data" },
  { name: "computed", description: "Derived/calculated value" },
  { name: "nullable", description: "Explicitly allows null" },
  { name: "immutable", description: "Cannot change after creation" },
  { name: "datavault", description: "Data Vault pattern" },
  { name: "hub", description: "Data Vault hub entity" },
  { name: "satellite", description: "Data Vault satellite entity" },
  { name: "link", description: "Data Vault link entity" },
  { name: "hashkey", description: "Hash key for Data Vault" },
  { name: "watermark", description: "Incremental load watermark" },
  { name: "late_arrival", description: "Handles late-arriving data" },
  { name: "dedup", description: "Deduplication strategy" },
  { name: "source", description: "Source schema for metrics" },
];

const TRANSFORM_FUNCTIONS: Array<{ name: string; description: string; snippet?: string }> = [
  { name: "trim", description: "Remove leading/trailing whitespace" },
  { name: "lowercase", description: "Convert to lowercase" },
  { name: "uppercase", description: "Convert to uppercase" },
  { name: "title_case", description: "Convert to title case" },
  { name: "coalesce", description: "Use first non-null value", snippet: "coalesce($1)" },
  { name: "round", description: "Round to N decimal places", snippet: "round($1)" },
  { name: "split", description: "Split string by separator", snippet: "split($1)" },
  { name: "first", description: "Take first element" },
  { name: "last", description: "Take last element" },
  { name: "to_utc", description: "Convert to UTC timezone" },
  { name: "to_iso8601", description: "Format as ISO 8601" },
  { name: "parse", description: "Parse with format string", snippet: "parse($1)" },
  { name: "to_number", description: "Convert to numeric type" },
  { name: "validate_email", description: "Validate email format" },
  { name: "escape_html", description: "Escape HTML entities" },
  { name: "truncate", description: "Truncate to N characters", snippet: "truncate($1)" },
  { name: "prepend", description: "Prepend a string", snippet: "prepend($1)" },
  { name: "max_length", description: "Enforce maximum length", snippet: "max_length($1)" },
  { name: "now_utc", description: "Current UTC timestamp", snippet: "now_utc()" },
  { name: "null_if_empty", description: "Null if empty string" },
  { name: "null_if_invalid", description: "Null if invalid value" },
  { name: "drop_if_invalid", description: "Drop row if invalid" },
  { name: "drop_if_null", description: "Drop row if null" },
  { name: "warn_if_null", description: "Warn if null" },
  { name: "warn_if_invalid", description: "Warn if invalid" },
  { name: "error_if_null", description: "Error if null" },
  { name: "error_if_invalid", description: "Error if invalid" },
  { name: "md5", description: "MD5 hash" },
];
