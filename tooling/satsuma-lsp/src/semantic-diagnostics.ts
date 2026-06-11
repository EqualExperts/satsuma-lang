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
    .filter((d) => d.code === "missing-import");
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
      rule: "missing-import",
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
    .filter((d) => d.code !== "missing-import");
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
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      // Track duplicates: if same name has multiple definitions
      if (i > 0) {
        const prev = entries[0]!;
        duplicates.push({
          kind: entry.kind,
          name,
          file: entry.uri,
          row: entry.range.start.line,
          previousKind: prev.kind,
          previousFile: prev.uri,
          previousRow: prev.range.start.line,
        });
      }

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
          if (!metrics.has(name)) {
            metrics.set(name, defEntryToMetric(name, entry, wsIndex));
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
