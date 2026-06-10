/**
 * Direct unit tests for the per-builder extract* helpers in viz-model.ts,
 * accessed via the `_testInternals` export. Complements viz-model.test.js
 * (which exercises the full buildVizModel pipeline) by pinning each builder's
 * shape in isolation, so a regression is reported against the builder rather
 * than the orchestration.
 */
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const { _testInternals } = require("../dist/viz-model");
const { createWorkspaceIndex, indexFile } = require("../dist/workspace-index");

const {
  extractSchema,
  extractFragment,
  extractMapping,
  extractMetric,
  extractMetricMetadata,
  extractMetricFields,
  extractMeasure,
  extractFieldEntries,
  extractSpreads,
  extractSchemaLabel,
  extractSourceBlock,
  extractArrow,
  extractComputedArrow,
  extractTransform,
  extractEachBlock,
  extractFlattenBlock,
  extractNoteBlock,
  extractNotes,
  extractComments,
  extractCommentText,
  extractMetadataEntries,
} = _testInternals;

before(async () => { await initTestParser(); });

const URI = "file:///b.stm";

/** Parse `src` and return the root SyntaxNode. */
function root(src) {
  return parse(src).rootNode;
}

/** Recursively find the first descendant of `node` whose type is `type`. */
function findNode(node, type) {
  if (node.type === type) return node;
  for (const c of node.namedChildren) {
    const r = findNode(c, type);
    if (r) return r;
  }
  return null;
}

/** Build a workspace index containing a single file at URI. */
function singleFileIndex(src) {
  const ws = createWorkspaceIndex();
  const tree = parse(src);
  indexFile(ws, URI, tree);
  return { ws, tree };
}

// ==================================================================
// extractSchema
// ==================================================================

describe("extractSchema (direct)", () => {
  // Single-field schema with one constraint — pins the full SchemaCard shape:
  // qualifiedId equals id when no namespace, all collection fields default to
  // empty arrays, location matches the schema_block start, and the field
  // location is the row/col of the field declaration.
  it("returns the canonical SchemaCard shape for a one-field schema", () => {
    const src = "schema users {\n  id INT (pk)\n}";
    const { ws, tree } = singleFileIndex(src);
    const node = findNode(tree.rootNode, "schema_block");
    const card = extractSchema(URI, node, null, ws);

    assert.deepStrictEqual(card, {
      id: "users",
      qualifiedId: "users",
      kind: "schema",
      label: null,
      fields: [
        {
          name: "id",
          type: "INT",
          constraints: ["pk"],
          metadata: [{ key: "pk", value: "" }],
          notes: [],
          comments: [],
          children: [],
          location: { uri: URI, line: 1, character: 2 },
        },
      ],
      notes: [],
      comments: [],
      metadata: [],
      location: { uri: URI, line: 0, character: 0 },
      hasExternalLineage: false,
      spreads: [],
    });
  });

  // qualifiedId must prepend the namespace when one is supplied. This is the
  // contract that namespace orchestration in buildVizModel relies on.
  it("prepends namespace to qualifiedId when given", () => {
    const src = "schema users { id INT }";
    const { ws, tree } = singleFileIndex(src);
    const node = findNode(tree.rootNode, "schema_block");
    const card = extractSchema(URI, node, "crm", ws);
    assert.equal(card.qualifiedId, "crm::users");
    assert.equal(card.id, "users");
  });

  // The note metadata tag becomes the schema label. Schemas with no note tag
  // get a null label (asserted in the canonical shape test above).
  it("extracts label from a schema-level note metadata tag", () => {
    const src = 'schema foo (note "Customer table") { id INT }';
    const { ws, tree } = singleFileIndex(src);
    const node = findNode(tree.rootNode, "schema_block");
    const card = extractSchema(URI, node, null, ws);
    assert.equal(card.label, "Customer table");
  });
});

// ==================================================================
// extractFragment
// ==================================================================

