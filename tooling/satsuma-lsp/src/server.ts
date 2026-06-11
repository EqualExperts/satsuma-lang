import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  InitializeResult,
  FileChangeType,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { Tree } from "./parser-utils";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { getParser, initParser } from "./parser-utils";
import { setHighlightsSource } from "./semantic-tokens";
import { computeDiagnostics, ensureNonEmptyMessages } from "./diagnostics";
import { computeDocumentSymbols } from "./symbols";
import { computeFoldingRanges } from "./folding";
import { computeSemanticTokens, semanticTokensLegend } from "./semantic-tokens";
import { computeHover } from "./hover";
import { runValidate, reconcileValidateCache } from "./validate-diagnostics";
import { CanonicalUriMap } from "./canonical-uri-map";
import {
  WorkspaceIndex,
  createWorkspaceIndex,
  indexFile,
  removeFile,
  allBlockNames,
  resolveDefinition,
  findReferences,
  getImportReachableUris,
  createScopedIndex,
} from "./workspace-index";
import { computeSemanticValidationDiagnostics } from "./semantic-diagnostics";
import { computeDefinition } from "./definition";
import { computeReferences } from "./references";
import { computeCompletions } from "./completion";
import { computeCodeLenses } from "./codelens";
import { computeActionContext } from "./action-context";
import { prepareRename, computeRename } from "./rename";
import { computeFormatting, initFormatting } from "./formatting";
import { computeFullLineage } from "./full-lineage";
import { buildVizModel } from "@satsuma/viz-backend";
import { computeMappingCoverage } from "./coverage";
import { isSatsumaFilePath } from "@satsuma/core";
import { findSatsumaSourceFiles } from "./source-scan";

// ---------- Connection setup ----------

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// Per-document parse tree cache. Keyed by CANONICAL URI: the workspace index
// canonicalizes its keys, and a raw-keyed cache missed open files whenever
// the client's URI spelling differed (Windows drive letters, sl-ku3c).
const trees = new CanonicalUriMap<Tree>();

// Per-document validate diagnostics cache, canonical-keyed for the same reason.
const validateDiagCache = new CanonicalUriMap<import("vscode-languageserver").Diagnostic[]>();

// Workspace index for cross-file navigation
const wsIndex: WorkspaceIndex = createWorkspaceIndex();

// CLI path resolved at initialization
let cliPath = "satsuma";

// Workspace folders for file scanning
let workspaceFolders: string[] = [];

// ---------- Initialisation ----------

connection.onInitialize(async (params): Promise<InitializeResult> => {
  // Initialise WASM parser — the .wasm and highlights.scm live next to server.js.
  // locateFile tells web-tree-sitter where to find its own runtime WASM
  // (tree-sitter.wasm), which esbuild places next to server.js rather than at
  // the module-relative default path.
  const serverDir = __dirname;
  const wasmPath = path.join(serverDir, "tree-sitter-satsuma.wasm");
  const runtimeWasm = path.join(serverDir, "tree-sitter.wasm");
  const highlightsPath = path.join(serverDir, "highlights.scm");
  await initParser(wasmPath, { locateFile: () => runtimeWasm });
  await initFormatting();
  try {
    setHighlightsSource(fs.readFileSync(highlightsPath, "utf-8"));
  } catch {
    // highlights.scm missing — semantic tokens will be unavailable
  }

  // Accept CLI path from client initialization options
  const initOptions = params.initializationOptions;
  if (initOptions?.cliPath && typeof initOptions.cliPath === "string") {
    cliPath = initOptions.cliPath;
  }

  // Capture workspace folders
  if (params.workspaceFolders) {
    workspaceFolders = params.workspaceFolders.map((f) => fileURLToPath(f.uri));
  } else if (params.rootUri) {
    workspaceFolders = [fileURLToPath(params.rootUri)];
  }

  return {
    capabilities: {
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Full,
        save: true,
      },
      documentSymbolProvider: true,
      foldingRangeProvider: true,
      semanticTokensProvider: {
        legend: semanticTokensLegend,
        full: true,
      },
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      completionProvider: {
        triggerCharacters: ["|", ".", ":", "{"],
        resolveProvider: false,
      },
      codeLensProvider: {
        resolveProvider: false,
      },
      renameProvider: {
        prepareProvider: true,
      },
      documentFormattingProvider: true,
    },
  };
});

