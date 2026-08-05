const esbuild = require("esbuild");
const path = require("path");

const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const clientConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  outfile: "dist/client/extension.js",
  external: ["vscode"],
  format: "cjs",
  sourcemap: true,
};

/** @type {import("esbuild").BuildOptions} */
const serverConfig = {
  entryPoints: ["../satsuma-lsp/src/server.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  outfile: "server/dist/server.js",
  format: "cjs",
  sourcemap: true,
  // No `nodePaths` override: the server entry point lives under
  // ../satsuma-lsp/, so esbuild's normal upward node_modules walk from there
  // finds the LSP's dependencies wherever npm workspaces hoisted them. Pointing
  // at ../satsuma-lsp/node_modules explicitly, as this once did, only worked
  // while every package installed its own private copy (feature 42, R2).
  //
  // The server is bundled from @satsuma/viz-backend's TypeScript *sources*, not
  // its dist, so the extension builds without that package having been compiled
  // first. esbuild's `alias` takes no wildcard, so every subpath the LSP imports
  // needs its own entry here.
  //
  // **This list must mirror the `exports` map in satsuma-viz-backend's
  // package.json.** A subpath that is missing falls back to the bare-package
  // alias and has its remainder appended to it, so the error names a path that
  // was never written anywhere:
  //
  //     Cannot read directory "../satsuma-viz-backend/src/index.ts": not a directory
  //     Could not resolve ".../src/index.ts/coverage" (originally "@satsuma/viz-backend/coverage")
  //
  // Nothing but `npm run build` in this package catches it — the unit, fixture
  // and golden suites never invoke esbuild.
  alias: {
    "@satsuma/viz-backend": path.resolve(__dirname, "../satsuma-viz-backend/src/index.ts"),
    "@satsuma/viz-backend/workspace-index": path.resolve(
      __dirname,
      "../satsuma-viz-backend/src/workspace-index.ts",
    ),
    "@satsuma/viz-backend/viz-model": path.resolve(
      __dirname,
      "../satsuma-viz-backend/src/viz-model.ts",
    ),
    "@satsuma/viz-backend/coverage": path.resolve(
      __dirname,
      "../satsuma-viz-backend/src/coverage.ts",
    ),
  },
  // web-tree-sitter uses import.meta.url internally (for createRequire and
  // WASM file location). esbuild replaces import.meta with {} in CJS bundles,
  // making import.meta.url → undefined and crashing at runtime. The banner
  // injects a CJS-compatible shim so the bundled code gets a real URL.
  banner: {
    js: [`var __import_meta_url = require("url").pathToFileURL(__filename).href;`].join("\n"),
  },
  define: {
    "import.meta.url": "__import_meta_url",
  },
};

/** @type {import("esbuild").BuildOptions} */
const webviewLineageConfig = {
  entryPoints: ["src/webview/lineage/lineage.ts"],
  bundle: true,
  platform: "browser",
  target: "es2020",
  outfile: "dist/webview/lineage/lineage.js",
  format: "iife",
  sourcemap: true,
};

/** @type {import("esbuild").BuildOptions} */
const webviewVizConfig = {
  entryPoints: ["src/webview/viz/viz.ts"],
  bundle: true,
  platform: "browser",
  target: "es2022",
  outfile: "dist/webview/viz/viz.js",
  format: "iife",
  sourcemap: true,
  minify: true,
  alias: {
    "@satsuma/viz": path.resolve(__dirname, "../satsuma-viz/dist/satsuma-viz.js"),
  },
  // satsuma-viz/dist/satsuma-viz.js is a GWT-compiled artifact that contains
  // `n == -0` comparisons we cannot fix at source. Suppress the noise.
  logOverride: { "equals-negative-zero": "silent" },
};

/** @type {import("esbuild").BuildOptions} */
const webviewSchemaLineageConfig = {
  entryPoints: ["src/webview/schema-lineage/schema-lineage.ts"],
  bundle: true,
  platform: "browser",
  target: "es2022",
  outfile: "dist/webview/schema-lineage/schema-lineage.js",
  format: "iife",
  sourcemap: true,
};

// Copy static assets to dist
const { copyFileSync, mkdirSync, existsSync } = require("fs");

// Webview stylesheets. Optional: a webview whose entry point does not exist yet
// has no stylesheet either, and the build above already skips it.
const optionalAssets = [
  ["src/webview/lineage/lineage.css", "dist/webview/lineage/lineage.css"],
  ["src/webview/viz/viz.css", "dist/webview/viz/viz.css"],
  [
    "src/webview/schema-lineage/schema-lineage.css",
    "dist/webview/schema-lineage/schema-lineage.css",
  ],
];

// Runtime assets the bundled server loads from __dirname at initialize time.
// Required: without them the extension packages successfully and then fails to
// start, which is exactly the class of breakage a silently-swallowed copy error
// used to hide (feature 42, R2/R3).
function requiredServerAssets() {
  const treeSitterDir = path.resolve(__dirname, "../tree-sitter-satsuma");
  return [
    [path.join(treeSitterDir, "tree-sitter-satsuma.wasm"), "server/dist/tree-sitter-satsuma.wasm"],
    [path.join(treeSitterDir, "queries/highlights.scm"), "server/dist/highlights.scm"],
    // The web-tree-sitter runtime, which 0.26+ renamed tree-sitter.wasm →
    // web-tree-sitter.wasm; the server still asks for the old name, so the copy
    // renames it back. Resolved through Node rather than joined onto
    // ../satsuma-lsp/node_modules: under npm workspaces the runtime hoists to the
    // root node_modules, so no package-local path can be assumed.
    [require.resolve("web-tree-sitter/web-tree-sitter.wasm"), "server/dist/tree-sitter.wasm"],
  ];
}

function copyAssets() {
  for (const [src, dst] of optionalAssets) {
    if (!existsSync(src)) continue;
    copyInto(src, dst);
  }

  for (const [src, dst] of requiredServerAssets()) {
    if (!existsSync(src)) {
      throw new Error(
        `esbuild: required server asset not found at ${src}. ` +
          "Run `npm run build:all` from the repo root to build the WASM grammar first.",
      );
    }
    copyInto(src, dst);
  }
}

function copyInto(src, dst) {
  mkdirSync(path.dirname(dst), { recursive: true });
  copyFileSync(src, dst);
}

async function build() {
  const configs = [clientConfig, serverConfig];

  // Only include lineage config if the entry point exists
  try {
    require("fs").accessSync("src/webview/lineage/lineage.ts");
    configs.push(webviewLineageConfig);
  } catch {
    // Lineage webview not yet created
  }

  // Only include viz config if the entry point exists
  try {
    require("fs").accessSync("src/webview/viz/viz.ts");
    configs.push(webviewVizConfig);
  } catch {
    // Viz webview not yet created
  }

  // Only include schema-lineage config if the entry point exists
  try {
    require("fs").accessSync("src/webview/schema-lineage/schema-lineage.ts");
    configs.push(webviewSchemaLineageConfig);
  } catch {
    // Schema lineage webview not yet created
  }

  if (watch) {
    const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log("Watching for changes...");
  } else {
    await Promise.all(configs.map((c) => esbuild.build(c)));
    copyAssets();
    console.log("Build complete.");
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
