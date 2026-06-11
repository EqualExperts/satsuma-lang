const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const {
  createWorkspaceIndex,
  createScopedIndex,
  getImportReachableUris,
  indexFile,
} = require("../dist/workspace-index");
const { buildVizModel, mergeVizModels } = require("../dist/viz-model");

before(async () => { await initTestParser(); });

/** Build a VizModel from source text. */
function vizModel(source, uri = "file:///test.stm") {
  const tree = parse(source);
  const idx = createWorkspaceIndex();
  indexFile(idx, uri, tree);
  return buildVizModel(uri, tree, idx);
}

/** Build a VizModel with a workspace index pre-populated from multiple files. */
function vizModelMulti(files, targetUri) {
  const idx = createWorkspaceIndex();
  const trees = {};
  for (const [uri, source] of Object.entries(files)) {
    const tree = parse(source);
    trees[uri] = tree;
    indexFile(idx, uri, tree);
  }
  return buildVizModel(targetUri, trees[targetUri], idx);
}

/**
 * Like vizModelMulti but scopes the index to the import-reachable set of
 * targetUri, matching the production behaviour in server.ts.
 */
function vizModelScoped(files, targetUri) {
  const idx = createWorkspaceIndex();
  const trees = {};
  for (const [uri, source] of Object.entries(files)) {
    const tree = parse(source);
    trees[uri] = tree;
    indexFile(idx, uri, tree);
  }
  const reachable = getImportReachableUris(targetUri, idx);
  const scoped = createScopedIndex(idx, reachable);
  return buildVizModel(targetUri, trees[targetUri], scoped);
}

/**
 * Build a full-lineage merged VizModel, mirroring the satsuma/vizFullLineage
 * endpoint: builds per-file VizModels for all import-reachable files, then
 * merges them.
 */
function vizModelFullLineage(files, targetUri) {
  const idx = createWorkspaceIndex();
  const trees = {};
  for (const [uri, source] of Object.entries(files)) {
    const tree = parse(source);
    trees[uri] = tree;
    indexFile(idx, uri, tree);
  }
  const reachable = getImportReachableUris(targetUri, idx);
  const models = [];
  for (const fileUri of reachable) {
    if (!trees[fileUri]) continue;
    const scoped = createScopedIndex(idx, getImportReachableUris(fileUri, idx));
    models.push(buildVizModel(fileUri, trees[fileUri], scoped));
  }
  return mergeVizModels(targetUri, models);
}

// ---------- Basic structure ----------

describe("buildVizModel", () => {
  it("returns a model with the given URI", () => {
    const model = vizModel("schema foo { id INT }");
    assert.equal(model.uri, "file:///test.stm");
  });

  it("returns empty namespaces for empty file", () => {
    const model = vizModel("");
    assert.equal(model.namespaces.length, 0);
    assert.equal(model.fileNotes.length, 0);
  });
});

// ---------- File-level notes ----------

describe("file notes", () => {
  it("extracts single-line notes", () => {
    const model = vizModel('note { "A simple note" }');
    assert.equal(model.fileNotes.length, 1);
    assert.equal(model.fileNotes[0].text, "A simple note");
    assert.equal(model.fileNotes[0].isMultiline, false);
  });

  it("extracts multiline notes", () => {
    const model = vizModel('note {\n  """\n  # Title\n  Body text.\n  """\n}');
    assert.equal(model.fileNotes.length, 1);
    assert.equal(model.fileNotes[0].isMultiline, true);
    assert.ok(model.fileNotes[0].text.includes("Title"));
  });
});

// ---------- Schemas ----------

describe("schemas", () => {
  it("extracts a basic schema", () => {
    const model = vizModel("schema customers {\n  id UUID (pk)\n  name VARCHAR\n}");
    assert.equal(model.namespaces.length, 1);
    const ns = model.namespaces[0];
    assert.equal(ns.name, null);
    assert.equal(ns.schemas.length, 1);
    const schema = ns.schemas[0];
    assert.equal(schema.id, "customers");
    assert.equal(schema.qualifiedId, "customers");
    assert.equal(schema.kind, "schema");
  });

  it("extracts fields with types and constraints", () => {
    const model = vizModel(
      "schema users {\n  id UUID (pk, required)\n  email STRING (pii)\n  name VARCHAR\n}",
    );
    const fields = model.namespaces[0].schemas[0].fields;
    assert.equal(fields.length, 3);
    assert.equal(fields[0].name, "id");
    assert.equal(fields[0].type, "UUID");
    assert.deepEqual(fields[0].constraints, ["pk", "required"]);
    assert.equal(fields[1].name, "email");
    assert.deepEqual(fields[1].constraints, ["pii"]);
    assert.equal(fields[2].name, "name");
  });

  it("extracts schema with note metadata", () => {
    const model = vizModel(
      'schema foo (note "My description") {\n  id INT\n}',
    );
    const schema = model.namespaces[0].schemas[0];
    assert.equal(schema.label, "My description");
  });

  it("extracts backtick-named schemas", () => {
    const model = vizModel("schema `my schema` {\n  id INT\n}");
    const schema = model.namespaces[0].schemas[0];
    assert.equal(schema.id, "my schema");
  });

  it("extracts nested record fields", () => {
    const model = vizModel(
      "schema events {\n  data record {\n    id UUID\n    name STRING\n  }\n}",
    );
    const fields = model.namespaces[0].schemas[0].fields;
    assert.equal(fields.length, 1);
    assert.equal(fields[0].name, "data");
    assert.equal(fields[0].type, "record");
    assert.equal(fields[0].children.length, 2);
    assert.equal(fields[0].children[0].name, "id");
  });

  it("extracts list_of fields", () => {
    const model = vizModel(
      "schema events {\n  tags list_of STRING\n  items list_of record {\n    sku STRING\n  }\n}",
    );
    const fields = model.namespaces[0].schemas[0].fields;
    assert.equal(fields[0].type, "list_of STRING");
    assert.equal(fields[1].type, "list_of record");
    assert.equal(fields[1].children.length, 1);
  });
});

