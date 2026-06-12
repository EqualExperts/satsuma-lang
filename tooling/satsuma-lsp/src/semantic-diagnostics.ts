/**
 * semantic-diagnostics.ts — LSP-specific semantic diagnostics
 *
 * Adapts the LSP/viz-backend workspace index into @satsuma/core's shared
 * semantic validation contract. Core owns rule order and import reachability;
 * this module owns only LSP-specific range/severity conversion and the
 * quick-fix-style message used for out-of-scope imports.
 *
 * Arrow field checks and NL @ref validation are still incomplete in the live
 * LSP path because the LSP workspace index does not maintain full arrow/NL
 * extraction data. The CLI subprocess (validate-diagnostics.ts) remains the
 * on-save fallback for those full-workspace checks.
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import {
  Diagnostic,
  DiagnosticSeverity,
} from "vscode-languageserver";
import type { Tree } from "./parser-utils";
import type { WorkspaceIndex, DefinitionEntry } from "./workspace-index";
import {
  buildImportSuggestion,
  canonicalizeFileUri,
  createScopedIndex,
  getImportReachableUris,
} from "./workspace-index";
import {
  validateSemanticWorkspace,
} from "@satsuma/core";
import type {
  SemanticIndex,
  SemanticSchema,
  SemanticFragment,
  SemanticMapping,
  SemanticMetric,
  SemanticDiagnostic,
  ResolvedFileImport,
  ImportScopeViolation,
} from "@satsuma/core";

/**
 * Rule id under which core's import-scope violations are reported. Shared by
 * the filters below that split diagnostics into the two scoping families.
 */
const MISSING_IMPORT_RULE = "missing-import";

// ---------- Scoped diagnostics entry point ----------

/**
 * Compute all semantic diagnostics the server should publish for an open
 * file, applying ADR-022 workspace scoping per rule family:
 *
 * - Core rules (duplicate definitions, undefined refs, …) run against the
 *   import-scoped index. An open file's workspace is the file plus its
 *   transitive imports — never the surrounding folder. Running these rules
 *   against the folder-wide index reported false duplicate-definition errors
 *   whenever two unrelated entry-point files shared a schema name (sl-rw3e).
 * - The missing-import rule runs against the folder-wide index. It is the one
 *   check that must see definitions OUTSIDE the closure: its job is to
 *   suggest the import that would bring an out-of-scope symbol into scope.
 *
 * `wsIndex` is the folder-wide index; the import-scoped view is derived here
 * so callers cannot pair mismatched indexes.
 */
export function computeScopedSemanticDiagnostics(
  uri: string,
  wsIndex: WorkspaceIndex,
): Diagnostic[] {
  const scoped = createScopedIndex(wsIndex, getImportReachableUris(uri, wsIndex));
  return [
    ...computeCoreSemanticDiagnostics(uri, scoped),
    ...computeSemanticValidationDiagnostics(uri, wsIndex).filter(
      (d) => d.code === MISSING_IMPORT_RULE,
    ),
  ];
}

// ---------- Missing-import diagnostics (LSP-specific) ----------

/**
 * Compute semantic diagnostics for import-scoping violations.
 *
 * Emits a `missing-import` error for any schema/fragment/mapping/metric name
 * that is referenced in this file (as a source, target, spread, or metric
 * source) and exists elsewhere in the workspace index but is NOT reachable
 * from this file's import graph at the symbol level.
 *
 * Uses satsuma-core's computeImportReachability for symbol-level precision:
 * importing a symbol brings only that symbol and its transitive dependencies
 * into scope, not every definition from the imported file (ADR-022).
 *
 * Symbols that don't exist anywhere (typos, etc.) are not flagged here —
 * those are handled by core semantic diagnostics or the CLI fallback.
 */
export function computeMissingImportDiagnostics(
  _tree: Tree,
  uri: string,
  wsIndex: WorkspaceIndex,
): Diagnostic[] {
  return computeSemanticValidationDiagnostics(uri, wsIndex)
    .filter((d) => d.code === MISSING_IMPORT_RULE);
}

// ---------- Core semantic diagnostics (adapter) ----------

/**
 * Run the shared core semantic validation pipeline against the LSP workspace
 * index and return diagnostics for the specified file.
 */
export function computeSemanticValidationDiagnostics(
  uri: string,
  wsIndex: WorkspaceIndex,
): Diagnostic[] {
  // The index stores canonical URI keys; the client may send another spelling
  // of the same file (e.g. percent-encoded Windows drive colon). Canonicalize
  // before comparing, or this file's diagnostics never match it (sl-akz6).
  uri = canonicalizeFileUri(uri);
  const fileImports = buildFileImportsMap(wsIndex);
  const semanticIndex = buildSemanticIndex(wsIndex);
  const coreDiags = validateSemanticWorkspace(semanticIndex, {
    fileImports,
    importScopeDiagnostic: {
      rule: MISSING_IMPORT_RULE,
      message: (violation) => missingImportMessage(uri, violation),
    },
  });

  // Filter to diagnostics for the specified file and convert to LSP format
  return coreDiags
    .filter((d) => d.file === uri)
    .map(semanticDiagToLsp);
}