describe("extractFragment (direct)", () => {
  // Pins the FragmentCard shape and proves the comments field is now a
  // CommentEntry[] in its own right (the previous `as unknown as` cast is
  // gone). Empty arrays are required for fields the snippet does not exercise.
  it("returns the canonical FragmentCard shape for a one-field fragment", () => {
    const src = "fragment audit_fields {\n  created_at TIMESTAMP\n}";
    const node = findNode(root(src), "fragment_block");
    const card = extractFragment(URI, node, null);

    assert.deepStrictEqual(card, {
      id: "audit_fields",
      fields: [
        {
          name: "created_at",
          type: "TIMESTAMP",
          constraints: [],
          metadata: [],
          notes: [],
          comments: [],
          children: [],
          location: { uri: URI, line: 1, character: 2 },
        },
      ],
      spreads: [],
      notes: [],
      comments: [],
      location: { uri: URI, line: 0, character: 0 },
    });
  });

  // The id must be namespace-qualified when extracted under a namespace,
  // matching the schema/metric convention.
  it("prepends namespace to fragment id when given", () => {
    const src = "fragment base { id INT }";
    const node = findNode(root(src), "fragment_block");
    const card = extractFragment(URI, node, "common");
    assert.equal(card.id, "common::base");
  });
});

// ==================================================================
// extractMapping
// ==================================================================

describe("extractMapping (direct)", () => {
  // Pins the MappingBlock defaults (empty each/flatten/note/comments arrays
  // and structured sourceBlock) for the simplest possible mapping shape.
  it("returns the canonical MappingBlock shape for a one-arrow mapping", () => {
    const src = "schema s { a INT }\nschema t { b INT }\n" +
      "mapping m {\n  source { s }\n  target { t }\n  a -> b\n}";
    const { ws, tree } = singleFileIndex(src);
    const node = findNode(tree.rootNode, "mapping_block");
    const card = extractMapping(URI, node, null, ws);

    assert.deepStrictEqual(card, {
      id: "m",
      sourceRefs: ["s"],
      targetRef: "t",
      arrows: [
        {
          sourceFields: ["a"],
          targetField: "b",
          transform: null,
          metadata: [],
          comments: [],
          location: { uri: URI, line: 5, character: 2 },
        },
      ],
      eachBlocks: [],
      flattenBlocks: [],
      sourceBlock: { schemas: ["s"], joinDescription: null, filters: [] },
      metadata: [],
      notes: [],
      comments: [],
      location: { uri: URI, line: 2, character: 0 },
    });
  });

  // Regression for sl-6x1o: meta on the mapping declaration itself — bare
  // tags like `airflow` and the note text — was dropped at extraction, so the
  // detail view's header could never show it.
  it("extracts the mapping's own metadata block (bare tags and note)", () => {
    const src = "schema s { a INT }\nschema t { b INT }\n" +
      'mapping export_to_csv (airflow, note "All fields to CSV") {\n' +
      "  source { s }\n  target { t }\n  a -> b\n}";
    const { ws, tree } = singleFileIndex(src);
    const node = findNode(tree.rootNode, "mapping_block");
    const card = extractMapping(URI, node, null, ws);

    assert.deepStrictEqual(card.metadata, [
      { key: "airflow", value: "" },
      { key: "note", value: "All fields to CSV" },
    ]);
  });
});

// ==================================================================
// extractMetric / extractMetricMetadata / extractMetricFields / extractMeasure
// ==================================================================

describe("extractMetric (direct)", () => {
  // Drives every collaborator in extractMetric: label (metric_name tag),
  // source/grain/slices/filter (extractMetricMetadata), and a measure field
  // (extractMetricFields → extractMeasure).
  it("returns the canonical MetricCard shape for a basic metric", () => {
    const src =
      'schema mrr (\n' +
      '  metric,\n' +
      '  metric_name "MRR",\n' +
      '  source subs,\n' +
      '  grain monthly,\n' +
      '  slice {region, plan},\n' +
      '  filter "active"\n' +
      ') {\n' +
      '  value DECIMAL (measure additive)\n' +
      '}';
    const node = findNode(root(src), "schema_block");
    const card = extractMetric(URI, node, null);

    assert.deepStrictEqual(card, {
      id: "mrr",
      qualifiedId: "mrr",
      label: "MRR",
      source: ["subs"],
      grain: "monthly",
      slices: ["region", "plan"],
      filter: "active",
      fields: [
        {
          name: "value",
          type: "DECIMAL",
          measure: "additive",
          notes: [],
          location: { uri: URI, line: 8, character: 2 },
        },
      ],
      notes: [],
      comments: [],
      location: { uri: URI, line: 0, character: 0 },
    });
  });
});