// ---------- Fragments ----------

describe("fragments", () => {
  it("strips fragment nodes after spread resolution (fragments are authoring shorthand only)", () => {
    const model = vizModel(
      "fragment `audit fields` {\n  created_at TIMESTAMP\n  updated_at TIMESTAMP\n}",
    );
    // Fragment-only file: namespace group is omitted entirely (no schemas/mappings/metrics)
    // or has an empty fragments array if it was included for other content.
    for (const ns of model.namespaces) {
      assert.equal(ns.fragments.length, 0);
    }
  });
});

// ---------- Mappings ----------

describe("mappings", () => {
  it("extracts a basic mapping with source, target, and arrows", () => {
    const model = vizModel(
      "schema src { id INT\n name STRING }\n" +
      "schema tgt { id INT\n name STRING }\n" +
      "mapping m1 {\n  source { src }\n  target { tgt }\n  id -> id\n  name -> name\n}",
    );
    const mapping = model.namespaces[0].mappings[0];
    assert.equal(mapping.id, "m1");
    assert.deepEqual(mapping.sourceRefs, ["src"]);
    assert.equal(mapping.targetRef, "tgt");
    assert.equal(mapping.arrows.length, 2);
  });

  it("extracts arrow source and target fields", () => {
    const model = vizModel(
      "schema s { a INT }\nschema t { b INT }\n" +
      "mapping m {\n  source { s }\n  target { t }\n  a -> b\n}",
    );
    const arrow = model.namespaces[0].mappings[0].arrows[0];
    assert.deepEqual(arrow.sourceFields, ["a"]);
    assert.equal(arrow.targetField, "b");
    assert.equal(arrow.transform, null);
  });

  // After Feature 28, all pipe steps are NL — bare tokens like trim/lowercase
  // are treated the same as quoted NL strings. kind is "nl" for all non-map
  // transforms.
  it("extracts bare-token transforms as NL kind", () => {
    const model = vizModel(
      "schema s { a INT }\nschema t { b INT }\n" +
      "mapping m {\n  source { s }\n  target { t }\n  a -> b { trim | lowercase }\n}",
    );
    const tf = model.namespaces[0].mappings[0].arrows[0].transform;
    assert.ok(tf);
    assert.equal(tf.kind, "nl");
    assert.deepEqual(tf.steps, ["trim", "lowercase"]);
  });

  it("extracts quoted NL transforms as NL kind", () => {
    const model = vizModel(
      "schema s { a INT }\nschema t { b INT }\n" +
      'mapping m {\n  source { s }\n  target { t }\n  a -> b { "Convert to uppercase" }\n}',
    );
    const tf = model.namespaces[0].mappings[0].arrows[0].transform;
    assert.ok(tf);
    assert.equal(tf.kind, "nl");
  });

  it("extracts mixed bare + quoted transforms as NL kind", () => {
    const model = vizModel(
      "schema s { a INT }\nschema t { b INT }\n" +
      'mapping m {\n  source { s }\n  target { t }\n  a -> b {\n    "Do something"\n    | round(2)\n  }\n}',
    );
    const tf = model.namespaces[0].mappings[0].arrows[0].transform;
    assert.ok(tf);
    assert.equal(tf.kind, "nl");
    assert.ok(tf.steps.length > 0);
  });

  it("extracts map block transforms", () => {
    const model = vizModel(
      "schema s { status STRING }\nschema t { stage STRING }\n" +
      'mapping m {\n  source { s }\n  target { t }\n  status -> stage {\n    map {\n      A: "alpha"\n      B: "beta"\n    }\n  }\n}',
    );
    const tf = model.namespaces[0].mappings[0].arrows[0].transform;
    assert.ok(tf);
    assert.equal(tf.kind, "map");
  });

  it("extracts computed arrows (no source)", () => {
    const model = vizModel(
      "schema s { a INT }\nschema t { b INT }\n" +
      'mapping m {\n  source { s }\n  target { t }\n  -> b { "Compute something" }\n}',
    );
    const arrow = model.namespaces[0].mappings[0].arrows[0];
    assert.deepEqual(arrow.sourceFields, []);
    assert.equal(arrow.targetField, "b");
  });

  it("extracts multi-source arrows", () => {
    const model = vizModel(
      "schema s { a STRING\n  b STRING }\nschema t { c STRING }\n" +
      'mapping m {\n  source { s }\n  target { t }\n  a, b -> c { "Concat" }\n}',
    );
    const arrow = model.namespaces[0].mappings[0].arrows[0];
    assert.equal(arrow.sourceFields.length, 2);
    assert.equal(arrow.sourceFields[0], "a");
    assert.equal(arrow.sourceFields[1], "b");
  });

  it("extracts source block with join description", () => {
    const model = vizModel(
      "schema a { id INT }\nschema b { id INT }\nschema t { id INT }\n" +
      'mapping m {\n  source {\n    a\n    b\n    "Join on a.id = b.id"\n  }\n  target { t }\n  a.id -> id\n}',
    );
    const sb = model.namespaces[0].mappings[0].sourceBlock;
    assert.ok(sb);
    assert.deepEqual(sb.schemas, ["a", "b"]);
    assert.equal(sb.joinDescription, "Join on a.id = b.id");
  });

  it("resolves local namespaced mapping refs to qualified schema ids", () => {
    const model = vizModel(
      "namespace warehouse {\n" +
      "  schema src { id INT }\n" +
      "  schema tgt { id INT }\n" +
      "  mapping m {\n" +
      "    source { src }\n" +
      "    target { tgt }\n" +
      "    id -> id\n" +
      "  }\n" +
      "}",
    );
    const mapping = model.namespaces.find((ns) => ns.name === "warehouse").mappings[0];
    assert.deepEqual(mapping.sourceRefs, ["warehouse::src"]);
    assert.equal(mapping.targetRef, "warehouse::tgt");
    assert.deepEqual(mapping.sourceBlock.schemas, ["warehouse::src"]);
  });

  it("falls back to global schema refs from inside namespaces", () => {
    const model = vizModel(
      "schema global_src { id INT }\n" +
      "namespace warehouse {\n" +
      "  schema tgt { id INT }\n" +
      "  mapping m {\n" +
      "    source { global_src }\n" +
      "    target { tgt }\n" +
      "    id -> id\n" +
      "  }\n" +
      "}",
    );
    const mapping = model.namespaces.find((ns) => ns.name === "warehouse").mappings[0];
    assert.deepEqual(mapping.sourceRefs, ["global_src"]);
    assert.equal(mapping.targetRef, "warehouse::tgt");
  });

  it("does not treat source join descriptions as source refs", () => {
    const model = vizModel(
      "schema a { id INT }\nschema b { id INT }\nschema t { id INT }\n" +
      'mapping m {\n  source {\n    a\n    b\n    "Join on a.id = b.id"\n  }\n  target { t }\n  a.id -> id\n}',
    );
    const mapping = model.namespaces[0].mappings[0];
    assert.deepEqual(mapping.sourceRefs, ["a", "b"]);
  });

  it("extracts flatten blocks", () => {
    const model = vizModel(
      "schema s { items list_of record { sku STRING } }\n" +
      "schema t { sku STRING }\n" +
      "mapping m {\n  source { s }\n  target { t }\n  flatten items -> t {\n    .sku -> sku\n  }\n}",
    );
    const mapping = model.namespaces[0].mappings[0];
    assert.equal(mapping.flattenBlocks.length, 1);
    assert.equal(mapping.flattenBlocks[0].sourceField, "items");
    assert.equal(mapping.flattenBlocks[0].arrows.length, 1);
  });

  it("extracts mapping-level notes", () => {
    const model = vizModel(
      "schema s { a INT }\nschema t { b INT }\n" +
      'mapping m {\n  note { "Mapping note" }\n  source { s }\n  target { t }\n  a -> b\n}',
    );
    const mapping = model.namespaces[0].mappings[0];
    assert.equal(mapping.notes.length, 1);
    assert.equal(mapping.notes[0].text, "Mapping note");
  });
});

