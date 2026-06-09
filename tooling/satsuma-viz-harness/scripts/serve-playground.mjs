#!/usr/bin/env node
/**
 * serve-playground.mjs — minimal static file server for the published
 * playground bundle, deliberately mounted under a NON-ROOT base path.
 *
 * The production deployment serves the bundle from GitHub Pages at
 * /satsuma-lang/playground/ — a base path that breaks any root-absolute (/…)
 * asset reference. This server reproduces that exact topology locally so the
 * Playwright static-build project (playground-static.test.ts) validates the
 * deployed layout, not the friendlier root-mounted dev-server one.
 *
 * It is a dumb file server on purpose: no API routes, no fixture discovery,
 * no model building. If the playground works here, it works on any static
 * host. Anything outside the base path is a 404.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The bundle emitted by build-playground.mjs (npm run build:playground). */
const ROOT = join(HERE, "..", "dist", "playground");

/** Distinct from the dev server's 3333 so both Playwright projects coexist. */
const PORT = 3334;

/** Mirrors the GitHub Pages deployment prefix — the non-root path under test. */
const BASE_PATH = "/satsuma-lang/playground/";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
};

createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (!pathname.startsWith(BASE_PATH)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end(`Not found (outside base path ${BASE_PATH})`);
    return;
  }

  // A request for the directory itself serves the page, like any static host.
  const rel = pathname.slice(BASE_PATH.length) || "index.html";
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(ROOT + sep)) {
    // Path traversal (../) escaped the bundle directory.
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }

  try {
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}).listen(PORT, () => {
  console.log(`[playground-static] serving ${ROOT} at http://localhost:${PORT}${BASE_PATH}`);
});