describe("extractMetricMetadata (direct)", () => {
  // Drives every branch of extractMetricMetadata in one call: source list,
  // grain, slice block, filter — and asserts each was written into the
  // correct out-parameter.
  it("populates source / grain / slices / filter from metadata_block", () => {
    const src =
      'schema m (\n' +
      '  metric,\n' +
      '  source orders,\n' +
      '  grain daily,\n' +
      '  slice {country},\n' +
      '  filter "paid = true"\n' +
      ') { v INT (measure) }';
    const meta = findNode(root(src), "metadata_block");
    const source = [];
    const slices = [];
    let grain = null;
    let filter = null;
    extractMetricMetadata(meta, source, slices, (g) => (grain = g), (f) => (filter = f));
    assert.deepStrictEqual(source, ["orders"]);
    assert.deepStrictEqual(slices, ["country"]);
    assert.equal(grain, "daily");
    assert.equal(filter, "paid = true");
  });
});

describe("extractMetricFields (direct)", () => {
  // Each field's measure value is taken from extractMeasure; this asserts
  // the full MetricFieldEntry[] for one of every measure variant including
  // a non-measure field that yields measure: null.
  it("returns one MetricFieldEntry per field with the correct measure value", () => {
    const src =
      'schema m (metric, source s) {\n' +
      '  add_v DECIMAL (measure additive)\n' +
      '  na_v  DECIMAL (measure non_additive)\n' +
      '  sa_v  DECIMAL (measure semi_additive)\n' +
      '  bare  INT (measure)\n' +
      '  none  INT\n' +
      '}';
    const body = findNode(root(src), "schema_body");
    const fields = extractMetricFields(URI, body);
    assert.equal(fields.length, 5);
    assert.deepStrictEqual(
      fields.map((f) => ({ name: f.name, type: f.type, measure: f.measure })),
      [
        { name: "add_v", type: "DECIMAL", measure: "additive" },
        { name: "na_v", type: "DECIMAL", measure: "non_additive" },
        { name: "sa_v", type: "DECIMAL", measure: "semi_additive" },
        { name: "bare", type: "INT", measure: "additive" },
        { name: "none", type: "INT", measure: null },
      ],
    );
  });
});

describe("extractMeasure (direct)", () => {
  // The bare `measure` tag (no value) defaults to "additive" — this rule is
  // codified in extractMeasure and checked here in isolation.
  it("returns 'additive' for a bare measure tag", () => {
    const src = 'schema m (metric, source s) { v INT (measure) }';
    const fieldMeta = findNode(
      findNode(root(src), "field_decl"),
      "metadata_block",
    );
    assert.equal(extractMeasure(fieldMeta), "additive");
  });

  // A field whose metadata block has no measure tag yields null — separate
  // from the "additive default" path above.
  it("returns null when no measure tag is present", () => {
    const src = 'schema s { v INT (pk) }';
    const fieldMeta = findNode(
      findNode(root(src), "field_decl"),
      "metadata_block",
    );
    assert.equal(extractMeasure(fieldMeta), null);
  });
});

// ==================================================================
// extractFieldEntries / extractSpreads
// ==================================================================

describe("extractFieldEntries (direct)", () => {
  // Asserts the full FieldEntry[] shape including a nested record with
  // children, list-of typing, and constraints — covering the three most
  // common field flavours in one canonical assertion.
  it("returns the canonical FieldEntry shape for nested + list + constraint fields", () => {
    const src =
      'schema events {\n' +
      '  id UUID (pk)\n' +
      '  data record {\n' +
      '    name STRING\n' +
      '  }\n' +
      '  tags list_of STRING\n' +
      '}';
    const body = findNode(root(src), "schema_body");
    const fields = extractFieldEntries(URI, body);

    assert.deepStrictEqual(fields, [
      {
        name: "id",
        type: "UUID",
        constraints: ["pk"],
        metadata: [{ key: "pk", value: "" }],
        notes: [],
        comments: [],
        children: [],
        location: { uri: URI, line: 1, character: 2 },
      },
      {
        name: "data",
        type: "record",
        constraints: [],
        metadata: [],
        notes: [],
        comments: [],
        children: [
          {
            name: "name",
            type: "STRING",
            constraints: [],
            metadata: [],
            notes: [],
            comments: [],
            children: [],
            location: { uri: URI, line: 3, character: 4 },
          },
        ],
        location: { uri: URI, line: 2, character: 2 },
      },
      {
        name: "tags",
        type: "list_of STRING",
        constraints: [],
        metadata: [],
        notes: [],
        comments: [],
        children: [],
        location: { uri: URI, line: 5, character: 2 },
      },
    ]);
  });

  // Regression for sl-6x1o: key-value metadata that is not a recognised
  // constraint tag (sensitivity, access_group, ...) was silently discarded —
  // only the CONSTRAINT_TAGS whitelist survived, and even whitelisted kv
  // entries lost their value. The full entries must be preserved so the card
  // can render them as pills.
  it("preserves non-constraint key-value metadata on fields", () => {
    const src =
      "schema property {\n" +
      "  CLOSING_DATE DATE (sensitivity internal, access_group property_facilities)\n" +
      "}";
    const body = findNode(root(src), "schema_body");
    const [field] = extractFieldEntries(URI, body);

    assert.deepStrictEqual(field.metadata, [
      { key: "sensitivity", value: "internal" },
      { key: "access_group", value: "property_facilities" },
    ]);
    // Neither key is a constraint tag, so the badge list stays empty.
    assert.deepStrictEqual(field.constraints, []);
  });
});

