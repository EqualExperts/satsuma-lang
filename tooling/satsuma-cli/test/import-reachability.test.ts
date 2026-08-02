/**
 * import-reachability.test.ts — Tests for symbol-level import reachability (ADR-022)
 *
 * Covers:
 * - computeSymbolDependencies: builds correct dependency graph from index entities
 * - computeImportReachability: computes correct per-file reachable symbol sets
 * - CLI validate integration: detects out-of-scope references in multi-file workspaces
 *
 * The repro case from sl-cf9t:
 *   base.stm defines my_transform
 *   middle.stm imports { my_transform } from base.stm, defines middle_schema
 *   top.stm imports { middle_schema } from middle.stm (does NOT import my_transform)
 *   → top.stm should NOT see my_transform
 */

import assert from "node:assert/strict";
import { describe as _describe, it } from "node:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { run as _run } from "./helpers.js";
import { computeSymbolDependencies, computeImportReachability } from "@satsuma/core";
import type { SemanticIndex } from "@satsuma/core";

const describe = (name: string, fn: () => void) => _describe(name, { concurrency: true }, fn);

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../dist/index.js");

const run = (...args: string[]) => _run(CLI, ...args);

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal SemanticIndex for unit-testing reachability functions. */
function makeSemanticIndex(opts: {
  schemas?: Array<{ key: string; file: string; namespace?: string; spreads?: string[] }>;
  fragments?: Array<{ key: string; file: string; namespace?: string; spreads?: string[] }>;
  mappings?: Array<{
    key: string;
    file: string;
    namespace?: string;
    sources: string[];
    targets: string[];
  }>;
  metrics?: Array<{ key: string; file: string; namespace?: string; sources?: string[] }>;
  transforms?: Array<{ key: string; file: string }>;
}): SemanticIndex {
  const schemas = new Map<string, any>();
  for (const s of opts.schemas ?? []) {
    schemas.set(s.key, {
      name: s.key.includes("::") ? s.key.split("::")[1] : s.key,
      namespace: s.namespace,
      file: s.file,
      row: 0,
      fields: [],
      spreads: s.spreads ?? [],
    });
  }
  const fragments = new Map<string, any>();
  for (const f of opts.fragments ?? []) {
    fragments.set(f.key, {
      name: f.key.includes("::") ? f.key.split("::")[1] : f.key,
      namespace: f.namespace,
      file: f.file,
      row: 0,
      fields: [],
      spreads: f.spreads ?? [],
    });
  }
  const mappings = new Map<string, any>();
  for (const m of opts.mappings ?? []) {
    mappings.set(m.key, {
      name: m.key.includes("::") ? m.key.split("::")[1] : m.key,
      namespace: m.namespace,
      file: m.file,
      row: 0,
      sources: m.sources,
      targets: m.targets,
    });
  }
  const metrics = new Map<string, any>();
  for (const m of opts.metrics ?? []) {
    metrics.set(m.key, {
      namespace: m.namespace,
      file: m.file,
      row: 0,
      sources: m.sources ?? [],
    });
  }
  const transforms = new Map<string, any>();
  for (const t of opts.transforms ?? []) {
    transforms.set(t.key, { file: t.file });
  }
  return {
    schemas,
    fragments,
    mappings,
    metrics,
    transforms,
    fieldArrows: new Map(),
  };
}

/** Create a temp directory with .stm files for integration tests. */
function createTempWorkspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "satsuma-import-test-"));
  for (const [name, content] of Object.entries(files)) {
    const filePath = join(dir, name);
    const fileDir = dirname(filePath);
    mkdirSync(fileDir, { recursive: true });
    writeFileSync(filePath, content, "utf8");
  }
  return dir;
}

// ── Unit tests: computeSymbolDependencies ───────────────────────────────────

