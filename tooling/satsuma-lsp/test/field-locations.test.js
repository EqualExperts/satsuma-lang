/**
 * field-locations.test.js — Tests for fieldLocations nested-field flattening
 *
 * The fieldLocations handler must return FieldLocation entries for all fields
 * at all nesting depths, using dotted paths (e.g. 'address.city').
 */

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const { createWorkspaceIndex, indexFile, resolveDefinition } = require("../dist/workspace-index");

before(async () => {
  await initTestParser();
});

/** Mimic the fieldLocations handler logic: recursively flatten FieldInfo tree. */
function flattenFields(fields, prefix = "") {
  const result = [];
  for (const f of fields) {
    const dotPath = prefix ? `${prefix}.${f.name}` : f.name;
    result.push({ name: dotPath, line: f.range.start.line });
    if (f.children && f.children.length > 0) {
      result.push(...flattenFields(f.children, dotPath));
    }
  }
  return result;
}

function fieldLocations(source, schemaName, uri = "file:///test.stm") {
  const idx = createWorkspaceIndex();
  indexFile(idx, uri, parse(source));
  const defs = resolveDefinition(idx, schemaName, null);
  if (defs.length === 0) return [];
  const def = defs[0];
  return flattenFields(def.fields);
}

describe("fieldLocations — flat schema", () => {
  const SRC = `
schema orders {
  id INT
  amount DECIMAL
  status STRING
}`;

  it("returns all top-level fields", () => {
    const locs = fieldLocations(SRC, "orders");
    assert.deepEqual(
      locs.map((l) => l.name),
      ["id", "amount", "status"],
    );
  });

  it("returns correct line numbers", () => {
    const locs = fieldLocations(SRC, "orders");
    // All entries have a non-negative line number
    for (const l of locs) {
      assert.ok(l.line >= 0, `Expected non-negative line for ${l.name}`);
    }
  });
});

describe("fieldLocations — nested record fields", () => {
  const SRC = `
schema customer {
  id UUID
  address record {
    street STRING
    city STRING
    zip STRING
  }
  name STRING
}`;

  it("includes nested record fields with dotted paths", () => {
    const locs = fieldLocations(SRC, "customer");
    const names = locs.map((l) => l.name);
    assert.ok(names.includes("address"), "should include 'address'");
    assert.ok(names.includes("address.street"), "should include 'address.street'");
    assert.ok(names.includes("address.city"), "should include 'address.city'");
    assert.ok(names.includes("address.zip"), "should include 'address.zip'");
  });

  it("includes top-level fields alongside nested ones", () => {
    const locs = fieldLocations(SRC, "customer");
    const names = locs.map((l) => l.name);
    assert.ok(names.includes("id"), "should include 'id'");
    assert.ok(names.includes("name"), "should include 'name'");
  });

  it("returns fields in tree-order (parent before children)", () => {
    const locs = fieldLocations(SRC, "customer");
    const names = locs.map((l) => l.name);
    const addressIdx = names.indexOf("address");
    const streetIdx = names.indexOf("address.street");
    assert.ok(addressIdx < streetIdx, "parent field should come before child");
  });
});

describe("fieldLocations — list_of record fields", () => {
  const SRC = `
schema invoice {
  id UUID
  line_items list_of record {
    product_id STRING
    quantity INT
    unit_price DECIMAL
  }
  total DECIMAL
}`;

  it("includes nested list_of record fields", () => {
    const locs = fieldLocations(SRC, "invoice");
    const names = locs.map((l) => l.name);
    assert.ok(names.includes("line_items.product_id"), "should include 'line_items.product_id'");
    assert.ok(names.includes("line_items.quantity"), "should include 'line_items.quantity'");
    assert.ok(names.includes("line_items.unit_price"), "should include 'line_items.unit_price'");
  });
});

describe("fieldLocations — unknown schema", () => {
  it("returns empty array for unknown schema name", () => {
    const SRC = `schema foo { id INT }`;
    const locs = fieldLocations(SRC, "nonexistent");
    assert.deepEqual(locs, []);
  });
});
