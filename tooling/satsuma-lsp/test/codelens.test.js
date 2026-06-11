const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const { computeCodeLenses } = require("../dist/codelens");
const { createWorkspaceIndex, indexFile } = require("../dist/workspace-index");

before(async () => { await initTestParser(); });

function buildIndex(files) {
  const idx = createWorkspaceIndex();
  const trees = {};
  for (const [uri, source] of Object.entries(files)) {
    const tree = parse(source);
    trees[uri] = tree;
    indexFile(idx, uri, tree);
  }
  return { index: idx, trees };
}

/** Get CodeLens items for a given file in a multi-file workspace. */
function lenses(files, uri) {
  const { index, trees } = buildIndex(files);
  return computeCodeLenses(trees[uri], uri, index);
}

describe("computeCodeLenses", () => {
  it("returns empty for empty files", () => {
    const result = lenses({ "file:///a.stm": "" }, "file:///a.stm");
    assert.equal(result.length, 0);
  });

  it("shows field count for schema", () => {
    const result = lenses(
      { "file:///a.stm": "schema customers {\n  id UUID (pk)\n  name VARCHAR\n  email VARCHAR\n}" },
      "file:///a.stm",
    );
    assert.equal(result.length, 3);
    assert.ok(result.some((lens) => lens.command.title.includes("3 field(s)")));
  });

  it("shows mapping count for schema used in mappings", () => {
    const result = lenses(
      {
        "file:///a.stm": "schema customers {\n  id UUID\n}",
        "file:///b.stm": "mapping `a` {\n  source { customers }\n  target { dim }\n  id -> id\n}",
        "file:///c.stm": "mapping `b` {\n  source { customers }\n  target { fact }\n  id -> id\n}",
      },
      "file:///a.stm",
    );
    assert.equal(result.length, 3);
    assert.ok(result.some((lens) => lens.command.title.includes("used in 2 mapping(s)")));
  });

  it("counts a mapping once when it uses the schema as both source and target", () => {
    // sl-0tgo: findMappingsUsing deduped reference sites by line, so a mapping
    // naming the schema in its source AND target blocks counted twice. The
    // lens must report distinct mappings.
    const result = lenses(
      {
        "file:///a.stm": "schema customers {\n  id UUID\n}",
        "file:///b.stm": "mapping `self` {\n  source { customers }\n  target { customers }\n  id -> id\n}",
      },
      "file:///a.stm",
    );
    assert.ok(
      result.some((lens) => lens.command.title.includes("used in 1 mapping(s)")),
      `expected one distinct mapping, got: ${result.map((l) => l.command.title).join("; ")}`,
    );
  });

  it("adds clickable lineage actions for schemas", () => {
    const result = lenses(
      { "file:///a.stm": "schema customers {\n  id UUID\n}" },
      "file:///a.stm",
    );
    const lineageFrom = result.find((lens) => lens.command.title === "Lineage from");
    const lineageTo = result.find((lens) => lens.command.title === "Lineage to");

    assert.ok(lineageFrom);
    assert.equal(lineageFrom.command.command, "satsuma.showLineage");
    assert.deepEqual(lineageFrom.command.arguments, [{ schemaName: "customers", direction: "from" }]);

    assert.ok(lineageTo);
    assert.equal(lineageTo.command.command, "satsuma.showLineage");
    assert.deepEqual(lineageTo.command.arguments, [{ schemaName: "customers", direction: "to" }]);
  });

  it("shows spread count for fragments", () => {
    const result = lenses(
      {
        "file:///a.stm": `fragment audit_fields {
  ts TIMESTAMP
}
schema customers {
  id UUID
  ...audit_fields
}
schema orders {
  id UUID
  ...audit_fields
}`,
      },
      "file:///a.stm",
    );
    const fragLens = result.find((l) => l.command.title.includes("spread in"));
    assert.ok(fragLens);
    assert.ok(fragLens.command.title.includes("2 place(s)"));
  });

  it("shows source → target for mappings", () => {
    const result = lenses(
      {
        "file:///a.stm": `mapping \`migrate\` {
  source { customers }
  target { dim_customers }
  id -> id
  name -> name
}`,
      },
      "file:///a.stm",
    );
    assert.equal(result.length, 1);
    assert.ok(result[0].command.title.includes("customers"));
    assert.ok(result[0].command.title.includes("dim_customers"));
    assert.ok(result[0].command.title.includes("2 arrow(s)"));
  });

  it("shows source info for metrics", () => {
    // Metrics are now schema blocks with (metric, source ...) metadata.
    const result = lenses(
      {
        "file:///a.stm": `schema monthly_revenue (\n  metric,\n  metric_name "MRR",\n  source orders,\n) {\n  amount DECIMAL\n}`,
      },
      "file:///a.stm",
    );
    assert.equal(result.length, 1);
    assert.ok(result[0].command.title.includes("sources:"));
  });

  it("shows usage count for transforms", () => {
    const result = lenses(
      {
        "file:///a.stm": `transform \`clean email\` {
  trim | lowercase
}
mapping \`test\` {
  source { src }
  target { tgt }
  email -> email { ...clean email }
}`,
      },
      "file:///a.stm",
    );
    const transformLens = result.find((l) =>
      l.command.title.includes("used in"),
    );
    assert.ok(transformLens);
  });

  it("handles namespaced blocks", () => {
    const result = lenses(
      {
        "file:///a.stm": `namespace crm {
  schema customers {
    id UUID
  }
}`,
      },
      "file:///a.stm",
    );
    // Should have a lens for the schema inside the namespace
    assert.ok(result.length >= 1);
    assert.ok(result.some((l) => l.command.title.includes("1 field(s)")));
  });

  it("lens range points to block label", () => {
    const result = lenses(
      { "file:///a.stm": "schema customers {\n  id UUID\n}" },
      "file:///a.stm",
    );
    assert.equal(result.length, 3);
    assert.equal(result[0].range.start.line, 0);
  });
});