describe("computeSymbolDependencies", () => {
  it("records schema → spread fragment dependency", () => {
    // Schema that spreads a fragment depends on that fragment.
    const index = makeSemanticIndex({
      schemas: [{ key: "my_schema", file: "a.stm", spreads: ["shared_fields"] }],
      fragments: [{ key: "shared_fields", file: "a.stm" }],
    });
    const deps = computeSymbolDependencies(index);
    assert.ok(
      deps.get("my_schema")?.has("shared_fields"),
      "schema should depend on its spread fragment",
    );
  });

  it("records mapping → source and target schema dependencies", () => {
    // Mapping depends on its source and target schemas.
    const index = makeSemanticIndex({
      schemas: [
        { key: "src_schema", file: "a.stm" },
        { key: "tgt_schema", file: "a.stm" },
      ],
      mappings: [
        {
          key: "my_mapping",
          file: "a.stm",
          sources: ["src_schema"],
          targets: ["tgt_schema"],
        },
      ],
    });
    const deps = computeSymbolDependencies(index);
    const mappingDeps = deps.get("my_mapping");
    assert.ok(mappingDeps?.has("src_schema"), "mapping should depend on source schema");
    assert.ok(mappingDeps?.has("tgt_schema"), "mapping should depend on target schema");
  });

  it("records fragment → spread fragment dependency (nested spreads)", () => {
    // Fragment that spreads another fragment creates a dependency.
    const index = makeSemanticIndex({
      fragments: [
        { key: "base_fields", file: "a.stm" },
        { key: "extended_fields", file: "a.stm", spreads: ["base_fields"] },
      ],
    });
    const deps = computeSymbolDependencies(index);
    assert.ok(
      deps.get("extended_fields")?.has("base_fields"),
      "fragment should depend on its spread fragment",
    );
  });

  it("records metric → source schema dependency", () => {
    // Metric depends on its source schema.
    const index = makeSemanticIndex({
      schemas: [{ key: "revenue_data", file: "a.stm" }],
      metrics: [{ key: "revenue", file: "a.stm", sources: ["revenue_data"] }],
    });
    const deps = computeSymbolDependencies(index);
    assert.ok(
      deps.get("revenue")?.has("revenue_data"),
      "metric should depend on its source schema",
    );
  });

  it("returns empty deps for symbols with no references", () => {
    // A standalone schema with no spreads has no dependencies.
    const index = makeSemanticIndex({
      schemas: [{ key: "standalone", file: "a.stm" }],
    });
    const deps = computeSymbolDependencies(index);
    assert.ok(deps.has("standalone"), "symbol should have a deps entry");
    assert.equal(deps.get("standalone")!.size, 0, "should have no dependencies");
  });
});

// ── Unit tests: computeImportReachability ───────────────────────────────────

