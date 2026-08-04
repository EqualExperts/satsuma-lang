#!/usr/bin/env node
/**
 * verify-pack.js — assert that satsuma-lsp.tgz is installable and launch-ready.
 *
 * Guards against the sl-vwpr regression: the server loads its WASM and query
 * assets from next to dist/server.js at initialize time, so a tarball missing
 * any of them installs cleanly but fails the first LSP request with ENOENT.
 * Run automatically as the last step of `npm run pack`.
 */

const { execFileSync } = require("child_process");
const { existsSync } = require("fs");
const path = require("path");

const lspRoot = path.join(__dirname, "..");
const tarballPath = path.join(lspRoot, "satsuma-lsp.tgz");

if (!existsSync(tarballPath)) {
  throw new Error(`verify-pack: tarball not found at ${tarballPath}`);
}

const contents = execFileSync("tar", ["-tzf", tarballPath], {
  cwd: lspRoot,
  encoding: "utf8",
});

// Any tarball entry containing '..' would be rejected by npm at install time
// with TAR_ENTRY_ERROR (symlinked file: dependencies cause this). Fail fast.
const dotDotEntries = contents.split("\n").filter((e) => e.includes(".."));
if (dotDotEntries.length > 0) {
  throw new Error(
    `verify-pack: tarball contains entries with '..' in their paths — ` +
      `npm will reject these on install.\n` +
      dotDotEntries.map((e) => `  ${e}`).join("\n"),
  );
}

console.log("verify-pack: no '..' paths in tarball entries");

// Everything the server resolves relative to dist/server.js at runtime, plus
// the bin entry point. See src/server.ts onInitialize and scripts/copy-assets.js.
const requiredEntries = [
  "package/bin/satsuma-lsp.js",
  "package/dist/server.js",
  "package/dist/tree-sitter-satsuma.wasm",
  "package/dist/tree-sitter.wasm",
  "package/dist/highlights.scm",
];

for (const entry of requiredEntries) {
  if (!contents.includes(`${entry}\n`) && !contents.endsWith(entry)) {
    throw new Error(`verify-pack: required tarball entry missing: ${entry}`);
  }
}

console.log("verify-pack: tarball contains bin, server bundle, WASM, and highlights.scm");

// ── No unpublishable dependency may reach the tarball ──
//
// The @satsuma/* packages are private workspace members, so a tarball that
// declares one as a runtime dependency cannot be installed anywhere but this
// repo: `npm install -g satsuma-lsp.tgz` tries to fetch it from the registry and
// fails with a 404. It is safe for them to be devDependencies (npm ignores those
// when installing a package) — dist/server.js inlines their code at build time.
//
// This became reachable when the workspace migration replaced `file:../X` specs
// with by-name ranges: npm silently skips an unresolvable *relative* file: spec,
// so the misdeclaration used to be invisible (feature 42, R2).
const manifest = JSON.parse(
  execFileSync("tar", ["-xzOf", tarballPath, "package/package.json"], {
    cwd: lspRoot,
    encoding: "utf8",
  }),
);

const unpublishable = Object.keys(manifest.dependencies ?? {}).filter((name) =>
  name.startsWith("@satsuma/"),
);

if (unpublishable.length > 0) {
  throw new Error(
    `verify-pack: tarball declares private workspace package(s) as runtime ` +
      `dependencies, which no registry can supply: ${unpublishable.join(", ")}. ` +
      `dist/server.js bundles them, so move them to devDependencies.`,
  );
}

console.log("verify-pack: tarball declares no unpublishable runtime dependencies");
