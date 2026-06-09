/**
 * server.ts — standalone HTTP server for the Satsuma viz harness.
 *
 * Owns two responsibilities:
 *   1. Static file serving — ships the browser client (index.html, app.js,
 *      satsuma-viz.js) that renders fixtures in a real browser.
 *   2. Fixture API — parses every .stm file found under the repo's examples/
 *      directory at startup, indexes them in a shared workspace index, and
 *      serves VizModel JSON via a simple REST-like API.
 *
 * The server is intentionally minimal: no Express, no bundler middleware,
 * no hot-reload.  It is a deterministic, fixture-driven harness designed for
 * Playwright automation, not a general-purpose dev server.
 *
 * API routes:
 *   GET /              → redirect to /index.html
 *   GET /index.html    → harness shell page
 *   GET /app.js        → browser-side harness bundle
 *   GET /satsuma-viz.js → satsuma-viz web component bundle
 *   GET /api/fixtures  → JSON array of { name, path, uri } objects
 *   GET /api/source?uri=<encoded> → { source: string, uri: string }
 *   GET /api/model?uri=<encoded>&lineage=<0|1> → VizModel JSON
 */

import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { initParser, getParser } from "@satsuma/core";
import {
  createWorkspaceIndex,
  indexFile,
  buildVizModel,
  mergeVizModels,
  getImportReachableUris,
  createScopedIndex,
} from "@satsuma/viz-backend";
import type { WorkspaceIndex } from "@satsuma/viz-backend";

// ---------- Configuration ----------

/** Port the harness server listens on. */
const PORT = 3333;

/**
 * Examples directory — two levels up from the harness package root.
 * At runtime, __dirname is `dist/`; so the repo root is three levels up.
 */
const EXAMPLES_DIR = path.join(__dirname, "..", "..", "..", "examples");

/**
 * Directory containing built static client assets (index.html, app.js, etc.).
 * Populated by `npm run build:client` and `npm run build:viz`.
 */
const CLIENT_DIR = path.join(__dirname, "client");

/** WASM artifacts live next to server.js after `npm run build:wasm`. */
const WASM_SATSUMA = path.join(__dirname, "tree-sitter-satsuma.wasm");
const WASM_RUNTIME = path.join(__dirname, "tree-sitter.wasm");

// ---------- MIME types for static file serving ----------

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
};

// ---------- Fixture registry ----------

/**
 * Metadata for a discovered .stm fixture file.
 * The `uri` field is what the workspace index uses as the primary key.
 */
interface Fixture {
  /** Display name: relative path from examples/, e.g. "sfdc-to-snowflake/pipeline.stm". */
  name: string;
  /** Absolute filesystem path. */
  path: string;
  /** file:// URI used as the workspace index key. */
  uri: string;
}

// ---------- Startup ----------

/**
 * Discover all .stm files under dir, returning sorted fixture metadata.
 * Recurses into subdirectories to find all fixture files.
 */
function discoverFixtures(dir: string): Fixture[] {
  const fixtures: Fixture[] = [];

  function walk(current: string): void {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".stm")) {
        const relativeName = path.relative(dir, fullPath).replace(/\\/g, "/");
        fixtures.push({
          name: relativeName,
          path: fullPath,
          uri: pathToFileURL(fullPath).href,
        });
      }
    }
  }

  walk(dir);
  fixtures.sort((a, b) => a.name.localeCompare(b.name));
  return fixtures;
}

/**
 * Parse all discovered fixture files and build a shared workspace index.
 * Files that fail to read are skipped with a console warning.
 */
function indexFixtures(fixtures: Fixture[], wsIndex: WorkspaceIndex): void {
  const parser = getParser();
  for (const fixture of fixtures) {
    let source: string;
    try {
      source = fs.readFileSync(fixture.path, "utf-8");
    } catch (err) {
      console.warn(`[harness] skipping unreadable fixture: ${fixture.path}`, err);
      continue;
    }
    const tree = parser.parse(source);
    // web-tree-sitter's parse() returns Tree | null; null is only possible
    // when parsing is halted via a callback, which we never do here.
    if (!tree) continue;
    indexFile(wsIndex, fixture.uri, tree);
  }
}

// ---------- HTTP request handling ----------

/**
 * Write a JSON response body and appropriate headers.
 */
function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(data);
}

/**
 * Write a plain-text error response.
 */
