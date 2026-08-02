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
  nodePaths: [path.resolve(__dirname, "../satsuma-lsp/node_modules")],
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
const webviewFieldLineageConfig = {
  entryPoints: ["src/webview/field-lineage/field-lineage.ts"],
  bundle: true,
  platform: "browser",
  target: "es2022",
  outfile: "dist/webview/field-lineage/field-lineage.js",
  format: "iife",
  sourcemap: true,
  alias: {
    "elkjs/lib/elk.bundled.js": path.resolve(
      __dirname,
      "../satsuma-viz/node_modules/elkjs/lib/elk.bundled.js",
    ),
  },
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
  alias: {
    "elkjs/lib/elk.bundled.js": path.resolve(
      __dirname,
      "../satsuma-viz/node_modules/elkjs/lib/elk.bundled.js",
    ),
  },
};

// Copy static assets to dist
const { copyFileSync, mkdirSync, existsSync } = require("fs");

function copyAssets() {
  const pairs = [
    ["src/webview/lineage/lineage.css", "dist/webview/lineage/lineage.css"],
    ["src/webview/viz/viz.css", "dist/webview/viz/viz.css"],
    ["src/webview/field-lineage/field-lineage.css", "dist/webview/field-lineage/field-lineage.css"],
    [
      "src/webview/schema-lineage/schema-lineage.css",
      "dist/webview/schema-lineage/schema-lineage.css",
    ],
  ];

  // Copy WASM and highlights.scm into server/dist/ so the server can load them
  // at runtime via __dirname.
  const treeSitterDir = path.resolve(__dirname, "../tree-sitter-satsuma");
  pairs.push(
    [path.join(treeSitterDir, "tree-sitter-satsuma.wasm"), "server/dist/tree-sitter-satsuma.wasm"],
    [path.join(treeSitterDir, "queries/highlights.scm"), "server/dist/highlights.scm"],
    // web-tree-sitter runtime WASM — loaded by the web-tree-sitter module at init
    // web-tree-sitter 0.26+ renamed tree-sitter.wasm → web-tree-sitter.wasm.
    // The WASM file lives in satsuma-lsp's node_modules since the server was
    // extracted into its own package (ADR-021).
    [
      "../satsuma-lsp/node_modules/web-tree-sitter/web-tree-sitter.wasm",
      "server/dist/tree-sitter.wasm",
    ],
  );

  for (const [src, dst] of pairs) {
    try {
      const dir = path.dirname(dst);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      copyFileSync(src, dst);
    } catch {
      // Asset may not exist yet (e.g. CSS or WASM not built)
    }
  }
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

  // Only include field-lineage config if the entry point exists
  try {
    require("fs").accessSync("src/webview/field-lineage/field-lineage.ts");
    configs.push(webviewFieldLineageConfig);
  } catch {
    // Field lineage webview not yet created
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