// ---------- Metrics ----------

describe("metrics", () => {
  it("extracts basic metric", () => {
    // Metrics are now schema blocks with (metric, metric_name "...", ...) metadata.
    const model = vizModel(
      'schema mrr (\n  metric,\n  metric_name "MRR",\n  source subs,\n  grain monthly,\n) {\n  value DECIMAL(14,2) (measure additive)\n}',
    );
    const ns = model.namespaces[0];
    assert.equal(ns.metrics.length, 1);
    const metric = ns.metrics[0];
    assert.equal(metric.id, "mrr");
    assert.equal(metric.label, "MRR");
    assert.deepEqual(metric.source, ["subs"]);
    assert.equal(metric.grain, "monthly");
  });

  it("extracts metric fields with measure types", () => {
    const model = vizModel(
      "schema m1 (metric, source s) {\n" +
      "  val DECIMAL (measure additive)\n" +
      "  avg DECIMAL (measure non_additive)\n" +
      "  half DECIMAL (measure semi_additive)\n" +
      "}",
    );
    const fields = model.namespaces[0].metrics[0].fields;
    assert.equal(fields.length, 3);
    assert.equal(fields[0].measure, "additive");
    assert.equal(fields[1].measure, "non_additive");
    assert.equal(fields[2].measure, "semi_additive");
  });

  it("extracts metric with slices", () => {
    const model = vizModel(
      "schema m1 (metric, source s, slice {a, b, c}) {\n  val DECIMAL (measure)\n}",
    );
    const metric = model.namespaces[0].metrics[0];
    assert.deepEqual(metric.slices, ["a", "b", "c"]);
  });

  it("extracts metric with filter", () => {
    const model = vizModel(
      'schema m1 (metric, source s, filter "status = active") {\n  val DECIMAL (measure)\n}',
    );
    const metric = model.namespaces[0].metrics[0];
    assert.equal(metric.filter, "status = active");
  });

  it("extracts bare measure tag as additive", () => {
    const model = vizModel(
      "schema m1 (metric, source s) {\n  count INT (measure)\n}",
    );
    const fields = model.namespaces[0].metrics[0].fields;
    assert.equal(fields[0].measure, "additive");
  });
});

// ---------- Namespaces ----------