function sendError(res: http.ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

/**
 * Serve a static file from the client dist directory.
 * Returns false if the file does not exist (caller sends a 404).
 */
function serveStaticFile(res: http.ServerResponse, filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const ext = path.extname(filePath);
  const contentType = MIME[ext] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

/**
 * Build and return the request handler for the HTTP server.
 * Captures the fixture registry and workspace index in its closure.
 */
function makeHandler(
  fixtures: Fixture[],
  wsIndex: WorkspaceIndex,
  fixturesByUri: Map<string, Fixture>,
): http.RequestListener {
  return (req, res) => {
    const rawUrl = req.url ?? "/";
    const [rawPath, rawQuery] = rawUrl.split("?", 2) as [string, string | undefined];
    const query = new URLSearchParams(rawQuery ?? "");

    // ── Static routes ──────────────────────────────────────────────────────

    if (rawPath === "/" || rawPath === "") {
      // Preserve the query string across the redirect so client-side URL
      // parameters (?theme=, ?fixture=, ?mode=) survive a hit to the bare root.
      // Dropping it here previously made ?theme= a silent no-op.
      const suffix = rawQuery ? `?${rawQuery}` : "";
      res.writeHead(302, { Location: `/index.html${suffix}` });
      res.end();
      return;
    }

    if (rawPath === "/index.html" || rawPath === "/app.js" || rawPath === "/satsuma-viz.js") {
      const fileName = rawPath.slice(1); // strip leading /
      const served = serveStaticFile(res, path.join(CLIENT_DIR, fileName));
      if (!served) sendError(res, 404, `Not found: ${rawPath}`);
      return;
    }

    // WASM artifacts for the in-browser parser. The client builds the VizModel
    // itself now (feature 33), so it fetches both the grammar and the
    // web-tree-sitter runtime WASM at startup. They live next to server.js after
    // build:wasm; serve them at the site root so document.baseURI-relative URLs
    // resolve here and in the static playground build alike.
    if (rawPath === "/tree-sitter-satsuma.wasm") {
      if (!serveStaticFile(res, WASM_SATSUMA)) sendError(res, 404, "Not found");
      return;
    }
    if (rawPath === "/tree-sitter.wasm") {
      if (!serveStaticFile(res, WASM_RUNTIME)) sendError(res, 404, "Not found");
      return;
    }

    // Source maps for app.js (useful during local debugging)
    if (rawPath === "/app.js.map") {
      const served = serveStaticFile(res, path.join(CLIENT_DIR, "app.js.map"));
      if (!served) sendError(res, 404, "Not found");
      return;
    }

    // ── API routes ─────────────────────────────────────────────────────────

    if (rawPath === "/api/fixtures") {
      sendJson(res, 200, fixtures.map((f) => ({ name: f.name, path: f.path, uri: f.uri })));
      return;
    }

    if (rawPath === "/api/source") {
      const uri = query.get("uri");
      if (!uri) { sendError(res, 400, "Missing ?uri="); return; }
      const fixture = fixturesByUri.get(uri);
      if (!fixture) { sendError(res, 404, `Unknown fixture URI: ${uri}`); return; }
      try {
        const source = fs.readFileSync(fixture.path, "utf-8");
        sendJson(res, 200, { source, uri });
      } catch {
        sendError(res, 500, "Failed to read fixture file");
      }
      return;
    }

    if (rawPath === "/api/model") {
      const uri = query.get("uri");
      if (!uri) { sendError(res, 400, "Missing ?uri="); return; }
      const fixture = fixturesByUri.get(uri);
      if (!fixture) { sendError(res, 404, `Unknown fixture URI: ${uri}`); return; }

      const wantLineage = query.get("lineage") === "1";
      const parser = getParser();

      let source: string;
      try {
        source = fs.readFileSync(fixture.path, "utf-8");
      } catch {
        sendError(res, 500, "Failed to read fixture file");
        return;
      }

      const tree = parser.parse(source);
      if (!tree) { sendError(res, 500, "Parser returned null"); return; }

      if (wantLineage) {
        // Full transitive lineage: collect VizModels for all import-reachable files
        // and merge them, so the viz shows the complete cross-file data flow.
        const reachable = getImportReachableUris(uri, wsIndex);
        const models = [];
        for (const reachableUri of reachable) {
          const rf = fixturesByUri.get(reachableUri);
          if (!rf) continue;
          let rfSource: string;
          try { rfSource = fs.readFileSync(rf.path, "utf-8"); }
          catch { continue; }
          const rfTree = parser.parse(rfSource);
          if (!rfTree) continue;
          const scopedIndex = createScopedIndex(wsIndex, reachable);
          models.push(buildVizModel(reachableUri, rfTree, scopedIndex));
        }
        const merged = mergeVizModels(uri, models);
        sendJson(res, 200, merged);
      } else {
        // Single-file model using an import-scoped index (matching LSP behaviour).
        const reachable = getImportReachableUris(uri, wsIndex);
        const scopedIndex = createScopedIndex(wsIndex, reachable);
        const model = buildVizModel(uri, tree, scopedIndex);
        sendJson(res, 200, model);
      }
      return;
    }

    sendError(res, 404, `Unknown route: ${rawPath}`);
  };
}

// ---------- Main ----------

async function main(): Promise<void> {
  // Initialise the WASM parser.  Both WASM files live next to server.js after
  // the build:wasm step copies them from the tree-sitter and web-tree-sitter
  // packages.  locateFile tells web-tree-sitter where its own runtime WASM is,
  // since esbuild moves the file out of the default module-relative location.
  await initParser(WASM_SATSUMA, { locateFile: () => WASM_RUNTIME });

  const wsIndex = createWorkspaceIndex();

  if (!fs.existsSync(EXAMPLES_DIR)) {
    console.error(`[harness] examples directory not found: ${EXAMPLES_DIR}`);
    process.exit(1);
  }

  const fixtures = discoverFixtures(EXAMPLES_DIR);
  console.log(`[harness] discovered ${fixtures.length} fixture(s) in ${EXAMPLES_DIR}`);

  indexFixtures(fixtures, wsIndex);
  console.log(`[harness] indexed all fixtures`);

  const fixturesByUri = new Map(fixtures.map((f) => [f.uri, f]));

  const server = http.createServer(makeHandler(fixtures, wsIndex, fixturesByUri));
  server.listen(PORT, () => {
    console.log(`[harness] ready at http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("[harness] startup error:", err);
  process.exit(1);
});
