/**
 * server.ts — standalone HTTP server for the Satsuma viz harness.
 *
 * Owns two responsibilities:
 *   1. Static file serving — ships the browser client (index.html, app.js,
 *      satsuma-viz.js) and the WASM parser artifacts the client loads.
 *   2. Fixture API — discovers the .stm files under the repo's examples/
 *      directory and serves their list and source text.
 *
 * The server no longer builds VizModels. Since feature 33 the browser client
 * builds models itself via @satsuma/viz-backend (the /api/model endpoint and
 * its server-side index were retired — see sl-j8n5); the server's only job now
 * is to hand the client fixture sources and the WASM files. It stays a
 * deterministic, fixture-driven harness for Playwright automation, not a
 * general-purpose dev server.
 *
 * API routes:
 *   GET /              → redirect to /index.html
 *   GET /index.html    → harness shell page
 *   GET /app.js        → browser-side harness bundle
 *   GET /satsuma-viz.js → satsuma-viz web component bundle
 *   GET /examples.json → bundled examples manifest (seeds the client's
 *                        localStorage document library; see sl-kd45)
 *   GET /tree-sitter-satsuma.wasm, /tree-sitter.wasm → in-browser parser WASM
 *   GET /api/fixtures  → JSON array of { name, path, uri } objects
 *   GET /api/source?uri=<encoded> → { source: string, uri: string }
 *
 * The client no longer calls /api/fixtures or /api/source — its picker and
 * workspace are backed by the localStorage library seeded from /examples.json.
 * The two fixture API routes remain for Playwright helpers and ad-hoc tooling
 * that want the server's view of the corpus.
 */

import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";

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
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".png": "image/png",
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
 * Captures the fixture registry in its closure.
 */
function makeHandler(
  fixtures: Fixture[],
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

    // examples.json is the bundled corpus manifest generated by build:examples;
    // the client fetches it page-relative to seed its document library.
    if (rawPath === "/index.html" || rawPath === "/app.js" || rawPath === "/satsuma-viz.js" || rawPath === "/examples.json" || rawPath === "/satsuma-logo.png" || rawPath === "/lexend-latin.woff2") {
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

    // Note: there is no /api/model route. Model-building moved to the browser
    // client in feature 33 (sl-dn29); the server-side endpoint and its workspace
    // index were retired (sl-j8n5). The client builds VizModels from the source
    // text it fetches via /api/source.

    sendError(res, 404, `Unknown route: ${rawPath}`);
  };
}

// ---------- Main ----------

async function main(): Promise<void> {
  // The server no longer parses or builds models — the client does that with its
  // own in-browser WASM parser (feature 33). The server just discovers fixtures
  // and serves their sources and the WASM files the client loads.
  if (!fs.existsSync(EXAMPLES_DIR)) {
    console.error(`[harness] examples directory not found: ${EXAMPLES_DIR}`);
    process.exit(1);
  }

  const fixtures = discoverFixtures(EXAMPLES_DIR);
  console.log(`[harness] discovered ${fixtures.length} fixture(s) in ${EXAMPLES_DIR}`);

  const fixturesByUri = new Map(fixtures.map((f) => [f.uri, f]));

  const server = http.createServer(makeHandler(fixtures, fixturesByUri));
  server.listen(PORT, () => {
    console.log(`[harness] ready at http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("[harness] startup error:", err);
  process.exit(1);
});