describe("namespaces", () => {
  it("groups schemas under their namespace", () => {
    const model = vizModel(
      "namespace pos {\n  schema stores { id INT }\n  schema txns { id INT }\n}",
    );
    // No global namespace (no global-level blocks)
    const ns = model.namespaces.find((n) => n.name === "pos");
    assert.ok(ns);
    assert.equal(ns.schemas.length, 2);
    assert.equal(ns.schemas[0].qualifiedId, "pos::stores");
  });

  it("separates global and namespaced blocks", () => {
    const model = vizModel(
      "schema global_s { id INT }\n" +
      "namespace ns1 {\n  schema ns_s { id INT }\n}",
    );
    assert.equal(model.namespaces.length, 2);
    const global = model.namespaces.find((n) => n.name === null);
    assert.ok(global);
    assert.equal(global.schemas.length, 1);
    assert.equal(global.schemas[0].id, "global_s");
    const ns1 = model.namespaces.find((n) => n.name === "ns1");
    assert.ok(ns1);
    assert.equal(ns1.schemas.length, 1);
  });

  it("handles mappings inside namespaces", () => {
    const model = vizModel(
      "namespace wh {\n" +
      "  schema src { id INT }\n" +
      "  schema tgt { id INT }\n" +
      "  mapping load {\n    source { src }\n    target { tgt }\n    id -> id\n  }\n" +
      "}",
    );
    const ns = model.namespaces.find((n) => n.name === "wh");
    assert.ok(ns);
    assert.equal(ns.mappings.length, 1);
    assert.equal(ns.mappings[0].id, "load");
  });
});

// ---------- Comments ----------

describe("comments", () => {
  it("extracts warning comments from fields", () => {
    const model = vizModel(
      "schema s {\n  email STRING //! PII risk\n}",
    );
    const schema = model.namespaces[0].schemas[0];
    // Warning comments appear on the schema or the field
    const allComments = [
      ...schema.comments,
      ...schema.fields.flatMap((f) => f.comments),
    ];
    assert.ok(allComments.some((c) => c.kind === "warning"));
  });

  it("extracts question comments", () => {
    const model = vizModel(
      "schema s {\n  status STRING //? Should this be an enum?\n}",
    );
    const schema = model.namespaces[0].schemas[0];
    const allComments = [
      ...schema.comments,
      ...schema.fields.flatMap((f) => f.comments),
    ];
    assert.ok(allComments.some((c) => c.kind === "question"));
  });

  it("attaches a standalone comment between top-level blocks to the preceding block", () => {
    // Control case for the namespaced fix below: standalone //! siblings of
    // global blocks attach to the nearest preceding schema.
    const model = vizModel(
      "schema s {\n  id INT\n}\n//! needs review\nschema t {\n  id INT\n}",
    );
    const s = model.namespaces[0].schemas.find((x) => x.id === "s");
    assert.equal(s.comments.length, 1);
    assert.equal(s.comments[0].kind, "warning");
  });

  it("attaches standalone comments inside a namespace to the preceding block (sl-ebs9)", () => {
    // collectTopLevelComments walked only root children and resolved blocks
    // against the global group, so //! and //? between blocks inside a
    // namespace vanished from the model and the warnings pane undercounted.
    const model = vizModel(
      "namespace crm {\n  schema s {\n    id INT\n  }\n  //! stale source\n  //? still needed?\n  schema t {\n    id INT\n  }\n}",
    );
    const ns = model.namespaces.find((n) => n.name === "crm");
    const s = ns.schemas.find((x) => x.id === "s");
    assert.equal(s.comments.length, 2);
    assert.deepEqual(s.comments.map((c) => c.kind).sort(), ["question", "warning"]);
  });
});

// ---------- External lineage ----------

describe("external lineage", () => {
  it("detects external lineage when schema is referenced from another file", () => {
    const model = vizModelMulti(
      {
        "file:///a.stm": "schema customers { id INT }",
        "file:///b.stm": "schema tgt { id INT }\nmapping m {\n  source { customers }\n  target { tgt }\n  id -> id\n}",
      },
      "file:///a.stm",
    );
    const schema = model.namespaces[0].schemas[0];
    assert.equal(schema.hasExternalLineage, true);
  });

  it("reports no external lineage when only referenced within same file", () => {
    const model = vizModel(
      "schema s { id INT }\nschema t { id INT }\nmapping m {\n  source { s }\n  target { t }\n  id -> id\n}",
    );
    const schema = model.namespaces[0].schemas.find((s) => s.id === "s");
    assert.ok(schema);
    assert.equal(schema.hasExternalLineage, false);
  });
});

// ---------- Source locations ----------

describe("source locations", () => {
  it("includes correct line numbers for schemas", () => {
    const model = vizModel("schema foo {\n  id INT\n}");
    const loc = model.namespaces[0].schemas[0].location;
    assert.equal(loc.line, 0);
    assert.equal(loc.character, 0);
    assert.equal(loc.uri, "file:///test.stm");
  });

  it("includes correct line numbers for fields", () => {
    const model = vizModel("schema foo {\n  id INT\n  name STRING\n}");
    const fields = model.namespaces[0].schemas[0].fields;
    assert.equal(fields[0].location.line, 1);
    assert.equal(fields[1].location.line, 2);
  });
});

// ---------- Example file coverage ----------

describe("example file coverage", () => {
  const fs = require("fs");
  const path = require("path");
  const examplesDir = path.resolve(__dirname, "../../../examples");

  // Test all .stm files found recursively under the examples directory
  let exampleFiles;
  try {
    exampleFiles = fs
      .readdirSync(examplesDir, { recursive: true })
      .filter((f) => f.endsWith(".stm"));
  } catch {
    exampleFiles = [];
  }

  for (const filename of exampleFiles) {
    it(`produces a valid VizModel for ${filename}`, () => {
      const source = fs.readFileSync(path.join(examplesDir, filename), "utf-8");
      const uri = `file:///${filename}`;
      // Should not throw
      const model = vizModel(source, uri);
      assert.ok(model);
      assert.equal(model.uri, uri);
      // Every namespace should have valid arrays
      for (const ns of model.namespaces) {
        assert.ok(Array.isArray(ns.schemas));
        assert.ok(Array.isArray(ns.mappings));
        assert.ok(Array.isArray(ns.metrics));
        assert.ok(Array.isArray(ns.fragments));
      }
    });
  }
});

