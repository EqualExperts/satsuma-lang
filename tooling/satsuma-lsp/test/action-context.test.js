const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const { computeActionContext } = require("../dist/action-context");
const { createWorkspaceIndex, indexFile } = require("../dist/workspace-index");

before(async () => {
  await initTestParser();
});

function contextAt(source, line, col) {
  const uri = "file:///workspace/test.stm";
  const tree = parse(source);
  const index = createWorkspaceIndex();
  indexFile(index, uri, tree);
  return computeActionContext(tree, line, col, uri, index);
}

describe("computeActionContext", () => {
  it("returns schema lineage context on schema labels", () => {
    const ctx = contextAt("schema customers {\n  id UUID\n}", 0, 8);
    assert.equal(ctx.schemaName, "customers");
    assert.equal(ctx.fieldPath, null);
  });

  it("returns source field lineage context from arrow paths", () => {
    const ctx = contextAt(
      "schema customers {\n  email VARCHAR\n}\nschema dim_customers {\n  email VARCHAR\n}\nmapping `m` {\n  source { customers }\n  target { dim_customers }\n  email -> email\n}",
      9,
      3,
    );
    assert.equal(ctx.schemaName, "customers");
    assert.equal(ctx.fieldPath, "customers.email");
  });

  it("returns full nested target field lineage context", () => {
    const ctx = contextAt(
      "schema src {\n  order_id UUID\n}\nschema tgt {\n  address record {\n    city VARCHAR\n  }\n}\nmapping `m` {\n  source { src }\n  target { tgt }\n  order_id -> address.city\n}",
      11,
      16,
    );
    assert.equal(ctx.schemaName, "tgt");
    assert.equal(ctx.fieldPath, "tgt.address.city");
  });

  it("keeps explicit schema qualification in multi-source arrows", () => {
    const ctx = contextAt(
      "schema customers {\n  email VARCHAR\n}\nschema orders {\n  email VARCHAR\n}\nschema tgt {\n  email VARCHAR\n}\nmapping `m` {\n  source { customers, orders }\n  target { tgt }\n  customers.email -> email\n}",
      12,
      6,
    );
    assert.equal(ctx.schemaName, "customers");
    assert.equal(ctx.fieldPath, "customers.email");
  });

  it("returns enclosing field path for schema fields", () => {
    const ctx = contextAt("schema customers {\n  email VARCHAR\n}", 1, 3);
    assert.equal(ctx.schemaName, "customers");
    assert.equal(ctx.fieldPath, "customers.email");
  });
});
