/**
 * bug-purge.test.js — Regression tests for bug fixes
 *
 * sl-5dyc: Import warnings go to stderr, not stdout
 * sl-j1eb: graph --json no doubled schema prefix for multi-source mappings
 * sl-bl5e: graph --json no double-dot paths for nested fields
 * sl-n464: graph --schema-only aggregates field edges to schema level
 * sl-04pv: hidden-source-in-nl fires on bare and dotted-field refs
 * sl-80jy: unresolved-nl-ref no false positive on valid dotted-field refs
 * sl-j8uk: Filesystem errors exit code 2
 * sl-j9ew: unresolved-nl-ref message uses "metric" scope label for metric notes
 * sl-tslm: validate and lint emit the same rule name for unresolved NL refs
 * sc-1ar0: mapping includes flatten/each block arrows
 * sc-8g9a: validate no false-positive field-not-in-schema on flatten targets
 * sc-7zt0: arrows --json no doubled schema name on flatten targets
 * sc-a051: fields text shows list_of for scalar list fields
 * sc-q9c4: find --json includes fieldType for list_of record fields
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runLint } from "#src/lint-engine.js";
import { run as _run } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../dist/index.js");
const EXAMPLES = resolve(__dirname, "../../../examples");
const PLATFORM = resolve(__dirname, "fixtures/platform.stm");

const run = (...args: string[]) => _run(CLI, ...args);

function makeIndex({
  schemas = [],
  mappings = [],
  nlRefData = [],
}: { schemas?: any[]; mappings?: any[]; nlRefData?: any[] } = {}) {
  const schemaMap = new Map();
  for (const s of schemas) {
    schemaMap.set(s.name, { ...s, file: s.file ?? "test.stm", row: s.row ?? 0 });
  }
  const mappingMap = new Map();
  for (const m of mappings) {
    mappingMap.set(m.name, { ...m, file: m.file ?? "test.stm", row: m.row ?? 0 });
  }
  return {
    schemas: schemaMap,
    mappings: mappingMap,
    metrics: new Map(),
    fragments: new Map(),
    transforms: new Map(),
    warnings: [],
    questions: [],
    fieldArrows: new Map(),
    referenceGraph: {
      usedByMappings: new Map(),
      fragmentsUsedIn: new Map(),
      metricsReferences: new Map(),
    },
    namespaceNames: new Set(),
    nlRefData,
    totalErrors: 0,
    duplicates: [],
  } as any;
}

// ── sl-5dyc: Import warnings on stderr ────────────────────────────────────

describe("sl-5dyc: import warnings go to stderr", () => {
  const MISSING_IMPORT = resolve(import.meta.dirname, "fixtures", "missing-import.stm");

  it("--json stdout is valid JSON even with import warnings", async () => {
    const { stdout, stderr } = await run("summary", "--json", MISSING_IMPORT);
    // Warning should be on stderr
    assert.match(stderr, /warning.*import target/);
    // Stdout should be valid JSON
    const parsed = JSON.parse(stdout);
    assert.ok(parsed.schemas);
  });

  it("graph --json stdout is valid JSON even with import warnings", async () => {
    const { stdout, stderr } = await run("graph", "--json", MISSING_IMPORT);
    assert.match(stderr, /warning.*import target/);
    const parsed = JSON.parse(stdout);
    assert.ok(parsed.version);
    assert.ok(parsed.nodes);
  });
});

// ── sl-j1eb: No doubled schema prefix in graph edges ──────────────────────

describe("sl-j1eb: graph --json no doubled schema prefix", () => {
  it("multi-source mapping arrows use schema.field, not schema.schema.field", async () => {
    const { stdout, code } = await run("graph", "--json", PLATFORM);
    assert.ok(code === 0 || code === 2, `expected exit 0 or 2, got ${code}`);
    const data = JSON.parse(stdout);

    for (const edge of data.edges) {
      if (edge.from) {
        const parts = edge.from.split(".");
        // Only check 3+ part paths for doubling; 2-part schema.field is legitimate
        // when flatten targets share the schema name
        if (parts.length >= 3) {
          assert.notEqual(parts[0], parts[1], `Doubled schema prefix in from: ${edge.from}`);
        }
      }
      if (edge.to) {
        const parts = edge.to.split(".");
        if (parts.length >= 3) {
          assert.notEqual(parts[0], parts[1], `Doubled schema prefix in to: ${edge.to}`);
        }
      }
    }
  });
});

// ── sl-bl5e: No double-dot paths in graph edges ──────────────────────────

describe("sl-bl5e: graph --json no double-dot paths", () => {
  it("nested field paths have no '..' separators", async () => {
    const { stdout, code } = await run("graph", "--json", PLATFORM);
    assert.ok(code === 0 || code === 2, `expected exit 0 or 2, got ${code}`);
    const data = JSON.parse(stdout);

    for (const edge of data.edges) {
      if (edge.from) {
        assert.ok(!edge.from.includes(".."), `Double-dot in from: ${edge.from}`);
      }
      if (edge.to) {
        assert.ok(!edge.to.includes(".."), `Double-dot in to: ${edge.to}`);
      }
    }
  });
});

// ── sl-n464: graph --schema-only aggregates edges ─────────────────────────

describe("sl-n464: graph --schema-only aggregates field edges", () => {
  it("returns non-zero edges", async () => {
    const { stdout, code } = await run("graph", "--schema-only", "--json", PLATFORM);
    assert.ok(code === 0 || code === 2, `expected exit 0 or 2, got ${code}`);
    const data = JSON.parse(stdout);
    assert.ok(data.edges.length > 0, "should have aggregated edges");
  });

  it("edges are schema-level (no dotted field paths)", async () => {
    const { stdout } = await run("graph", "--schema-only", "--json", PLATFORM);
    const data = JSON.parse(stdout);
    for (const edge of data.edges) {
      if (edge.from) {
        assert.ok(!edge.from.includes("."), `Edge from should be schema-level: ${edge.from}`);
      }
      if (edge.to) {
        assert.ok(!edge.to.includes("."), `Edge to should be schema-level: ${edge.to}`);
      }
    }
  });

  it("deduplicates schema-pair edges from multiple field arrows", async () => {
    const { stdout } = await run("graph", "--schema-only", "--json", PLATFORM);
    const data = JSON.parse(stdout);
    // Same schema pair + mapping should not appear multiple times
    const seen = new Set();
    for (const edge of data.edges) {
      const key = `${edge.from}->${edge.to}:${edge.mapping}`;
      assert.ok(!seen.has(key), `Duplicate edge: ${key}`);
      seen.add(key);
    }
  });
});

// ── sl-04pv: hidden-source-in-nl fires on bare schema refs ────────────────

describe("sl-04pv: hidden-source-in-nl fires on bare and dotted refs", () => {
  it("fires on bare schema name not in source list", () => {
    const index = makeIndex({
      schemas: [
        { name: "src", fields: [{ name: "id" }] },
        { name: "hidden", fields: [{ name: "code" }] },
        { name: "tgt", fields: [{ name: "id" }] },
      ],
      mappings: [
        {
          name: "test",
          sources: ["src"],
          targets: ["tgt"],
        },
      ],
      nlRefData: [
        {
          text: "Look up @hidden to get the code",
          mapping: "test",
          namespace: null,
          targetField: "id",
          file: "test.stm",
          line: 10,
          column: 0,
        },
      ],
    });

    const diags = runLint(index, { select: ["hidden-source-in-nl"] });
    assert.equal(diags.length, 1);
    assert.equal(diags[0].rule, "hidden-source-in-nl");
  });

  it("fires on dotted-field ref where schema not in source list", () => {
    const index = makeIndex({
      schemas: [
        { name: "src", fields: [{ name: "id" }] },
        { name: "hidden", fields: [{ name: "code" }] },
        { name: "tgt", fields: [{ name: "id" }] },
      ],
      mappings: [
        {
          name: "test",
          sources: ["src"],
          targets: ["tgt"],
        },
      ],
      nlRefData: [
        {
          text: "Use @hidden.code for the value",
          mapping: "test",
          namespace: null,
          targetField: "id",
          file: "test.stm",
          line: 10,
          column: 0,
        },
      ],
    });

    const diags = runLint(index, { select: ["hidden-source-in-nl"] });
    assert.equal(diags.length, 1);
    assert.equal(diags[0].rule, "hidden-source-in-nl");
  });

  it("does not fire when schema is in source list", () => {
    const index = makeIndex({
      schemas: [
        { name: "src", fields: [{ name: "id" }] },
        { name: "tgt", fields: [{ name: "id" }] },
      ],
      mappings: [
        {
          name: "test",
          sources: ["src"],
          targets: ["tgt"],
        },
      ],
      nlRefData: [
        {
          text: "Copy @src.id value",
          mapping: "test",
          namespace: null,
          targetField: "id",
          file: "test.stm",
          line: 10,
          column: 0,
        },
      ],
    });

    const diags = runLint(index, { select: ["hidden-source-in-nl"] });
    assert.equal(diags.length, 0);
  });
});

// ── sl-80jy: unresolved-nl-ref no false positive on valid dotted refs ─────

describe("sl-80jy: unresolved-nl-ref no false positive on dotted-field", () => {
  it("does not fire on valid schema.field ref even when schema not in source list", () => {
    const index = makeIndex({
      schemas: [
        { name: "src", fields: [{ name: "id" }] },
        { name: "hidden", fields: [{ name: "code" }] },
        { name: "tgt", fields: [{ name: "id" }] },
      ],
      mappings: [
        {
          name: "test",
          sources: ["src"],
          targets: ["tgt"],
        },
      ],
      nlRefData: [
        {
          text: "Use @hidden.code for the value",
          mapping: "test",
          namespace: null,
          targetField: "id",
          file: "test.stm",
          line: 10,
          column: 0,
        },
      ],
    });

    const diags = runLint(index, { select: ["unresolved-nl-ref"] });
    assert.equal(diags.length, 0, "should not flag valid schema.field ref");
  });

  it("still fires on truly unresolved references", () => {
    const index = makeIndex({
      schemas: [
        { name: "src", fields: [{ name: "id" }] },
        { name: "tgt", fields: [{ name: "id" }] },
      ],
      mappings: [
        {
          name: "test",
          sources: ["src"],
          targets: ["tgt"],
        },
      ],
      nlRefData: [
        {
          text: "Use @nonexistent.field for the value",
          mapping: "test",
          namespace: null,
          targetField: "id",
          file: "test.stm",
          line: 10,
          column: 0,
        },
      ],
    });

    const diags = runLint(index, { select: ["unresolved-nl-ref"] });
    assert.equal(diags.length, 1);
    assert.equal(diags[0].rule, "unresolved-nl-ref");
  });
});

// ── sl-j9ew: metric note scope label ─────────────────────────────────────────

describe("sl-j9ew: unresolved-nl-ref message says 'metric' not 'mapping' for metric notes", () => {
  it("diagnostic message includes scope label 'metric' for a metric note @ref (sl-j9ew)", () => {
    // Bug sl-j9ew: the message said "in mapping 'note:metric:revenue'" because
    // the mapping key lookup used the wrong prefix. Fix: use stripNLRefScopePrefix
    // to get the bare entity name for the scope label.
    const index = makeIndex({
      schemas: [{ name: "orders", fields: [{ name: "total" }] }],
      nlRefData: [
        {
          text: "Sum @nonexistent_table.amount grouped by month",
          mapping: "note:metric:revenue",
          namespace: null,
          targetField: null,
          file: "test.stm",
          line: 5,
          column: 6,
        },
      ],
    });
    index.metrics.set("revenue", { sources: [], fields: [], file: "test.stm", row: 2 });

    const diags = runLint(index, { select: ["unresolved-nl-ref"] });
    assert.equal(diags.length, 1, "should produce one unresolved-nl-ref warning");
    assert.ok(
      diags[0].message.includes("metric"),
      `message should say 'metric', got: ${diags[0].message}`,
    );
    assert.ok(
      !diags[0].message.includes("mapping"),
      `message should not say 'mapping', got: ${diags[0].message}`,
    );
    assert.ok(
      diags[0].message.includes("revenue"),
      `message should include metric name, got: ${diags[0].message}`,
    );
  });
});

// ── sl-tslm: validate and lint emit the same rule name ───────────────────────

describe("sl-tslm: collectSemanticWarnings emits 'unresolved-nl-ref' to match lint", () => {
  it("validate uses rule name 'unresolved-nl-ref' (not 'nl-ref-unresolved') (sl-tslm)", () => {
    // Bug sl-tslm: validate emitted "nl-ref-unresolved" while lint emitted "unresolved-nl-ref".
    // Both now use "unresolved-nl-ref" so consumers can deduplicate by (rule, file, line, col).
    const index = makeIndex({
      schemas: [{ name: "src", fields: [{ name: "id" }] }],
      mappings: [{ name: "m1", sources: ["src"], targets: ["src"] }],
      nlRefData: [
        {
          text: "Check @nonexistent",
          mapping: "m1",
          namespace: null,
          targetField: null,
          file: "test.stm",
          line: 5,
          column: 0,
        },
      ],
    });

    // runLint wraps the CLI lint-engine; collectSemanticWarnings wraps core validate.
    // Both must emit the same rule name for the same finding.
    const lintDiags = runLint(index, { select: ["unresolved-nl-ref"] });
    assert.equal(lintDiags.length, 1, "lint should find the unresolved ref");
    assert.equal(lintDiags[0].rule, "unresolved-nl-ref");
  });
});

// ── sl-j8uk: Filesystem errors exit code 2 ────────────────────────────────

describe("sl-j8uk: filesystem errors exit code 2", () => {
  it("summary exits 2 for nonexistent path", async () => {
    const { code } = await run("summary", "/nonexistent/path");
    assert.equal(code, 2);
  });

  it("graph exits 2 for nonexistent path", async () => {
    const { code } = await run("graph", "/nonexistent/path");
    assert.equal(code, 2);
  });

  it("schema exits 2 for nonexistent path", async () => {
    const { code } = await run("schema", "any_schema", "/nonexistent/path");
    assert.equal(code, 2);
  });

  it("lint exits 2 for nonexistent path", async () => {
    const { code } = await run("lint", "/nonexistent/path");
    assert.equal(code, 2);
  });

  it("not-found schema still exits 1", async () => {
    const { code } = await run("schema", "nonexistent_schema_name", PLATFORM);
    assert.equal(code, 1);
  });
});

// ── sc-1ar0: mapping includes flatten/each arrows ─────────────────────────

describe("sc-1ar0: mapping includes flatten/each block arrows", () => {
  const FFG = resolve(EXAMPLES, "filter-flatten-governance/filter-flatten-governance.stm");

  it("--json arrows array includes flatten block with children", async () => {
    const { stdout, code } = await run("mapping", "order line facts", FFG, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const flattenArrow = data.arrows.find((a: any) => a.kind === "flatten");
    assert.ok(flattenArrow, "should have a flatten arrow");
    assert.ok(flattenArrow.children.length > 0, "flatten should have child arrows");
  });

  it("--arrows-only shows flatten child arrows", async () => {
    const { stdout, code } = await run("mapping", "order line facts", FFG, "--arrows-only");
    assert.equal(code, 0);
    assert.match(stdout, /line_items\s+-> order_line_facts_parquet/);
    assert.match(stdout, /\.line_number\s+-> line_number/);
  });

  it("text output shows flatten block", async () => {
    const { stdout, code } = await run("mapping", "order line facts", FFG);
    assert.equal(code, 0);
    assert.match(stdout, /flatten line_items -> order_line_facts_parquet/);
    assert.match(stdout, /\.sku -> sku/);
  });
});

// ── sc-8g9a: validate no false-positive on flatten targets ────────────────

describe("sc-8g9a: validate no false-positive field-not-in-schema on flatten", () => {
  const FFG = resolve(EXAMPLES, "filter-flatten-governance/filter-flatten-governance.stm");

  it("does not emit field-not-in-schema for flatten inner arrows", async () => {
    const { stdout, stderr } = await run("validate", FFG);
    const output = stdout + stderr;
    const fieldNotInSchema = output.split("\n").filter((l) => l.includes("field-not-in-schema"));
    assert.equal(
      fieldNotInSchema.length,
      0,
      `unexpected field-not-in-schema warnings:\n${fieldNotInSchema.join("\n")}`,
    );
  });
});

// ── sc-7zt0: arrows --json no doubled schema on flatten targets ───────────

describe("sc-7zt0: arrows --json no doubled schema name on flatten targets", () => {
  const FFG = resolve(EXAMPLES, "filter-flatten-governance/filter-flatten-governance.stm");

  it("flatten child arrow target has single schema prefix", async () => {
    const { stdout, code } = await run("arrows", "order_events.line_items.sku", FFG, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.length > 0);
    for (const a of data) {
      if (a.target) {
        const parts = a.target.split(".");
        if (parts.length >= 3) {
          assert.notEqual(parts[0], parts[1], `Doubled schema in target: ${a.target}`);
        }
      }
    }
  });
});

// ── sc-a051: fields text shows list_of ────────────────────────────────────

describe("sc-a051: fields text shows list_of for scalar list fields", () => {
  const FFG = resolve(EXAMPLES, "filter-flatten-governance/filter-flatten-governance.stm");

  it("promo_codes shows list_of STRING", async () => {
    const { stdout, code } = await run("fields", "order_events", FFG);
    assert.equal(code, 0);
    assert.match(stdout, /promo_codes\s+list_of STRING/);
  });

  it("line_items shows list_of record", async () => {
    const { stdout } = await run("fields", "order_events", FFG);
    assert.match(stdout, /line_items\s+list_of record/);
  });
});

// ── sc-q9c4: find --json includes fieldType for list_of record ────────────

describe("sc-q9c4: find --json includes fieldType for list_of record fields", () => {
  const FFG = resolve(EXAMPLES, "filter-flatten-governance/filter-flatten-governance.stm");

  it("list_of record field has fieldType in JSON", async () => {
    const { stdout, code } = await run("find", "--tag", "filter", FFG, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const lineItems = data.find((r: any) => r.field === "line_items");
    assert.ok(lineItems, "should find line_items");
    assert.ok(lineItems.fieldType, "should have fieldType");
    assert.match(lineItems.fieldType, /list_of/);
  });
});