describe("computeImportReachability", () => {
  it("local symbols are always reachable from their own file", () => {
    // Symbols defined in a file are always in scope for that file.
    const index = makeSemanticIndex({
      schemas: [
        { key: "local_a", file: "/a.stm" },
        { key: "local_b", file: "/b.stm" },
      ],
    });
    const fileImports = new Map([
      ["/a.stm", []],
      ["/b.stm", []],
    ]);
    const result = computeImportReachability(index, fileImports);
    assert.ok(
      result.reachableSymbols.get("/a.stm")?.has("local_a"),
      "a.stm should see its own symbol",
    );
    assert.ok(
      !result.reachableSymbols.get("/a.stm")?.has("local_b"),
      "a.stm should NOT see b.stm's symbol without an import",
    );
  });

  it("explicitly imported symbols are reachable", () => {
    // Importing a symbol from another file makes it visible.
    const index = makeSemanticIndex({
      schemas: [
        { key: "imported_schema", file: "/base.stm" },
        { key: "local_schema", file: "/top.stm" },
      ],
    });
    const fileImports = new Map([
      ["/base.stm", []],
      ["/top.stm", [{ names: ["imported_schema"], resolvedFile: "/base.stm" }]],
    ]);
    const result = computeImportReachability(index, fileImports);
    assert.ok(
      result.reachableSymbols.get("/top.stm")?.has("imported_schema"),
      "top.stm should see explicitly imported symbol",
    );
  });

  it("transitive dependencies of imported symbols are reachable", () => {
    // Importing a schema that spreads a fragment makes that fragment reachable.
    const fileImports = new Map([
      ["/base.stm", []],
      ["/top.stm", [{ names: ["my_schema"], resolvedFile: "/base.stm" }]],
    ]);
    // Need top.stm to appear in the index — add a local symbol
    const index2 = makeSemanticIndex({
      schemas: [
        { key: "my_schema", file: "/base.stm", spreads: ["shared_fields"] },
        { key: "local", file: "/top.stm" },
      ],
      fragments: [{ key: "shared_fields", file: "/base.stm" }],
    });
    const result = computeImportReachability(index2, fileImports);
    const topReachable = result.reachableSymbols.get("/top.stm");
    assert.ok(topReachable?.has("my_schema"), "imported schema should be reachable");
    assert.ok(
      topReachable?.has("shared_fields"),
      "spread fragment (transitive dep) should be reachable",
    );
  });

  it("unrelated symbols in transitively reachable files are NOT reachable (sl-cf9t repro)", () => {
    // This is the exact bug from the ticket:
    // base.stm defines my_transform
    // middle.stm imports my_transform from base.stm, defines middle_schema
    // top.stm imports middle_schema from middle.stm
    // → top.stm should NOT see my_transform (it's not a dependency of middle_schema)
    const fileImports = new Map([
      ["/base.stm", []],
      ["/middle.stm", [{ names: ["my_transform"], resolvedFile: "/base.stm" }]],
      ["/top.stm", [{ names: ["middle_schema"], resolvedFile: "/middle.stm" }]],
    ]);
    // top.stm needs at least one symbol to appear in fileToSymbols — but it
    // doesn't define anything locally. That's fine: computeImportReachability
    // must still build a reachable set for top.stm from its imports.
    //
    // Actually, we need top.stm to appear in the file-to-symbols map. Let's
    // add a dummy local schema so the file is tracked.
    const fullIndex = makeSemanticIndex({
      schemas: [
        { key: "middle_schema", file: "/middle.stm" },
        { key: "top_local", file: "/top.stm" },
      ],
      transforms: [{ key: "my_transform", file: "/base.stm" }],
    });
    const result = computeImportReachability(fullIndex, fileImports);
    const topReachable = result.reachableSymbols.get("/top.stm");
    assert.ok(
      topReachable?.has("middle_schema"),
      "middle_schema should be reachable (explicitly imported)",
    );
    assert.ok(
      !topReachable?.has("my_transform"),
      "my_transform should NOT be reachable (not a dependency of middle_schema)",
    );
  });

  it("resolves namespace-qualified import names", () => {
    // Importing "ns::my_schema" matches the qualified key in the target file.
    const index = makeSemanticIndex({
      schemas: [
        { key: "ns::my_schema", file: "/base.stm", namespace: "ns" },
        { key: "local", file: "/top.stm" },
      ],
    });
    const fileImports = new Map([
      ["/base.stm", []],
      ["/top.stm", [{ names: ["ns::my_schema"], resolvedFile: "/base.stm" }]],
    ]);
    const result = computeImportReachability(index, fileImports);
    assert.ok(
      result.reachableSymbols.get("/top.stm")?.has("ns::my_schema"),
      "namespace-qualified import should be reachable",
    );
  });

  it("resolves bare import names to namespace-qualified keys", () => {
    // Importing "my_schema" (bare) from a file that defines "ns::my_schema"
    // should resolve to the qualified key.
    const index = makeSemanticIndex({
      schemas: [
        { key: "ns::my_schema", file: "/base.stm", namespace: "ns" },
        { key: "local", file: "/top.stm" },
      ],
    });
    const fileImports = new Map([
      ["/base.stm", []],
      ["/top.stm", [{ names: ["my_schema"], resolvedFile: "/base.stm" }]],
    ]);
    const result = computeImportReachability(index, fileImports);
    assert.ok(
      result.reachableSymbols.get("/top.stm")?.has("ns::my_schema"),
      "bare name should resolve to namespace-qualified key in imported file",
    );
  });

  it("chains transitive dependencies through multiple import hops", () => {
    // base.stm defines fragment shared_fields
    // middle.stm defines middle_schema that spreads shared_fields
    // top.stm imports middle_schema → should reach shared_fields transitively
    const index = makeSemanticIndex({
      schemas: [
        { key: "middle_schema", file: "/middle.stm", spreads: ["shared_fields"] },
        { key: "top_local", file: "/top.stm" },
      ],
      fragments: [{ key: "shared_fields", file: "/base.stm" }],
    });
    const fileImports = new Map([
      ["/base.stm", []],
      ["/middle.stm", [{ names: ["shared_fields"], resolvedFile: "/base.stm" }]],
      ["/top.stm", [{ names: ["middle_schema"], resolvedFile: "/middle.stm" }]],
    ]);
    const result = computeImportReachability(index, fileImports);
    const topReachable = result.reachableSymbols.get("/top.stm");
    assert.ok(topReachable?.has("middle_schema"), "imported schema should be reachable");
    assert.ok(
      topReachable?.has("shared_fields"),
      "fragment spread by imported schema should be transitively reachable",
    );
  });
});