/**
 * Backward-compatible wrapper kept for tests and call sites that still name
 * the old adapter. It now uses the unified core validation entry point.
 */
export function computeCoreSemanticDiagnostics(
  uri: string,
  wsIndex: WorkspaceIndex,
): Diagnostic[] {
  return computeSemanticValidationDiagnostics(uri, wsIndex)
    .filter((d) => d.code !== MISSING_IMPORT_RULE);
}

function missingImportMessage(uri: string, violation: ImportScopeViolation): string {
  const defUri = violation.definitionFile ?? uri;
  const suggestion = buildImportSuggestion(uri, violation.resolved, defUri);
  return `'${violation.resolved}' is not imported. Add: ${suggestion}`;
}

/** Map a core SemanticDiagnostic to an LSP Diagnostic. */
function semanticDiagToLsp(d: SemanticDiagnostic): Diagnostic {
  // Core positions are 1-indexed; LSP is 0-indexed
  const line = Math.max(0, d.line - 1);
  const col = Math.max(0, d.column - 1);
  return {
    range: { start: { line, character: col }, end: { line, character: col } },
    severity: d.severity === "error" ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
    code: d.rule,
    source: "satsuma",
    message: d.message,
  };
}

// ---------- File imports map builder ----------

/**
 * Convert the LSP WorkspaceIndex's import entries into the core's
 * ResolvedFileImport format. Resolves relative import paths to absolute
 * file URIs using the importing file's directory as the base.
 */
function buildFileImportsMap(
  wsIndex: WorkspaceIndex,
): Map<string, ResolvedFileImport[]> {
  const result = new Map<string, ResolvedFileImport[]>();

  for (const [importerUri, entries] of wsIndex.imports) {
    const resolved: ResolvedFileImport[] = [];
    for (const entry of entries) {
      if (!entry.pathText) continue;
      const resolvedUri = resolveImportPathToUri(importerUri, entry.pathText);
      if (resolvedUri) {
        resolved.push({ names: entry.names, resolvedFile: resolvedUri });
      }
    }
    result.set(importerUri, resolved);
  }

  return result;
}

/** Resolve a relative import path to an absolute file URI. Returns null on failure.
 *  Canonicalized so it compares equal to the index's canonical keys (sl-akz6). */
function resolveImportPathToUri(importerUri: string, pathText: string): string | null {
  try {
    const importerPath = fileURLToPath(importerUri);
    const importerDir = dirname(importerPath);
    return canonicalizeFileUri(pathToFileURL(resolve(importerDir, pathText)).toString());
  } catch {
    return null;
  }
}

// ---------- SemanticIndex adapter ----------
//
// Builds a core SemanticIndex from the LSP WorkspaceIndex. The LSP index
// stores definitions by name → DefinitionEntry[], so we map each entry to
// the core's expected SemanticSchema/SemanticFragment/etc. shape.
//
// Limitations:
// - fieldArrows: not available (LSP tracks field refs but not arrow records)
// - nlRefData: not available (LSP does not extract NL ref data)
// - duplicates: detected by counting multiple definitions per name

