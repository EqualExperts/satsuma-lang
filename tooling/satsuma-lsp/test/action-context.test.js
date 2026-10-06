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

  it("resolves a relative arrow path against its each container", () => {
    // bsw-89wr gave `.id` an arrow context; the lineage path it reports must be
    // the container's field, `src.orders.id`, not a bare `src.id`.
    const ctx = contextAt(
      "schema src {\n  orders list_of record {\n    id VARCHAR\n  }\n}\nmapping `m` {\n  source { src }\n  target { tgt }\n  each orders -> rows {\n    .id -> .id\n  }\n}",
      9,
      5,
    );
    assert.equal(ctx.schemaName, "src");
    assert.equal(ctx.fieldPath, "src.orders.id");
  });

  describe("resolves arrow paths through their enclosing each/flatten container (bsw-pv7a)", () => {
    // "Trace field lineage" sends fieldPath straight to the CLI, so it must
    // name the declared field the arrow resolves to (ADR-053), never the
    // authored text with its escape markers or a container-blind bare name.
    const FLATTEN = [
      "schema src {",
      "  survey_id UUID",
      "  transects list_of record {",
      "    transect_ref VARCHAR",
      "    sightings list_of record {",
      "      species VARCHAR",
      "      code VARCHAR",
      "    }",
      "  }",
      "}",
      "schema tgt {",
      "  survey_id UUID",
      "}",
      "mapping `m` {",
      "  source { src }",
      "  target { tgt }",
      "  flatten transects.sightings -> tgt {",
      "    ^.transect_ref -> survey_id",
      "    $.survey_id -> survey_id",
      "    .species -> survey_id",
      "    code -> survey_id",
      "  }",
      "}",
    ].join("\n");

    const rows = [
      // `^.` pops one container level: transects.sightings -> transects.
      { label: "^.transect_ref", line: 17, col: 7, expected: "src.transects.transect_ref" },
      // `$.` escapes to the schema root, discarding the container entirely.
      { label: "$.survey_id", line: 18, col: 7, expected: "src.survey_id" },
      // A leading `.` is relative to the container; it used to yield no context.
      { label: ".species", line: 19, col: 6, expected: "src.transects.sightings.species" },
      // A bare name inside a container is also container-relative.
      { label: "bare code", line: 20, col: 5, expected: "src.transects.sightings.code" },
    ];

    for (const { label, line, col, expected } of rows) {
      it(`reports ${expected} for ${label} inside flatten transects.sightings`, () => {
        const ctx = contextAt(FLATTEN, line, col);
        assert.equal(ctx.schemaName, "src");
        assert.equal(ctx.fieldPath, expected);
      });
    }

    const NESTED_EACH = [
      "schema src {",
      "  orders list_of record {",
      "    lines list_of record {",
      "      sku VARCHAR",
      "    }",
      "  }",
      "}",
      "schema tgt {",
      "  out list_of record {",
      "    order_id UUID",
      "    items list_of record {",
      "      sku VARCHAR",
      "    }",
      "  }",
      "}",
      "mapping `m` {",
      "  source { src }",
      "  target { tgt }",
      "  each orders -> out {",
      "    each lines -> items {",
      "      sku -> sku",
      "    }",
      "  }",
      "}",
    ].join("\n");

    it("qualifies a bare source path through two nested each containers", () => {
      // Each container level contributes its own segment; dropping either
      // traces the wrong field (src.sku does not exist).
      const ctx = contextAt(NESTED_EACH, 20, 7);
      assert.equal(ctx.schemaName, "src");
      assert.equal(ctx.fieldPath, "src.orders.lines.sku");
    });

    it("qualifies a bare target path through the target side of nested each containers", () => {
      // The target side resolves against the containers' target paths
      // (out.items), not their source paths.
      const ctx = contextAt(NESTED_EACH, 20, 14);
      assert.equal(ctx.schemaName, "tgt");
      assert.equal(ctx.fieldPath, "tgt.out.items.sku");
    });

    // A container-relative path whose first segment happens to share a
    // mapping schema's name: `src.x` inside `each orders` is the field
    // orders.src.x, not the schema `src` followed by its top-level `x`.
    const SHADOWED_PREFIX = [
      "schema src {",
      "  x UUID",
      "  orders list_of record {",
      "    src record {",
      "      x UUID",
      "    }",
      "  }",
      "}",
      "schema tgt {",
      "  z UUID",
      "  out list_of record {",
      "    y UUID",
      "  }",
      "}",
      "mapping `m` {",
      "  source { src }",
      "  target { tgt }",
      "  each orders -> out {",
      "    src.x -> y",
      "  }",
      "  src.x -> z",
      "}",
    ].join("\n");

    it("traces the same field whichever segment of a container-relative path the cursor is on", () => {
      // The first segment used to be read as the schema prefix, so the cursor
      // on `src` traced the top-level src.x while the cursor on `x` traced
      // src.orders.src.x: one arrow, two lineage targets.
      for (const col of [4, 8]) {
        const ctx = contextAt(SHADOWED_PREFIX, 18, col);
        assert.equal(ctx.schemaName, "src", `col ${col}`);
        assert.equal(ctx.fieldPath, "src.orders.src.x", `col ${col}`);
      }
    });

    it("still reads the first segment as the schema prefix at mapping-body level", () => {
      // Outside any container `src.x` is schema-qualified, so the prefix
      // case must keep naming the top-level field (gpt-jwek).
      const ctx = contextAt(SHADOWED_PREFIX, 20, 2);
      assert.equal(ctx.schemaName, "src");
      assert.equal(ctx.fieldPath, "src.x");
    });
  });

  it("returns enclosing field path for schema fields", () => {
    const ctx = contextAt("schema customers {\n  email VARCHAR\n}", 1, 3);
    assert.equal(ctx.schemaName, "customers");
    assert.equal(ctx.fieldPath, "customers.email");
  });
});