describe("extractSpreads (direct)", () => {
  // extractSpreads delegates to core's extractFieldTree but the contract this
  // module exposes is "return the spread names in declaration order".
  it("returns spread names in declaration order", () => {
    const src =
      'schema s {\n' +
      '  ...common::base\n' +
      '  ...common::audit\n' +
      '  id INT\n' +
      '}';
    const body = findNode(root(src), "schema_body");
    assert.deepStrictEqual(extractSpreads(body), ["common::base", "common::audit"]);
  });

  // Empty schema bodies must return [] (not undefined) so the SchemaCard
  // shape is uniform.
  it("returns an empty array for a schema body with no spreads", () => {
    const src = 'schema s { id INT }';
    const body = findNode(root(src), "schema_body");
    assert.deepStrictEqual(extractSpreads(body), []);
  });
});

// ==================================================================
// extractSchemaLabel
// ==================================================================

describe("extractSchemaLabel (direct)", () => {
  // The schema label is taken from a `note "..."` tag inside the metadata
  // block. Both shapes (note_tag and tag_with_value) are accepted.
  it("returns the note text from a note_tag in the metadata block", () => {
    const src = 'schema foo (note "Customer table") { id INT }';
    const meta = findNode(root(src), "metadata_block");
    assert.equal(extractSchemaLabel(meta), "Customer table");
  });

  // No metadata block at all → null.
  it("returns null when meta is null", () => {
    assert.equal(extractSchemaLabel(null), null);
  });

  // Metadata block exists but contains no note tag → null.
  it("returns null when no note tag is present", () => {
    const src = 'schema foo (key) { id INT }';
    const meta = findNode(root(src), "metadata_block");
    assert.equal(extractSchemaLabel(meta), null);
  });
});

// ==================================================================
// extractSourceBlock
// ==================================================================

describe("extractSourceBlock (direct)", () => {
  // A multi-schema source block with a join description. The schemas list
  // contains the raw refs (resolution to qualifiedIds happens in
  // extractMapping), and joinDescription holds the prose string.
  it("returns the canonical SourceBlockInfo shape for a multi-schema join", () => {
    const src =
      "schema a { id INT }\nschema b { id INT }\nschema t { id INT }\n" +
      'mapping m {\n  source {\n    a\n    b\n    "Join on a.id = b.id"\n  }\n  target { t }\n  a.id -> id\n}';
    const node = findNode(root(src), "source_block");
    assert.deepStrictEqual(extractSourceBlock(node), {
      schemas: ["a", "b"],
      joinDescription: "Join on a.id = b.id",
      filters: [],
    });
  });
});

// ==================================================================
// extractArrow / extractComputedArrow
// ==================================================================

describe("extractArrow (direct)", () => {
  // A bare-copy arrow with no transform pins the ArrowEntry default shape:
  // empty metadata, empty comments, transform: null.
  it("returns the canonical ArrowEntry shape for a bare-copy arrow", () => {
    const src = "schema s { a INT }\nschema t { b INT }\n" +
      "mapping m { source { s } target { t } a -> b }";
    const node = findNode(root(src), "map_arrow");
    const arrow = extractArrow(URI, node);
    assert.deepStrictEqual(arrow, {
      sourceFields: ["a"],
      targetField: "b",
      transform: null,
      metadata: [],
      comments: [],
      location: arrow.location, // location row/col depends on layout; checked separately
    });
    assert.equal(arrow.location.uri, URI);
  });

  // Multi-source arrows produce sourceFields with one entry per src_path.
  it("captures every src_path in sourceFields for a multi-source arrow", () => {
    const src = "schema s { a STRING\n b STRING }\nschema t { c STRING }\n" +
      'mapping m { source { s } target { t } a, b -> c { "concat" } }';
    const node = findNode(root(src), "map_arrow");
    const arrow = extractArrow(URI, node);
    assert.deepStrictEqual(arrow.sourceFields, ["a", "b"]);
    assert.equal(arrow.targetField, "c");
    assert.ok(arrow.transform);
    assert.equal(arrow.transform.kind, "nl");
  });
});