/** Build a SemanticIndex from the LSP WorkspaceIndex for core validation. */
function buildSemanticIndex(wsIndex: WorkspaceIndex): SemanticIndex {
  const schemas = new Map<string, SemanticSchema>();
  const fragments = new Map<string, SemanticFragment>();
  const mappings = new Map<string, SemanticMapping>();
  const metrics = new Map<string, SemanticMetric>();
  const transforms = new Map<string, unknown>();
  const duplicates: Array<{
    kind: string; name: string; file: string; row: number;
    previousKind: string; previousFile: string; previousRow: number;
  }> = [];

  for (const [name, entries] of wsIndex.definitions) {
    // Track duplicates: if same name has multiple definitions. Each
    // conflict is recorded in BOTH directions, attributing a diagnostic to
    // each definition site: published diagnostics are filtered to the open
    // file, and under import-closure scoping (sl-rw3e) either site may be
    // the open one — e.g. when the open file's definition was indexed first
    // and a file it imports redefines the name, the one-directional record
    // pointed at the imported file and the conflict never surfaced.
    //
    // Namespace blocks are exempt: reopening a namespace — the same name in
    // multiple blocks or files — is the language's mechanism for spreading a
    // namespace across files (Feature 15), never a collision. The index
    // registers every block as a definition entry so navigation works, but
    // only non-namespace entries can collide (sl-padl). Conflicting
    // namespace METADATA is a separate rule (namespace-metadata-conflict)
    // surfaced by the CLI on-save validate fallback.
    const collidable = entries.filter((e) => e.kind !== "namespace");
    for (let i = 1; i < collidable.length; i++) {
      const entry = collidable[i]!;
      const prev = collidable[0]!;
      duplicates.push({
        kind: entry.kind,
        name,
        file: entry.uri,
        row: entry.range.start.line,
        previousKind: prev.kind,
        previousFile: prev.uri,
        previousRow: prev.range.start.line,
      });
      duplicates.push({
        kind: prev.kind,
        name,
        file: prev.uri,
        row: prev.range.start.line,
        previousKind: entry.kind,
        previousFile: entry.uri,
        previousRow: entry.range.start.line,
      });
    }

    for (const entry of entries) {
      switch (entry.kind) {
        case "schema":
          if (!schemas.has(name)) {
            schemas.set(name, defEntryToSchema(name, entry));
          }
          break;
        case "fragment":
          if (!fragments.has(name)) {
            fragments.set(name, defEntryToFragment(name, entry));
          }
          break;
        case "mapping":
          if (!mappings.has(name)) {
            mappings.set(name, defEntryToMapping(name, entry, wsIndex));
          }
          break;
        case "metric":
          // A v2 metric is a schema_block decorated with the (metric) tag,
          // so it is BOTH a metric and a schema: mappings may target it like
          // any other schema, and core resolves mapping refs against the
          // schemas map. The CLI index-builder records metric schemas in
          // both maps; the adapter must match or qualified metric targets
          // report false undefined-refs (lnd-qqo7).
          if (!metrics.has(name)) {
            metrics.set(name, defEntryToMetric(name, entry, wsIndex));
          }
          if (!schemas.has(name)) {
            schemas.set(name, defEntryToSchema(name, entry));
          }
          break;
        case "transform":
          if (!transforms.has(name)) {
            transforms.set(name, { file: entry.uri });
          }
          break;
      }
    }
  }

  return {
    schemas,
    fragments,
    mappings,
    metrics,
    transforms,
    fieldArrows: new Map(),   // Not available from LSP workspace index
    duplicates,
  };
}

/** Convert a DefinitionEntry with kind "schema" to a SemanticSchema. */
function defEntryToSchema(name: string, entry: DefinitionEntry): SemanticSchema {
  const ns = entry.namespace ?? undefined;
  return {
    name: ns ? name.split("::").pop()! : name,
    namespace: ns,
    file: entry.uri,
    row: entry.range.start.line,
    fields: entry.fields.map((f) => ({
      name: f.name,
      type: f.type ?? "",
      children: f.children.map((c) => ({ name: c.name, type: c.type ?? "" })),
    })),
  };
}

/** Convert a DefinitionEntry with kind "fragment" to a SemanticFragment. */
function defEntryToFragment(name: string, entry: DefinitionEntry): SemanticFragment {
  const ns = entry.namespace ?? undefined;
  return {
    name: ns ? name.split("::").pop()! : name,
    namespace: ns,
    file: entry.uri,
    row: entry.range.start.line,
    fields: entry.fields.map((f) => ({
      name: f.name,
      type: f.type ?? "",
      children: f.children.map((c) => ({ name: c.name, type: c.type ?? "" })),
    })),
  };
}

/**
 * Convert a DefinitionEntry with kind "mapping" to a SemanticMapping.
 * Sources and targets are derived from the workspace index references.
 */
function defEntryToMapping(
  name: string,
  entry: DefinitionEntry,
  wsIndex: WorkspaceIndex,
): SemanticMapping {
  // Gather source/target refs belonging to THIS mapping, matched by the
  // container identity recorded at index time. Filtering by file alone made
  // every mapping inherit every other mapping's refs, duplicating and
  // misattributing undefined-ref diagnostics in multi-mapping files (sl-ei1e).
  const sources: string[] = [];
  const targets: string[] = [];
  for (const [refName, refs] of wsIndex.references) {
    for (const ref of refs) {
      if (ref.uri !== entry.uri || ref.container !== name) continue;
      if (ref.context === "source") {
        if (!sources.includes(refName)) sources.push(refName);
      } else if (ref.context === "target") {
        if (!targets.includes(refName)) targets.push(refName);
      }
    }
  }

  return {
    name: entry.namespace ? name.split("::").pop()! : name,
    namespace: entry.namespace ?? undefined,
    file: entry.uri,
    row: entry.range.start.line,
    sources,
    targets,
  };
}

/** Convert a DefinitionEntry with kind "metric" to a SemanticMetric. */
function defEntryToMetric(
  name: string,
  entry: DefinitionEntry,
  wsIndex: WorkspaceIndex,
): SemanticMetric {
  // Matched by container identity, not just file — see defEntryToMapping
  // (sl-ei1e applies equally to metric_source refs).
  const sources: string[] = [];
  for (const [refName, refs] of wsIndex.references) {
    for (const ref of refs) {
      if (ref.uri !== entry.uri || ref.container !== name) continue;
      if (ref.context === "metric_source" && !sources.includes(refName)) {
        sources.push(refName);
      }
    }
  }

  return {
    namespace: entry.namespace ?? undefined,
    file: entry.uri,
    row: entry.range.start.line,
    sources,
  };
}