// ---------- Fragment spread resolution ----------

describe("fragment spreads", () => {
  it("resolves cross-namespace spreads into schema fields", () => {
    const src = `
namespace common {
  fragment common_fields {
    a  x
    b  x
  }
}
namespace src {
  schema s1 {
    ...common::common_fields
    c  x
  }
}
`;
    const model = vizModel(src);
    const srcNs = model.namespaces.find((ns) => ns.name === "src");
    const schema = srcNs.schemas.find((s) => s.qualifiedId === "src::s1");
    // Spread fields (a, b) merged in; direct field (c) still present
    const fieldNames = schema.fields.map((f) => f.name);
    assert.ok(fieldNames.includes("a"), "spread field a should be resolved");
    assert.ok(fieldNames.includes("b"), "spread field b should be resolved");
    assert.ok(fieldNames.includes("c"), "direct field c should be present");
    // spreads list cleared after resolution
    assert.deepEqual(schema.spreads, []);
  });

  it("strips fragment nodes from namespace groups after resolution", () => {
    const src = `
namespace common {
  fragment common_fields {
    a  x
    b  x
  }
}
namespace src {
  schema s1 {
    ...common::common_fields
    c  x
  }
}
`;
    const model = vizModel(src);
    for (const ns of model.namespaces) {
      assert.equal(ns.fragments.length, 0, `namespace ${ns.name} should have no fragments`);
    }
  });

  it("resolves recursive spreads (fragment spreading another fragment)", () => {
    const src = `
namespace common {
  fragment base_fields {
    id  x
    ts  x
  }
  fragment audit_fields {
    ...common::base_fields
    created_by  x
  }
}
namespace src {
  schema s1 {
    ...common::audit_fields
    name  x
  }
}
`;
    const model = vizModel(src);
    const srcNs = model.namespaces.find((ns) => ns.name === "src");
    const schema = srcNs.schemas[0];
    const names = schema.fields.map((f) => f.name);
    // Should contain fields from both fragments plus direct field
    assert.ok(names.includes("id"), "base field id should be transitively resolved");
    assert.ok(names.includes("ts"), "base field ts should be transitively resolved");
    assert.ok(names.includes("created_by"), "audit field created_by should be resolved");
    assert.ok(names.includes("name"), "direct field name should be present");
  });

  it("resolves bare spreads of a fragment in the same namespace (sl-22ym)", () => {
    // A bare `...audit` inside `namespace crm` must resolve to crm::audit.
    // Regression: expansion ran with currentNs=null so the namespace-qualified
    // fragment key was never tried and the spread's fields were silently lost.
    const src = `
namespace crm {
  fragment audit {
    created_at  x
  }
  schema customers {
    ...audit
    id  x
  }
}
`;
    const model = vizModel(src);
    const crmNs = model.namespaces.find((ns) => ns.name === "crm");
    const schema = crmNs.schemas.find((s) => s.qualifiedId === "crm::customers");
    const names = schema.fields.map((f) => f.name);
    assert.ok(names.includes("created_at"), "same-namespace spread field should be resolved");
    assert.ok(names.includes("id"), "direct field id should be present");
    assert.deepEqual(schema.spreads, [], "resolved spread should be cleared");
  });

  it("preserves unresolvable spreads so the card still shows the reference", () => {
    // A spread naming a fragment that doesn't exist cannot be expanded, but it
    // must not be silently erased either — the schema card renders remaining
    // `spreads` entries as a visible "… spreads X" indicator.
    const src = `
schema s1 {
  ...does_not_exist
  id  x
}
`;
    const model = vizModel(src);
    const schema = model.namespaces[0].schemas[0];
    assert.deepEqual(schema.spreads, ["does_not_exist"], "unresolvable spread should be preserved");
    assert.deepEqual(
      schema.fields.map((f) => f.name),
      ["id"],
      "no phantom fields should be added",
    );
  });

  it("preserves direct fields alongside spread fields", () => {
    const src = `
namespace common {
  fragment common_fields {
    a  x
    b  x
    c  x
  }
}
namespace src {
  schema s1 {
    ...common::common_fields
    d  x
    e  x
    f  x
  }
}
`;
    const model = vizModel(src);
    const srcNs = model.namespaces.find((ns) => ns.name === "src");
    const schema = srcNs.schemas[0];
    assert.equal(schema.fields.length, 6);
    const names = schema.fields.map((f) => f.name);
    assert.deepEqual(names.sort(), ["a", "b", "c", "d", "e", "f"]);
  });
});

// ---------- Imported schema stubs ----------