describe("extractComputedArrow (direct)", () => {
  // Computed arrows have no source fields but still carry the same
  // ArrowEntry shape (sourceFields: []).
  it("returns sourceFields: [] and a non-null transform for a computed arrow", () => {
    const src = "schema s { a INT }\nschema t { b INT }\n" +
      'mapping m { source { s } target { t } -> b { "compute" } }';
    const node = findNode(root(src), "computed_arrow");
    const arrow = extractComputedArrow(URI, node);
    assert.deepStrictEqual(arrow.sourceFields, []);
    assert.equal(arrow.targetField, "b");
    assert.ok(arrow.transform);
    assert.equal(arrow.transform.kind, "nl");
    assert.deepStrictEqual(arrow.metadata, []);
    assert.deepStrictEqual(arrow.comments, []);
  });
});

// ==================================================================
// extractTransform
// ==================================================================

describe("extractTransform (direct)", () => {
  // A pipe chain with bare-token steps yields kind "nl" and one entry per
  // pipe_text in steps. text is the raw source of the pipe_chain.
  it("returns kind 'nl' with one step per pipe_text", () => {
    const src = "schema s { a INT }\nschema t { b INT }\n" +
      "mapping m { source { s } target { t } a -> b { trim | lowercase } }";
    const pipeChain = findNode(root(src), "pipe_chain");
    const tf = extractTransform(pipeChain);
    assert.equal(tf.kind, "nl");
    assert.deepStrictEqual(tf.steps, ["trim", "lowercase"]);
    assert.equal(tf.text, pipeChain.text);
  });

  // A standalone map literal flips kind to "map" — the only non-nl variant.
  it("returns kind 'map' when the chain contains a map_literal", () => {
    const src = "schema s { a STRING }\nschema t { b STRING }\n" +
      'mapping m { source { s } target { t } a -> b { map { A: "x" } } }';
    const pipeChain = findNode(root(src), "pipe_chain");
    const tf = extractTransform(pipeChain);
    assert.equal(tf.kind, "map");
  });
});

// ==================================================================
// extractEachBlock / extractFlattenBlock
// ==================================================================

describe("extractEachBlock (direct)", () => {
  // A simple each block over a list field. Asserts sourceField/targetField
  // are pulled from src_path/tgt_path and that nestedEach defaults to [].
  it("returns the canonical EachBlock shape for a single-arrow each", () => {
    const src =
      "schema s { items list_of record { sku STRING } }\n" +
      "schema t { items list_of record { sku STRING } }\n" +
      "mapping m {\n  source { s }\n  target { t }\n" +
      "  each items -> items {\n    .sku -> .sku\n  }\n}";
    const node = findNode(root(src), "each_block");
    const each = extractEachBlock(URI, node);
    assert.equal(each.sourceField, "items");
    assert.equal(each.targetField, "items");
    assert.equal(each.arrows.length, 1);
    assert.deepStrictEqual(each.nestedEach, []);
    assert.equal(each.location.uri, URI);
  });
});

describe("extractFlattenBlock (direct)", () => {
  // A flatten block produces one arrow per child map_arrow and carries the
  // source list field name.
  it("returns the canonical FlattenBlock shape", () => {
    const src =
      "schema s { items list_of record { sku STRING } }\n" +
      "schema t { sku STRING }\n" +
      "mapping m {\n  source { s }\n  target { t }\n" +
      "  flatten items -> t {\n    .sku -> sku\n  }\n}";
    const node = findNode(root(src), "flatten_block");
    const flat = extractFlattenBlock(URI, node);
    assert.equal(flat.sourceField, "items");
    assert.equal(flat.arrows.length, 1);
    assert.equal(flat.arrows[0].sourceFields[0], ".sku");
    assert.equal(flat.arrows[0].targetField, "sku");
  });
});

// ==================================================================
// extractNoteBlock / extractNotes
// ==================================================================

