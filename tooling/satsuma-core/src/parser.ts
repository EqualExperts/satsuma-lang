/**
 * parser.ts — Singleton WASM parser for Satsuma.
 *
 * Owns the single Parser and Language instance shared across all commands or
 * LSP handlers within a process.  Callers must await initParser() once at
 * startup before any call to getParser() or getLanguage().
 *
 * Why a singleton?  web-tree-sitter's WASM module initialisation is async and
 * expensive (~50 ms).  Keeping one parser instance and re-using it for every
 * parse call avoids re-paying that cost per file.
 *
 * Why in @satsuma/core?  initParser() used to be duplicated in satsuma-cli and
 * vscode-satsuma/server with nearly identical logic.  Moving it here gives
 * both consumers a single tested implementation, and makes the parser
 * available to future tools that import @satsuma/core without CLI or LSP deps.
 *
 * Singleton lifecycle:
 *   1. Call initParser(wasmPath) once.  It is idempotent — subsequent calls
 *      return the same Promise and leave the parser unchanged.
 *   2. After the Promise resolves, getParser() and getLanguage() are safe to
 *      call synchronously from anywhere in the same process.
 *   3. There is no teardown — the singleton lives for the process lifetime.
 */

import type {
  Parser,
  Language,
  Node as WebTreeSitterNode,
  ParseCallback,
  ParseOptions,
  Query,
  Tree as WebTreeSitterTree,
} from "web-tree-sitter";
import type { SyntaxNode, Tree } from "./types.js";

// ── Audited external-type boundary ─────────────────────────────────────────

/**
 * A concrete web-tree-sitter node whose discriminant follows the generated
 * Satsuma grammar contract.
 *
 * The runtime object remains the original web-tree-sitter Node. The
 * intersection adds the smaller parser-independent core contract so consumers
 * can retain concrete navigation APIs while CST comparisons are type-checked.
 */
export type ParsedSatsumaNode = WebTreeSitterNode & SyntaxNode;

/** A concrete web-tree-sitter tree with a generated-symbol-typed root node. */
export type ParsedSatsumaTree = Omit<WebTreeSitterTree, "rootNode"> &
  Tree & {
    readonly rootNode: ParsedSatsumaNode;
  };

/**
 * The shared parser surface returned to Satsuma consumers.
 *
 * web-tree-sitter correctly exposes Node.type as string because it serves any
 * grammar. Once this singleton has loaded the Satsuma WASM, parse results can
 * only contain generated Satsuma symbols plus ERROR recovery nodes. The
 * narrowed parse result records that runtime invariant at this one boundary.
 */
export type SatsumaParser = Omit<Parser, "parse"> & {
  parse(
    callback: string | ParseCallback,
    oldTree?: WebTreeSitterTree | null,
    options?: ParseOptions,
  ): ParsedSatsumaTree | null;
};

/**
 * Narrow the grammar-agnostic parser after the Satsuma language is installed.
 *
 * This is the only assertion needed for ordinary parser output. Extraction and
 * formatting code consume the resulting contract without local casts.
 */
function asSatsumaParser(parser: Parser): SatsumaParser {
  return parser as SatsumaParser;
}

// ── Singleton state ─────────────────────────────────────────────────────────

let _parser: SatsumaParser | null = null;
let _language: Language | null = null;

// Retained so that createQuery() can construct Query instances from the same
// WASM module that Parser.init() loaded — avoiding the duplicate-module
// problem that occurs when consumers bundle web-tree-sitter separately.
let _TreeSitter: typeof import("web-tree-sitter") | null = null;

// Stored so that re-entrant calls to initParser() return the same Promise
// instead of starting a second initialisation race.
let _initPromise: Promise<void> | null = null;

// ── Public options type ─────────────────────────────────────────────────────

/**
 * Options for initParser().
 */
export interface ParserInitOptions {
  /**
   * Override how web-tree-sitter locates its own runtime WASM
   * (web-tree-sitter.wasm / tree-sitter.wasm).
   *
   * Needed when the consumer bundles with esbuild or another bundler that
   * changes the module-relative path web-tree-sitter would compute by default.
   * Pass a function that returns the absolute path to the runtime WASM for the
   * given filename argument (web-tree-sitter always calls it with "tree-sitter.wasm").
   *
   * Example (LSP server, esbuild CJS bundle):
   *   locateFile: () => path.join(serverDir, "tree-sitter.wasm")
   */
  locateFile?: (name: string) => string;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialise the WASM parser with the Satsuma grammar.
 *
 * Must be awaited once before getParser() or getLanguage() are called.
 * Subsequent calls are no-ops — they return the same Promise that is already
 * in flight or already resolved.
 *
 * @param wasmPath  Absolute path to tree-sitter-satsuma.wasm.
 * @param options   Optional overrides (see ParserInitOptions).
 */
export function initParser(wasmPath: string, options?: ParserInitOptions): Promise<void> {
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    // Dynamic import works from both native ESM (satsuma-core) and esbuild CJS
    // bundles (vscode server), where it is lowered to require(). A top-level
    // static import or createRequire(import.meta.url) cannot be used because
    // import.meta is unavailable in CJS output and causes a load-time crash.
    //
    // web-tree-sitter's CJS build exposes Parser, Language, etc. as named
    // exports with no default export. The fallback (mod.default ?? mod) handles
    // both that case and future ESM builds that may add a default. Today's
    // node16 CJS-interop types synthesize `default` as always-defined, so the
    // linter sees the `??` as dead — but that synthesis is a types-only
    // artifact of the current build, not a guarantee about a future
    // web-tree-sitter release, which the type checker cannot see ahead of time.
    const mod = await import("web-tree-sitter");
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see comment above
    const TreeSitter = mod.default ?? mod;
    _TreeSitter = TreeSitter;
    await TreeSitter.Parser.init(
      options?.locateFile ? { locateFile: options.locateFile } : undefined,
    );
    _language = await TreeSitter.Language.load(wasmPath);
    const parser = new TreeSitter.Parser();
    parser.setLanguage(_language);
    _parser = asSatsumaParser(parser);
  })();

  return _initPromise;
}

/**
 * Return the initialised Parser instance.
 * Throws if initParser() has not been awaited.
 */
export function getParser(): SatsumaParser {
  if (!_parser) throw new Error("Parser not initialised — call initParser() first");
  return _parser;
}

/**
 * Return the loaded Language instance.
 * Throws if initParser() has not been awaited.
 *
 * Consumers that need to run tree-sitter Queries (e.g. for semantic tokens)
 * use this to construct a Query against the grammar's node types.
 */
export function getLanguage(): Language {
  if (!_language) throw new Error("Language not loaded — call initParser() first");
  return _language;
}

/**
 * Create a tree-sitter Query from a highlights source string.
 *
 * Uses the same WASM module instance that initParser() loaded, avoiding the
 * duplicate-module problem that occurs when consumers import web-tree-sitter
 * separately (esbuild bundles ESM and CJS copies as distinct modules, each
 * with its own uninitialised WASM state).
 */
export function createQuery(language: Language, source: string): Query {
  if (!_TreeSitter) throw new Error("Parser not initialised — call initParser() first");
  return new _TreeSitter.Query(language, source);
}