describe("imported schema stubs", () => {
  const LOOKUP_URI = "file:///lookups/finance.stm";
  const MAIN_URI = "file:///main.stm";

  const LOOKUP_SRC = `schema fx_spot_rates {
  currency_code VARCHAR
  rate DECIMAL
}`;

  const MAIN_SRC = `import { fx_spot_rates } from "lookups/finance.stm"
schema transactions { id INT amount DECIMAL currency VARCHAR }
schema transactions_usd { id INT amount_usd DECIMAL }
mapping enrich {
  source { transactions fx_spot_rates }
  target { transactions_usd }
  id -> id
  amount -> amount_usd { "multiply by rate" }
}`;

  it("injects a stub schema card for an imported source schema", () => {
    const model = vizModelScoped(
      { [LOOKUP_URI]: LOOKUP_SRC, [MAIN_URI]: MAIN_SRC },
      MAIN_URI,
    );
    const ns = model.namespaces[0];
    const ids = ns.schemas.map((s) => s.qualifiedId);
    assert.ok(ids.includes("fx_spot_rates"), `expected fx_spot_rates in ${ids}`);
  });

  it("stub schema has hasExternalLineage = true", () => {
    const model = vizModelScoped(
      { [LOOKUP_URI]: LOOKUP_SRC, [MAIN_URI]: MAIN_SRC },
      MAIN_URI,
    );
    const ns = model.namespaces[0];
    const stub = ns.schemas.find((s) => s.qualifiedId === "fx_spot_rates");
    assert.ok(stub);
    assert.equal(stub.hasExternalLineage, true);
  });

  it("stub schema preserves fields from the imported definition", () => {
    const model = vizModelScoped(
      { [LOOKUP_URI]: LOOKUP_SRC, [MAIN_URI]: MAIN_SRC },
      MAIN_URI,
    );
    const ns = model.namespaces[0];
    const stub = ns.schemas.find((s) => s.qualifiedId === "fx_spot_rates");
    assert.ok(stub);
    const fieldNames = stub.fields.map((f) => f.name).sort();
    assert.deepEqual(fieldNames, ["currency_code", "rate"]);
  });

  it("does not inject a stub when the schema is defined locally", () => {
    const model = vizModelScoped(
      { [LOOKUP_URI]: LOOKUP_SRC, [MAIN_URI]: MAIN_SRC },
      MAIN_URI,
    );
    const ns = model.namespaces[0];
    const localIds = ["transactions", "transactions_usd"];
    for (const id of localIds) {
      const count = ns.schemas.filter((s) => s.qualifiedId === id).length;
      assert.equal(count, 1, `expected exactly one ${id} schema card`);
    }
  });

  it("does not inject a stub for a schema not in scope (not imported)", () => {
    // Build model WITHOUT indexing the lookup file — fx_spot_rates not in scope.
    const onlyMainIdx = createWorkspaceIndex();
    const mainTree = parse(MAIN_SRC);
    indexFile(onlyMainIdx, MAIN_URI, mainTree);
    const model = buildVizModel(MAIN_URI, mainTree, onlyMainIdx);
    const ns = model.namespaces[0];
    const ids = ns.schemas.map((s) => s.qualifiedId);
    assert.ok(!ids.includes("fx_spot_rates"), `fx_spot_rates should not appear when not in scope`);
  });
});

// ---------- NL @-ref resolution in TransformInfo.atRefs ----------

describe("buildVizModel — NL @-ref resolution", () => {
  it("populates atRefs for NL transform containing resolved @ref", () => {
    const source = `
schema exchange_rates { spot DECIMAL }
schema transactions { amount DECIMAL converted DECIMAL }
mapping convert_amount {
  source { exchange_rates }
  target { transactions }
  -> converted { "Multiply @amount by @exchange_rates.spot" }
}`;
    const model = vizModel(source);
    const arrow = model.namespaces[0].mappings[0].arrows[0];
    assert.ok(arrow.transform, "expected a transform");
    assert.equal(arrow.transform.kind, "nl");
    assert.ok(Array.isArray(arrow.transform.atRefs), "expected atRefs array");
    assert.ok(arrow.transform.atRefs.length >= 1, "expected at least one atRef");
    const spotRef = arrow.transform.atRefs.find(r => r.ref === "exchange_rates.spot");
    assert.ok(spotRef, "expected atRef for exchange_rates.spot");
    assert.equal(spotRef.resolved, true);
    assert.ok(spotRef.resolvedTo, "expected resolvedTo to be set");
    assert.equal(spotRef.resolvedTo.kind, "field");
  });

  it("populates atRefs with resolved: false for unknown refs", () => {
    const source = `
schema src { id INT }
schema tgt { result INT }
mapping m {
  source { src }
  target { tgt }
  -> result { "Derived from @bogus_unknown_field" }
}`;
    const model = vizModel(source);
    const arrow = model.namespaces[0].mappings[0].arrows[0];
    assert.ok(arrow.transform);
    const ref = arrow.transform.atRefs?.find(r => r.ref === "bogus_unknown_field");
    assert.ok(ref, "expected atRef entry for unknown ref");
    assert.equal(ref.resolved, false);
  });

  it("does not populate atRefs for purely structural transforms", () => {
    const source = `
schema src { name STRING }
schema tgt { label STRING }
mapping m {
  source { src }
  target { tgt }
  name -> label { trim | uppercase }
}`;
    const model = vizModel(source);
    const arrow = model.namespaces[0].mappings[0].arrows[0];
    assert.ok(arrow.transform);
    assert.equal(arrow.transform.kind, "nl");
    assert.ok(!arrow.transform.atRefs || arrow.transform.atRefs.length === 0,
      "expected no atRefs for bare-token NL transform");
  });

  // After Feature 28, bare tokens + NL strings in the same pipe chain are all
  // NL kind. @-refs in the transform text are still resolved.
  it("populates atRefs for NL transform with @-refs and bare tokens", () => {
    const source = `
schema src { rate DECIMAL }
schema tgt { result DECIMAL }
mapping m {
  source { src }
  target { tgt }
  -> result { "Use @rate as multiplier" | round(2) }
}`;
    const model = vizModel(source);
    const arrow = model.namespaces[0].mappings[0].arrows[0];
    assert.ok(arrow.transform);
    assert.equal(arrow.transform.kind, "nl");
    assert.ok(Array.isArray(arrow.transform.atRefs));
    const rateRef = arrow.transform.atRefs.find(r => r.ref === "rate");
    assert.ok(rateRef, "expected atRef for rate");
    assert.equal(rateRef.classification, "bare");
  });
});