describe("extractNoteBlock (direct)", () => {
  // Single-line note: isMultiline must be false and text must be unquoted.
  it("returns isMultiline: false for a single-line note", () => {
    const src = 'note { "Hello" }';
    const node = findNode(root(src), "note_block");
    assert.deepStrictEqual(extractNoteBlock(URI, node), {
      text: "Hello",
      isMultiline: false,
      location: { uri: URI, line: 0, character: 0 },
    });
  });

  // Multiline (triple-quoted) note: isMultiline must be true and the text
  // payload preserved (whitespace handling is the responsibility of stringText).
  it("returns isMultiline: true for a triple-quoted note", () => {
    const src = 'note {\n"""\nHello world\n"""\n}';
    const node = findNode(root(src), "note_block");
    const nb = extractNoteBlock(URI, node);
    assert.equal(nb.isMultiline, true);
    assert.ok(nb.text.includes("Hello world"));
  });
});

describe("extractNotes (direct)", () => {
  // extractNotes pulls note_tag entries from the node's metadata_block. This
  // is the path used for `(note "...")` annotations on schemas/metrics.
  it("collects metadata note_tag entries", () => {
    const src = 'schema s (note "Tag note") { id INT }';
    const node = findNode(root(src), "schema_block");
    const notes = extractNotes(URI, node);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].text, "Tag note");
  });


  // No notes at all yields the empty array, not undefined.
  it("returns an empty array when there are no notes", () => {
    const src = 'schema s { id INT }';
    const node = findNode(root(src), "schema_block");
    assert.deepStrictEqual(extractNotes(URI, node), []);
  });
});

// ==================================================================
// extractComments / extractCommentText
// ==================================================================

describe("extractComments (direct)", () => {
  // The //! warning comment that follows a field declaration is parsed as a
  // direct child of the enclosing schema_block (not the field_decl, and not
  // schema_body — verified by dumping the CST). extractComments scans the
  // node's children for warning/question_comment, so calling it on the
  // schema_block surfaces the warning.
  it("captures a warning_comment child as kind: 'warning'", () => {
    const src = "schema s {\n  email STRING //! PII risk\n}";
    const node = findNode(root(src), "schema_block");
    const comments = extractComments(URI, node);
    assert.equal(comments.length, 1);
    assert.equal(comments[0].kind, "warning");
    assert.equal(comments[0].text, "PII risk");
  });

  // //? maps to kind "question" via the same child-scan path. Distinct from
  // the warning case so worth pinning separately.
  it("captures a question_comment child as kind: 'question'", () => {
    const src = "schema s {\n  status STRING //? should be enum\n}";
    const node = findNode(root(src), "schema_block");
    const comments = extractComments(URI, node);
    assert.equal(comments.length, 1);
    assert.equal(comments[0].kind, "question");
    assert.equal(comments[0].text, "should be enum");
  });

  // No annotation children → empty array, not undefined.
  it("returns an empty array when there are no //! or //? children", () => {
    const src = "schema s {\n  id INT\n}";
    const node = findNode(root(src), "schema_block");
    assert.deepStrictEqual(extractComments(URI, node), []);
  });
});

describe("extractCommentText (direct)", () => {
  // Strips the leading // (or //! / //?) and trims whitespace. Reaches into
  // a parsed CST node so we exercise the same node.text path the production
  // code uses.
  it("strips // and //! / //? prefixes and trims whitespace", () => {
    const src = "schema s {\n  id INT //! warn here\n  v INT //? ask here\n  x INT // plain\n}";
    const r = root(src);
    const warnNode = findNode(r, "warning_comment");
    const askNode = findNode(r, "question_comment");
    assert.equal(extractCommentText(warnNode), "warn here");
    assert.equal(extractCommentText(askNode), "ask here");
  });
});

// ==================================================================
// extractMetadataEntries
// ==================================================================

describe("extractMetadataEntries (direct)", () => {
  // Metadata is mapped from core's MetaEntry[] discriminated union into the
  // viz model's flat {key,value}[]. This asserts the mapping for the three
  // most common entry kinds: bare tag, kv, and note.
  it("maps tag / kv / note metadata entries to flat {key,value} pairs", () => {
    const src = 'schema s (pk, version "2", note "ABC") { id INT }';
    const meta = findNode(root(src), "metadata_block");
    const entries = extractMetadataEntries(meta);
    // Order matches declaration order.
    assert.deepStrictEqual(entries, [
      { key: "pk", value: "" },
      { key: "version", value: "2" },
      { key: "note", value: "ABC" },
    ]);
  });
});