// Index workspace files after initialization
connection.onInitialized(() => {
  for (const folder of workspaceFolders) {
    indexWorkspaceFolder(folder);
  }
});

// ---------- Document lifecycle ----------

documents.onDidChangeContent((change) => {
  const tree = parseDocument(change.document);
  trees.set(change.document.uri, tree);

  // Update workspace index for the open document
  indexFile(wsIndex, change.document.uri, tree);

  // Recompute parse diagnostics and merge with cached validate diagnostics
  sendMergedDiagnostics(change.document.uri, tree);
});

documents.onDidClose((event) => {
  trees.delete(event.document.uri);
  validateDiagCache.delete(event.document.uri);
  // The index may hold modified-but-unsaved buffer content the user just
  // discarded by closing; re-index from what is actually on disk (sl-0tgo).
  reindexFromDisk(event.document.uri);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

/**
 * Replace a file's index entries with its on-disk content. Files that have no
 * on-disk presence (non-file schemes, deleted or never-saved files) are
 * removed from the index instead — their last indexed content no longer
 * corresponds to anything the user can navigate to.
 */
function reindexFromDisk(uri: string): void {
  const tree = parseTreeFromDisk(uri);
  if (tree) {
    indexFile(wsIndex, uri, tree);
  } else {
    removeFile(wsIndex, uri);
  }
}

/**
 * Parse a file straight from disk; null for non-file URIs, unreadable files,
 * or parser failures. Backs the loaders that must see files no editor has
 * open — e.g. full-lineage traversal over closed imports (sl-mg63).
 */
function parseTreeFromDisk(uri: string): Tree | null {
  try {
    const content = fs.readFileSync(fileURLToPath(uri), "utf-8");
    return getParser().parse(content) ?? null;
  } catch {
    return null;
  }
}

// Run satsuma validate on save
documents.onDidSave(async (event) => {
  // Re-index from the saved content
  const tree = trees.get(event.document.uri);
  if (tree) {
    indexFile(wsIndex, event.document.uri, tree);
  }

  try {
    const diagsByUri = await runValidate(event.document.uri, cliPath);

    // The run covers the saved file's whole import closure, so any file in
    // that closure with cached diagnostics the run no longer reports is
    // stale and must be cleared — fixing in file A an error attributed to
    // file B previously left B's diagnostic frozen until B itself was saved
    // (sl-th5k). Files outside the closure keep their cache entries.
    const scopeUris = getImportReachableUris(event.document.uri, wsIndex);
    const clearedUris = reconcileValidateCache(validateDiagCache, scopeUris, diagsByUri);

    // Republish every file the run touched: fresh results merged with parse
    // diagnostics for open documents, an explicit empty publish for cleared
    // files that are not open (nothing else would reach the client).
    const toRefresh = new Set([...diagsByUri.keys(), ...clearedUris, event.document.uri]);
    for (const uri of toRefresh) {
      const openTree = trees.get(uri);
      if (openTree) {
        sendMergedDiagnostics(uri, openTree);
      } else if (clearedUris.includes(uri)) {
        connection.sendDiagnostics({ uri, diagnostics: [] });
      }
    }
  } catch {
    // CLI not available or errored — parse diagnostics still work
  }
});

// Watch for Satsuma source file changes outside the editor. The client
// watches both registered extensions, so the gate must accept both — a
// bare .endsWith(".stm") check silently dropped .satsuma events (sl-v215).
connection.onDidChangeWatchedFiles((params) => {
  const parser = getParser();
  for (const change of params.changes) {
    if (!isSatsumaFilePath(change.uri)) continue;

    if (change.type === FileChangeType.Deleted) {
      removeFile(wsIndex, change.uri);
    } else {
      // Created or changed — re-index from disk
      // Skip if the file is open in the editor (onDidChangeContent handles it)
      if (trees.has(change.uri)) continue;

      try {
        const fsPath = fileURLToPath(change.uri);
        const content = fs.readFileSync(fsPath, "utf-8");
        const tree = parser.parse(content);
        if (tree) indexFile(wsIndex, change.uri, tree);
      } catch {
        // File unreadable — skip
      }
    }
  }
});

// ---------- Feature handlers ----------

connection.onDocumentSymbol((params) => {
  const tree = trees.get(params.textDocument.uri);
  if (!tree) return [];
  return computeDocumentSymbols(tree);
});

connection.onFoldingRanges((params) => {
  const tree = trees.get(params.textDocument.uri);
  if (!tree) return [];
  return computeFoldingRanges(tree);
});

connection.onRequest("textDocument/semanticTokens/full", (params) => {
  const tree = trees.get(params.textDocument.uri);
  if (!tree) return { data: [] };
  return computeSemanticTokens(tree);
});

connection.onHover((params) => {
  const tree = trees.get(params.textDocument.uri);
  if (!tree) return null;
  return computeHover(tree, params.position.line, params.position.character);
});

connection.onDefinition((params) => {
  const uri = params.textDocument.uri;
  const tree = trees.get(uri);
  if (!tree) return null;
  return computeDefinition(
    tree,
    params.position.line,
    params.position.character,
    uri,
    scopeIndex(uri),
  );
});

connection.onReferences((params) => {
  const uri = params.textDocument.uri;
  const tree = trees.get(uri);
  if (!tree) return [];
  return computeReferences(
    tree,
    params.position.line,
    params.position.character,
    uri,
    scopeIndex(uri),
    params.context.includeDeclaration,
  );
});

connection.onCompletion((params) => {
  const uri = params.textDocument.uri;
  const tree = trees.get(uri);
  if (!tree) return [];
  return computeCompletions(
    tree,
    params.position.line,
    params.position.character,
    uri,
    scopeIndex(uri),
  );
});

connection.onPrepareRename((params) => {
  const uri = params.textDocument.uri;
  const tree = trees.get(uri);
  if (!tree) return null;
  return prepareRename(
    tree,
    params.position.line,
    params.position.character,
    uri,
    scopeIndex(uri),
  );
});

connection.onRenameRequest((params) => {
  const uri = params.textDocument.uri;
  const tree = trees.get(uri);
  if (!tree) return null;
  return computeRename(
    tree,
    params.position.line,
    params.position.character,
    uri,
    scopeIndex(uri),
    params.newName,
  );
});

connection.onCodeLens((params) => {
  const uri = params.textDocument.uri;
  const tree = trees.get(uri);
  if (!tree) return [];
  return computeCodeLenses(tree, uri, scopeIndex(uri));
});

connection.onDocumentFormatting((params) => {
  const tree = trees.get(params.textDocument.uri);
  if (!tree) return [];
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  return computeFormatting(tree, doc.getText());
});

// ---------- Custom requests ----------

/** Return all block names from the workspace index (for command QuickPicks). */
connection.onRequest("satsuma/blockNames", () => {
  return allBlockNames(wsIndex).map(({ name, entry }) => ({
    name,
    kind: entry.kind,
    uri: entry.uri,
  }));
});

/** Return the VizModel for a document (for mapping visualization). */
connection.onRequest(
  "satsuma/vizModel",
  (params: { uri: string }) => {
    const tree = trees.get(params.uri);
    if (!tree) return null;
    return buildVizModel(params.uri, tree, scopeIndex(params.uri));
  },
);

/**
 * Return a merged VizModel spanning the full transitive lineage reachable from
 * the given file via import declarations. Each import-reachable file contributes
 * its schemas, mappings, metrics, and fragments — deduplicated so that stub
 * schemas are superseded by their full upstream definitions. Files that are not
 * open in any editor are parsed straight from disk, so the lineage really is
 * the full import closure, not just the open tabs (sl-mg63).
 */
connection.onRequest(
  "satsuma/vizFullLineage",
  (params: { uri: string }) => {
    return computeFullLineage(params.uri, wsIndex, (uri) => trees.get(uri) ?? parseTreeFromDisk(uri));
  },
);

/** Return linked file URIs for cross-file lineage expansion in the viz. */
connection.onRequest(
  "satsuma/vizLinkedFiles",
  (params: { schemaId: string; currentUri: string }) => {
    const refs = findReferences(wsIndex, params.schemaId);
    const defs = resolveDefinition(wsIndex, params.schemaId, null);
    const uris = new Set<string>();
    for (const r of refs) {
      if (r.uri !== params.currentUri) uris.add(r.uri);
    }
    for (const d of defs) {
      if (d.uri !== params.currentUri) uris.add(d.uri);
    }
    return [...uris];
  },
);

/** Return field locations for a schema/fragment (for coverage decorations). */
connection.onRequest(
  "satsuma/fieldLocations",
  (params: { name: string }) => {
    const defs = resolveDefinition(wsIndex, params.name, null);
    if (defs.length === 0) return [];
    const def = defs[0]!;
    const result: { name: string; uri: string; line: number }[] = [];
    function collect(fields: typeof def.fields, prefix: string): void {
      for (const f of fields) {
        const dotPath = prefix ? `${prefix}.${f.name}` : f.name;
        result.push({ name: dotPath, uri: def.uri, line: f.range.start.line });
        if (f.children.length > 0) collect(f.children, dotPath);
      }
    }
    collect(def.fields, "");
    return result;
  },
);

/** Return per-field coverage for both source and target schemas of a mapping. */
connection.onRequest(
  "satsuma/mappingCoverage",
  (params: { uri: string; mappingName: string }) => {
    const tree = trees.get(params.uri);
    if (!tree) return { schemas: [] };
    return computeMappingCoverage(params.uri, tree, params.mappingName, scopeIndex(params.uri));
  },
);

connection.onRequest(
  "satsuma/actionContext",
  (params: {
    uri: string;
    position: {
      line: number;
      character: number;
    };
  }) => {
    const tree = trees.get(params.uri);
    if (!tree) return { schemaName: null, fieldPath: null };
    return computeActionContext(
      tree,
      params.position.line,
      params.position.character,
      params.uri,
      wsIndex,
    );
  },
);

// ---------- Helpers ----------

function parseDocument(doc: TextDocument): Tree {
  const parser = getParser();
  const tree = parser.parse(doc.getText());
  if (!tree) throw new Error("parse returned null");
  return tree;
}

/** Build a workspace index scoped to the import-reachable files of `uri`. */
function scopeIndex(uri: string): WorkspaceIndex {
  return createScopedIndex(wsIndex, getImportReachableUris(uri, wsIndex));
}

/**
 * Send parse diagnostics merged with cached validate diagnostics and the shared
 * core semantic validation adapter.
 *
 * Core semantic diagnostics run directly against the workspace index (no
 * subprocess). The CLI subprocess (validate-diagnostics.ts) provides
 * additional arrow-level and NL @ref checks that require full arrow
 * extraction not available from the LSP workspace index.
 */
function sendMergedDiagnostics(uri: string, tree: Tree): void {
  const parseDiags = computeDiagnostics(tree);
  const validateDiags = validateDiagCache.get(uri) ?? [];
  const semanticDiags = computeSemanticValidationDiagnostics(uri, wsIndex);

  // Deduplicate: core semantic diagnostics may overlap with CLI validate
  // diagnostics. Use rule + line as the dedup key, preferring CLI results
  // (they may have more precise position data from full file parsing).
  const validateKeys = new Set(
    validateDiags.map((d) => `${d.code}:${d.range.start.line}`),
  );
  const dedupedSemanticDiags = semanticDiags.filter(
    (d) => !validateKeys.has(`${d.code}:${d.range.start.line}`),
  );

  // Publish-boundary guard: an empty message crashes the VS Code client's
  // diagnostic conversion and freezes all diagnostics for the file (sl-sme1).
  connection.sendDiagnostics({
    uri,
    diagnostics: ensureNonEmptyMessages([
      ...parseDiags,
      ...validateDiags,
      ...dedupedSemanticDiags,
    ]),
  });
}

/** Recursively find all Satsuma source files in a directory and index them. */
function indexWorkspaceFolder(folderPath: string): void {
  const parser = getParser();
  const sourceFiles = findSatsumaSourceFiles(folderPath);

  for (const filePath of sourceFiles) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const tree = parser.parse(content);
      if (!tree) continue;
      const uri = pathToFileURL(filePath).toString();
      indexFile(wsIndex, uri, tree);
    } catch {
      // Unreadable file — skip
    }
  }
}

// ---------- Start ----------

documents.listen(connection);
connection.listen();
