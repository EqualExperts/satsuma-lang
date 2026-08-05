/**
 * model-pipeline.ts — browser-side VizModel construction for the playground.
 *
 * Owns the one concern that is genuinely browser-specific: locating and
 * initialising the @satsuma/core WASM parser in the page. All model *assembly*
 * delegates to @satsuma/viz-backend's `buildModelFromSources` — the same core
 * pipeline the Node harness server runs — so the browser and the server produce
 * identical models from the same documents (feature 33 client/server parity).
 *
 * What this module does NOT own: the editor buffer, the document library, or any
 * rendering. It turns `{ uri, source }` documents into a VizModel and nothing
 * more. There is no network call in this path — parsing and model-building both
 * happen in-page, which is what makes the "nothing is uploaded" guarantee hold.
 */

import { initParser } from "@satsuma/core";
import { buildModelResultFromSources, buildFieldChainFromSources } from "@satsuma/viz-backend";
import type {
  SourceDocument,
  BuildModelOptions,
  BuildModelResult,
  VizModel,
  BuildFieldChainOptions,
} from "@satsuma/viz-backend";
import type { FieldChainModel } from "@satsuma/viz-model";

export type {
  SourceDocument,
  BuildModelOptions,
  BuildModelResult,
  VizModel,
  BuildFieldChainOptions,
  FieldChainModel,
};

// The two WASM artifacts the parser needs. Both are served alongside the page:
// the harness server serves them at the site root, and the static playground
// build ships them next to index.html. Names match the build:wasm copy step.
const SATSUMA_GRAMMAR_WASM = "tree-sitter-satsuma.wasm";
const TREE_SITTER_RUNTIME_WASM = "tree-sitter.wasm";

/**
 * Resolve a served asset name to an absolute URL relative to the current page.
 *
 * Using `document.baseURI` (not an absolute `/…` root) is what lets the
 * playground work under the non-root GitHub Pages base path (`/satsuma-lang/
 * playground/`): the WASM files resolve next to index.html wherever the bundle
 * is mounted.
 */
function assetUrl(name: string): string {
  return new URL(name, document.baseURI).href;
}

// initParser is itself idempotent, but we cache the promise here so callers can
// `await ensureParserReady()` freely on every edit without re-entering init.
let parserReady: Promise<void> | null = null;

/**
 * Initialise the WASM parser in the browser, once. Idempotent — repeated calls
 * return the same in-flight or resolved promise. Must resolve before
 * `buildModel` is called.
 */
export function ensureParserReady(): Promise<void> {
  if (!parserReady) {
    parserReady = initParser(assetUrl(SATSUMA_GRAMMAR_WASM), {
      // web-tree-sitter calls locateFile with "tree-sitter.wasm" to find its own
      // runtime; point it at the page-relative copy (esbuild moves it off the
      // default module-relative path).
      locateFile: () => assetUrl(TREE_SITTER_RUNTIME_WASM),
    });
  }
  return parserReady;
}

/**
 * Build a VizModel for `entryUri` from in-memory `documents`, returning the
 * model plus the import paths that failed to resolve against the document set
 * (the playground shows those as a visible note — a buffer importing a path
 * outside the library renders without it, never silently). A thin, synchronous
 * pass-through to the core pipeline — the parser must already be initialised
 * (call `ensureParserReady()` once at startup). Kept as the playground's single
 * model entry point so the rest of the client never imports viz-backend directly.
 */
export function buildModel(
  entryUri: string,
  documents: SourceDocument[],
  options?: BuildModelOptions,
): BuildModelResult {
  return buildModelResultFromSources(entryUri, documents, options);
}

/**
 * Build a field chain (upstream/downstream lineage) for `focusField` — a
 * "schema.field" reference in the same form the CLI's
 * `field-lineage <schema.field>` argument takes — from in-memory `documents`.
 * A thin pass-through to the core pipeline, mirroring `buildModel`'s role but
 * for the chain-view entry point (PRD 36 R3/R4): the parser must already be
 * initialised.
 */
export function buildFieldChain(
  entryUri: string,
  documents: SourceDocument[],
  focusField: string,
  options?: BuildFieldChainOptions,
): FieldChainModel {
  return buildFieldChainFromSources(entryUri, documents, focusField, options);
}
