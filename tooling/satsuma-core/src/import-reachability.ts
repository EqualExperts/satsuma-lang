/**
 * import-reachability.ts — Per-file symbol reachability from import declarations
 *
 * Implements ADR-022's "selective transitive import reachability" rule: an
 * imported symbol brings only itself and its exact transitive dependencies
 * into scope, not every definition from the transitively reachable files.
 *
 * The main export is computeImportReachability(). It accepts a SemanticIndex
 * (the full workspace index) and a per-file import map, and returns a
 * per-file set of symbol keys that are in scope for each file.
 *
 * Consumers (CLI validate, LSP diagnostics) use the resulting ImportReachability
 * to enforce import-scope checks without reimplementing the algorithm.
 *
 * This module does NOT own index construction or import path resolution —
 * those remain in the consumer's workspace/index-builder layer. It operates
 * purely on resolved data: qualified symbol keys and absolute file paths.
 */

import type { SemanticIndex } from "./validate.js";
import { resolveScopedEntityRef } from "./canonical-ref.js";

// ---------- Public types ----------

/**
 * A single resolved import declaration from one file.
 * Consumer layers (CLI, LSP) populate these by resolving the relative import
 * paths from extractImports() against the importing file's directory.
 */
export interface ResolvedFileImport {
  /** Symbol names as written in the import clause (bare or namespace-qualified). */
  names: string[];
  /** Absolute file path or URI of the imported file. */
  resolvedFile: string;
}

/**
 * Per-file symbol reachability computed from the import graph.
 * Each entry maps a file path/URI to the set of qualified symbol keys
 * that are in scope for entities defined in that file.
 */
export interface ImportReachability {
  /** file path → set of qualified symbol keys reachable from that file. */
  reachableSymbols: Map<string, Set<string>>;
}

// ---------- Entry point ----------

/**
 * Compute per-file symbol reachability from the import graph and workspace index.
 *
 * For each file F in the workspace, the reachable set includes:
 *   1. All symbols defined locally in F (always in scope).
 *   2. Symbols explicitly named in F's import declarations.
 *   3. Transitive dependencies of each imported symbol — e.g. a schema's
 *      spread fragments, a mapping's source/target schemas.
 *
 * When a file has no imports and is the only file in the workspace, all
 * symbols are local and therefore reachable — the check is a no-op.
 *
 * @param index       The full workspace SemanticIndex (all files merged).
 * @param fileImports Per-file resolved import declarations. Key is the
 *                    absolute file path; value is the list of imports.
 * @returns Per-file reachability sets.
 */
export function computeImportReachability(
  index: SemanticIndex,
  fileImports: Map<string, ResolvedFileImport[]>,
): ImportReachability {
  const fileToSymbols = buildFileToSymbols(index);
  const symbolDeps = computeSymbolDependencies(index);

  const reachableSymbols = new Map<string, Set<string>>();

  for (const [file] of fileToSymbols) {
    const reachable = new Set<string>();

    // 1. All locally-defined symbols are always in scope.
    const localSymbols = fileToSymbols.get(file) ?? new Set<string>();
    for (const sym of localSymbols) reachable.add(sym);

    // 2. Resolve imported symbol names to qualified keys and add them.
    const imports = fileImports.get(file) ?? [];
    const importedKeys = resolveImportNames(imports, fileToSymbols);
    for (const key of importedKeys) reachable.add(key);

    // 3. Add transitive dependencies of every imported symbol.
    const visited = new Set<string>();
    for (const key of importedKeys) {
      addTransitiveDeps(key, symbolDeps, visited, reachable);
    }

    reachableSymbols.set(file, reachable);
  }

  return { reachableSymbols };
}

// ---------- Symbol dependency graph ----------

/**
 * Build the intra-workspace dependency graph: for each symbol, which other
 * symbols does it directly reference?
 *
 * Dependency edges:
 *   - Schema → spread fragment names (resolved via namespace)
 *   - Fragment → spread fragment names
 *   - Mapping → source and target schema/fragment names
 *   - Metric → source schema names
 *
 * Transform dependencies (spread transforms in arrow steps) are not tracked
 * here because the SemanticIndex.transforms map is opaque (Map<string, unknown>).
 * Arrow-level transform spreads are validated separately in checkTransformSpreads.
 */