// ---------- mergeVizModels ----------

describe("mergeVizModels", () => {
  it("returns empty model when given no inputs", () => {
    const result = mergeVizModels("file:///a.stm", []);
    assert.equal(result.uri, "file:///a.stm");
    assert.equal(result.namespaces.length, 0);
  });

  it("returns the single model unchanged when given one input", () => {
    const model = vizModel("schema foo { id INT }");
    const result = mergeVizModels(model.uri, [model]);
    assert.deepStrictEqual(result, model);
  });

  it("deduplicates schemas by qualifiedId across models", () => {
    const m1 = vizModel("schema foo { id INT }", "file:///a.stm");
    const m2 = vizModel("schema foo { id INT\nname VARCHAR }", "file:///b.stm");
    // Primary model's schema wins the dedup.
    const result = mergeVizModels("file:///a.stm", [m1, m2]);
    const schemas = result.namespaces.flatMap(ns => ns.schemas);
    assert.equal(schemas.length, 1, "duplicate schema should be deduped");
    assert.equal(schemas[0].fields.length, 1, "primary model schema should win");
  });

  it("includes mappings from upstream files", () => {
    // Model A has a schema and mapping; model B has a different mapping.
    const modelA = vizModel(`
schema src { id INT }
schema tgt { id INT }
mapping m1 {
  source { src }
  target { tgt }
  src.id -> id
}`, "file:///a.stm");

    const modelB = vizModel(`
schema upstream { code VARCHAR }
schema src { id INT }
mapping m_upstream {
  source { upstream }
  target { src }
  upstream.code -> id
}`, "file:///b.stm");

    const result = mergeVizModels("file:///a.stm", [modelA, modelB]);
    const allMappings = result.namespaces.flatMap(ns => ns.mappings);
    assert.equal(allMappings.length, 2, "both mappings should be present");
    const mappingIds = allMappings.map(m => m.id);
    assert.ok(mappingIds.includes("m1"), "primary mapping present");
    assert.ok(mappingIds.includes("m_upstream"), "upstream mapping present");
  });

  it("preserves only primary file's fileNotes", () => {
    const modelA = vizModel(`
note { "File A note" }
schema foo { id INT }
`, "file:///a.stm");

    const modelB = vizModel(`
note { "File B note" }
schema bar { id INT }
`, "file:///b.stm");

    const result = mergeVizModels("file:///a.stm", [modelA, modelB]);
    assert.equal(result.fileNotes.length, 1);
    assert.ok(result.fileNotes[0].text.includes("File A note"));
  });

  it("merges entities from different namespaces correctly", () => {
    const modelA = vizModel(`
namespace crm {
  schema customers { id INT }
}`, "file:///a.stm");

    const modelB = vizModel(`
namespace billing {
  schema invoices { id INT }
}`, "file:///b.stm");

    const result = mergeVizModels("file:///a.stm", [modelA, modelB]);
    assert.equal(result.namespaces.length, 2, "two namespace groups");
    const nsNames = result.namespaces.map(ns => ns.name).sort();
    assert.deepStrictEqual(nsNames, ["billing", "crm"]);
  });

  it("keeps same-named mappings from different namespaces of one file (sl-aeae)", () => {
    // Bug sl-aeae: the mapping dedup key was id@uri, omitting the namespace.
    // Two mappings named "load" in namespaces a and b of the same file
    // collided and the second was dropped from the merged model.
    const modelA = vizModel(`
namespace a {
  schema s1 { id INT }
  schema t1 { id INT }
  mapping load { source { s1 } target { t1 } id -> id }
}
namespace b {
  schema s2 { id INT }
  schema t2 { id INT }
  mapping load { source { s2 } target { t2 } id -> id }
}`, "file:///a.stm");
    const modelB = vizModel("schema unrelated { id INT }", "file:///b.stm");

    const result = mergeVizModels("file:///a.stm", [modelA, modelB]);
    const nsA = result.namespaces.find((ns) => ns.name === "a");
    const nsB = result.namespaces.find((ns) => ns.name === "b");
    assert.equal(nsA.mappings.length, 1, "namespace a keeps its load mapping");
    assert.equal(nsB.mappings.length, 1, "namespace b keeps its load mapping");
  });
});

// ---------- Stub upgrade in lineage merge (sl-ak00) ----------