// ── Integration tests: CLI validate with import scope ───────────────────────

describe("satsuma validate import-scope (sl-cf9t)", () => {
  it("reports error when using a symbol not reachable through imports", async () => {
    // Repro case from sl-cf9t: top.stm uses my_transform via middle.stm's
    // import graph, but my_transform is not a dependency of middle_schema.
    const dir = createTempWorkspace({
      "base.stm": ["transform my_transform {", "  trim | lowercase", "}"].join("\n"),
      "middle.stm": [
        'import { my_transform } from "./base.stm"',
        "",
        "schema middle_schema {",
        "  name  STRING",
        "}",
      ].join("\n"),
      "top.stm": [
        'import { middle_schema } from "./middle.stm"',
        "",
        "schema top_source {",
        "  name  STRING",
        "}",
        "",
        "mapping load_middle : top_source -> middle_schema {",
        "  .name -> .name { ...my_transform }",
        "}",
      ].join("\n"),
    });
    const { stdout, stderr, code: _code } = await run("validate", join(dir, "top.stm"));
    const output = stdout + stderr;
    assert.ok(
      output.includes("import-scope") || output.includes("not reachable"),
      `should report import-scope violation, got: ${output}`,
    );
  });

  it("passes when all referenced symbols are properly imported", async () => {
    // Correctly importing my_transform should produce no import-scope errors.
    const dir = createTempWorkspace({
      "base.stm": ["transform my_transform {", "  trim | lowercase", "}"].join("\n"),
      "pipeline.stm": [
        'import { my_transform } from "./base.stm"',
        "",
        "schema source_data {",
        "  name  STRING",
        "}",
        "",
        "schema target_data {",
        "  name  STRING",
        "}",
        "",
        "mapping load_data : source_data -> target_data {",
        "  .name -> .name { ...my_transform }",
        "}",
      ].join("\n"),
    });
    const { stdout, stderr, code: _code } = await run("validate", join(dir, "pipeline.stm"));
    const output = stdout + stderr;
    assert.ok(
      !output.includes("import-scope"),
      `should not report import-scope violation for properly imported symbols, got: ${output}`,
    );
  });

  it("allows references to locally-defined symbols without imports", async () => {
    // A single file referencing its own symbols needs no imports.
    const dir = createTempWorkspace({
      "standalone.stm": [
        "fragment shared_fields {",
        "  id  INTEGER",
        "}",
        "",
        "schema my_schema {",
        "  ...shared_fields",
        "  name  STRING",
        "}",
      ].join("\n"),
    });
    const { stdout, stderr, code: _code } = await run("validate", join(dir, "standalone.stm"));
    const output = stdout + stderr;
    assert.ok(
      !output.includes("import-scope"),
      `single-file workspace should not produce import-scope errors, got: ${output}`,
    );
  });

  it("reports error for fragment spread from unreachable file", async () => {
    // Variant: fragment spreads from a transitively reachable file that
    // was not explicitly imported and is not a dependency of what was imported.
    const dir = createTempWorkspace({
      "fragments.stm": [
        "fragment audit_fields {",
        "  created_at  TIMESTAMP",
        "}",
        "",
        "fragment unrelated_fields {",
        "  color  STRING",
        "}",
      ].join("\n"),
      "middle.stm": [
        'import { audit_fields } from "./fragments.stm"',
        "",
        "schema middle_schema {",
        "  ...audit_fields",
        "  name  STRING",
        "}",
      ].join("\n"),
      "top.stm": [
        'import { middle_schema } from "./middle.stm"',
        "",
        "schema top_schema {",
        "  ...unrelated_fields",
        "  id  INTEGER",
        "}",
      ].join("\n"),
    });
    const { stdout, stderr, code: _code } = await run("validate", join(dir, "top.stm"));
    const output = stdout + stderr;
    assert.ok(
      output.includes("import-scope") || output.includes("not reachable"),
      `should report unrelated_fields as not reachable, got: ${output}`,
    );
  });
});