export function computeSymbolDependencies(index: SemanticIndex): Map<string, Set<string>> {
  const deps = new Map<string, Set<string>>();

  /** Ensure a deps entry exists and add a dependency edge. */
  function addDep(from: string, to: string): void {
    let edges = deps.get(from);
    if (!edges) {
      edges = new Set();
      deps.set(from, edges);
    }
    edges.add(to);
  }

  /** Ensure every known symbol has a deps entry, even if empty. */
  function ensureEntry(key: string): void {
    if (!deps.has(key)) deps.set(key, new Set());
  }

  // All definition maps that carry a qualified key in the index. Walk each
  // one and record its outgoing dependency edges.

  const allDefinitions = new Map<string, unknown>([...index.schemas, ...index.fragments]);

  // --- Schemas: depend on spread fragments ---
  for (const [key, schema] of index.schemas) {
    ensureEntry(key);
    const ns = schema.namespace ?? null;
    for (const spread of schema.spreads ?? []) {
      const resolved = resolveScopedEntityRef(spread, ns, index.fragments);
      if (resolved) addDep(key, resolved);
    }
  }

  // --- Fragments: depend on spread fragments ---
  for (const [key, fragment] of index.fragments) {
    ensureEntry(key);
    const ns = fragment.namespace ?? null;
    for (const spread of fragment.spreads ?? []) {
      const resolved = resolveScopedEntityRef(spread, ns, index.fragments);
      if (resolved) addDep(key, resolved);
    }
  }

  // --- Mappings: depend on source and target schemas/fragments ---
  for (const [key, mapping] of index.mappings) {
    ensureEntry(key);
    const ns = mapping.namespace ?? null;
    for (const src of mapping.sources) {
      const resolved = resolveScopedEntityRef(src, ns, allDefinitions);
      if (resolved) addDep(key, resolved);
    }
    for (const tgt of mapping.targets) {
      const resolved = resolveScopedEntityRef(tgt, ns, allDefinitions);
      if (resolved) addDep(key, resolved);
    }
  }

  // --- Metrics: depend on source schemas ---
  for (const [key, metric] of index.metrics) {
    ensureEntry(key);
    const ns = metric.namespace ?? null;
    for (const src of metric.sources ?? []) {
      const resolved = resolveScopedEntityRef(src, ns, index.schemas);
      if (resolved) addDep(key, resolved);
    }
  }

  // --- Transforms: no structural dependencies tracked at this level ---
  for (const key of index.transforms.keys()) {
    ensureEntry(key);
  }

  return deps;
}

// ---------- Helpers ----------

/**
 * Build a map from file path → set of qualified symbol keys defined in that file.
 * Scans all entity maps in the index AND the duplicates log, so that symbols
 * whose first definition was in file A and whose duplicate was in file B appear
 * under both files. Without this, import resolution for the "losing" duplicate
 * would fail to find the symbol in the file the user actually imported it from.
 */
function buildFileToSymbols(index: SemanticIndex): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();

  function add(file: string, key: string): void {
    let keys = result.get(file);
    if (!keys) {
      keys = new Set();
      result.set(file, keys);
    }
    keys.add(key);
  }

  // --- Primary definitions (the "winning" entry in each map) ---
  for (const [key, schema] of index.schemas) add(schema.file, key);
  for (const [key, fragment] of index.fragments) add(fragment.file, key);
  for (const [key, mapping] of index.mappings) add(mapping.file, key);
  for (const [key, metric] of index.metrics) add(metric.file, key);
  for (const [key, transform] of index.transforms) {
    // SemanticIndex.transforms is Map<string, unknown>, so we need a type
    // guard. The CLI's TransformRecord has a `file` field; the LSP adapter
    // stores `true`. Only record file associations when the value has a file.
    const val = transform as { file?: string };
    if (val.file) add(val.file, key);
  }

  // --- Duplicate definitions (the "losing" entries not in the primary maps) ---
  // Each duplicate record gives us a second file that defines the same name.
  // Both the duplicate's file and the previous (winning) file need to be
  // tracked so that imports from either file resolve correctly.
  for (const dup of index.duplicates ?? []) {
    if (dup.kind === "namespace-metadata") continue; // not a symbol definition
    add(dup.file, dup.name);
    add(dup.previousFile, dup.name);
  }

  return result;
}

/**
 * Resolve imported symbol names to qualified index keys.
 *
 * For each import declaration, tries to match each imported name against the
 * symbols defined in the imported file:
 *   - Qualified names ("ns::name") are matched directly.
 *   - Bare names ("name") match a symbol that equals the name or ends with "::name".
 */
function resolveImportNames(
  imports: ResolvedFileImport[],
  fileToSymbols: Map<string, Set<string>>,
): Set<string> {
  const resolved = new Set<string>();

  for (const imp of imports) {
    const targetSymbols = fileToSymbols.get(imp.resolvedFile);
    if (!targetSymbols) continue;

    for (const name of imp.names) {
      if (name.includes("::")) {
        // Qualified name: direct match
        if (targetSymbols.has(name)) {
          resolved.add(name);
        }
      } else {
        // Bare name: match exact or namespace-qualified variant
        if (targetSymbols.has(name)) {
          resolved.add(name);
        } else {
          for (const sym of targetSymbols) {
            if (sym.endsWith(`::${name}`)) {
              resolved.add(sym);
              break; // first match wins (ambiguity is a separate diagnostic)
            }
          }
        }
      }
    }
  }

  return resolved;
}

/**
 * Walk the dependency graph from a starting symbol, adding all transitively
 * reachable symbols to the `reachable` set. Uses `visited` for cycle safety.
 */
function addTransitiveDeps(
  symbol: string,
  deps: Map<string, Set<string>>,
  visited: Set<string>,
  reachable: Set<string>,
): void {
  if (visited.has(symbol)) return;
  visited.add(symbol);

  const directDeps = deps.get(symbol);
  if (!directDeps) return;

  for (const dep of directDeps) {
    reachable.add(dep);
    addTransitiveDeps(dep, deps, visited, reachable);
  }
}