describe("lineage merge stub upgrade (sl-ak00)", () => {
  // Bug sl-ak00: the merge sorts the primary model first and dedup was
  // first-wins, but the primary model contains only a STUB of each imported
  // schema. The stub beat the upstream full definition, so labels, metadata,
  // notes, and field constraints (including pii) vanished in lineage mode.
  const FILES = {
    "file:///upstream.stm": `schema customers (note "Customer Master", owner "crm-team") {
  id INT (pk)
  email VARCHAR (pii)
}`,
    "file:///main.stm": `import { customers } from "./upstream.stm"
schema dim_customers { id INT email VARCHAR }
mapping load_dim {
  source { customers }
  target { dim_customers }
  id -> id
  email -> email
}`,
  };

  it("replaces the primary file's stub with the upstream full definition", () => {
    const result = vizModelFullLineage(FILES, "file:///main.stm");
    const customers = result.namespaces
      .flatMap((ns) => ns.schemas)
      .find((s) => s.qualifiedId === "customers");
    assert.ok(customers, "customers schema present in merged model");
    assert.ok(!customers.isStub, "merged card must be the full definition, not the stub");
    assert.equal(customers.label, "Customer Master", "label from upstream definition survives");
    assert.ok(
      customers.metadata.some((m) => m.key === "owner"),
      `owner metadata survives, got: ${JSON.stringify(customers.metadata)}`,
    );
  });

  it("preserves pii field constraints from the upstream definition", () => {
    const result = vizModelFullLineage(FILES, "file:///main.stm");
    const customers = result.namespaces
      .flatMap((ns) => ns.schemas)
      .find((s) => s.qualifiedId === "customers");
    const email = customers.fields.find((f) => f.name === "email");
    assert.ok(email, "email field present");
    assert.ok(
      email.constraints.includes("pii"),
      `pii constraint survives the merge, got: ${JSON.stringify(email.constraints)}`,
    );
  });

  it("still lets the primary file win when both models hold full definitions", () => {
    // The stub upgrade must not change the existing primary-wins rule for
    // genuinely duplicated definitions across files.
    const m1 = vizModel("schema foo { id INT }", "file:///a.stm");
    const m2 = vizModel("schema foo { id INT\nname VARCHAR }", "file:///b.stm");
    const result = mergeVizModels("file:///a.stm", [m1, m2]);
    const schemas = result.namespaces.flatMap((ns) => ns.schemas);
    assert.equal(schemas.length, 1);
    assert.equal(schemas[0].fields.length, 1, "primary model's full definition still wins");
  });
});

// ---------- Full lineage (vizModelFullLineage) ----------

describe("vizModelFullLineage", () => {
  it("includes schemas and mappings from transitively imported files", () => {
    // File C defines an upstream schema.
    // File B imports C and maps upstream -> intermediate.
    // File A imports B and maps intermediate -> target.
    const files = {
      "file:///c.stm": `
schema upstream { code VARCHAR }`,

      "file:///b.stm": `
import { upstream } from "./c.stm"
schema intermediate { id INT }
mapping m_b {
  source { upstream }
  target { intermediate }
  upstream.code -> id
}`,

      "file:///a.stm": `
import { intermediate } from "./b.stm"
schema target { key INT }
mapping m_a {
  source { intermediate }
  target { target }
  intermediate.id -> key
}`,
    };

    const result = vizModelFullLineage(files, "file:///a.stm");

    // All three schemas should be present.
    const allSchemas = result.namespaces.flatMap(ns => ns.schemas);
    const schemaIds = allSchemas.map(s => s.qualifiedId).sort();
    assert.ok(schemaIds.includes("upstream"), "upstream schema from file C");
    assert.ok(schemaIds.includes("intermediate"), "intermediate schema from file B");
    assert.ok(schemaIds.includes("target"), "target schema from file A");

    // Both mappings should be present (one from A, one from B).
    const allMappings = result.namespaces.flatMap(ns => ns.mappings);
    const mappingIds = allMappings.map(m => m.id).sort();
    assert.ok(mappingIds.includes("m_a"), "mapping from file A");
    assert.ok(mappingIds.includes("m_b"), "mapping from file B");
  });

  it("renders full lineage from an import-only entry point file", () => {
    // Entry point has no local schemas or mappings — just imports that stitch
    // the workspace together. The full lineage should still include everything.
    const files = {
      "file:///sources.stm": `
schema raw_orders { order_id INT\ncustomer_id INT }`,

      "file:///pipeline.stm": `
import { raw_orders } from "./sources.stm"
schema cleaned_orders { order_id INT\ncustomer_id INT }
mapping clean {
  source { raw_orders }
  target { cleaned_orders }
  raw_orders.order_id -> order_id
  raw_orders.customer_id -> customer_id
}`,

      "file:///platform.stm": `
import { raw_orders } from "./sources.stm"
import { cleaned_orders } from "./pipeline.stm"`,
    };

    const result = vizModelFullLineage(files, "file:///platform.stm");

    // Both schemas and the mapping from imported files should be present.
    const allSchemas = result.namespaces.flatMap(ns => ns.schemas);
    const schemaIds = allSchemas.map(s => s.qualifiedId).sort();
    assert.ok(schemaIds.includes("raw_orders"), "upstream schema present");
    assert.ok(schemaIds.includes("cleaned_orders"), "downstream schema present");

    const allMappings = result.namespaces.flatMap(ns => ns.mappings);
    assert.equal(allMappings.length, 1, "mapping from pipeline file present");
    assert.equal(allMappings[0].id, "clean");

    // Namespaces should not be empty — the import-only file contributes nothing
    // locally, but the merged model has content from imported files.
    assert.ok(result.namespaces.length > 0,
      "merged model has non-empty namespaces despite import-only entry point");
  });

  it("location.uri tracks which file each entity came from", () => {
    const files = {
      "file:///src.stm": `
schema source_data { id INT }`,

      "file:///main.stm": `
import { source_data } from "./src.stm"
schema result { id INT }
mapping m {
  source { source_data }
  target { result }
  source_data.id -> id
}`,
    };

    const result = vizModelFullLineage(files, "file:///main.stm");
    const allSchemas = result.namespaces.flatMap(ns => ns.schemas);

    const resultSchema = allSchemas.find(s => s.qualifiedId === "result");
    assert.equal(resultSchema.location.uri, "file:///main.stm",
      "result schema should come from main.stm");

    const sourceSchema = allSchemas.find(s => s.qualifiedId === "source_data");
    assert.equal(sourceSchema.location.uri, "file:///src.stm",
      "source_data schema should come from src.stm");
  });
});
