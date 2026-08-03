import "./dom-shim.js";
import { before, describe, it } from "node:test";
import * as assert from "node:assert/strict";

const loc = { uri: "file:///test.stm", line: 1, character: 0 };

const field = (name, children = []) => ({
  name,
  type: children.length > 0 ? "record" : "STRING",
  constraints: [],
  notes: [],
  comments: [],
  children,
  location: loc,
});

const schema = (id, fields, qualifiedId = id) => ({
  id,
  qualifiedId,
  kind: "schema",
  label: null,
  fields,
  notes: [],
  comments: [],
  metadata: [],
  location: loc,
  hasExternalLineage: false,
  spreads: [],
});

describe("field-coverage helpers", () => {
  /** @type {typeof import("../dist/satsuma-viz.js")} */
  let mod;

  it("loads the bundle exports", async () => {
    mod = await import("../dist/satsuma-viz.js");
    assert.equal(typeof mod.resolveSchemaLocalFieldPath, "function");
    assert.equal(typeof mod.schemaHasFieldPath, "function");
    assert.equal(typeof mod.mappingSchemaCoverage, "function");
    assert.equal(typeof mod.buildCoverageIndex, "function");
  });

  it("resolves unqualified nested source paths against the owning schema", () => {
    const src = schema("order_events", [field("customer", [field("email"), field("tier")])]);
    assert.equal(mod.schemaHasFieldPath(src, "customer.email"), true);
    assert.equal(
      mod.resolveSchemaLocalFieldPath("customer.email", src, ["order_events", "customer_profiles"]),
      "customer.email",
    );
  });

  it("strips explicit schema qualifiers when resolving local paths", () => {
    const profiles = schema("customer_profiles", [field("region")]);
    assert.equal(
      mod.resolveSchemaLocalFieldPath("customer_profiles.region", profiles, [
        "order_events",
        "customer_profiles",
      ]),
      "region",
    );
  });

  it("strips authored bare-id prefixes for namespaced schemas (sl-iqud)", () => {
    // Bug sl-iqud: arrows keep authored text ("customers.id") while the
    // backend qualifies schema ids ("crm::customers"). Matching only the
    // qualified prefix made every prefixed ref in a namespaced mapping
    // unresolvable, so the whole schema was reported unmapped.
    const customers = schema("customers", [field("id")], "crm::customers");
    assert.equal(
      mod.resolveSchemaLocalFieldPath("customers.id", customers, ["crm::customers", "crm::orders"]),
      "id",
    );
    // The qualified form must keep working too — cross-namespace refs are
    // authored fully qualified.
    assert.equal(
      mod.resolveSchemaLocalFieldPath("crm::customers.id", customers, [
        "crm::customers",
        "crm::orders",
      ]),
      "id",
    );
  });

  it("treats a bare-id prefix of a sibling source schema as not local (sl-iqud)", () => {
    // A ref authored against the OTHER namespaced source schema must not fall
    // through to the field-path check of this schema.
    const customers = schema("customers", [field("orders", [field("id")])], "crm::customers");
    assert.equal(
      mod.resolveSchemaLocalFieldPath("orders.id", customers, ["crm::customers", "crm::orders"]),
      null,
    );
  });
});

// ---------------------------------------------------------------------------
// Nested-each arrow visibility (sl-fm0q)
//
// Arrows can nest arbitrarily deep, and `each` and `flatten` interleave in any
// combination. Surfaces that sum only the top-level collections (mapping.arrows
// + eachBlocks[].arrows + flattenBlocks[].arrows) silently lose every arrow
// below the first nesting level; walking only `nestedEach` loses every arrow
// under a flatten nested in an each (sl-vu22).
// ---------------------------------------------------------------------------

/** One arrow, for building nesting fixtures compactly. */
const arrow = (src, tgt) => ({
  sourceFields: [src],
  targetField: tgt,
  transform: null,
  metadata: [],
  comments: [],
  location: loc,
});

/** A mapping with one arrow at each level: top, each, nested-each, flatten. */
const arrowAtEveryLevel = () => ({
  id: "m1",
  sourceRefs: ["order"],
  targetRef: "invoice",
  arrows: [arrow("id", "id")],
  eachBlocks: [
    {
      sourceField: "items",
      targetField: "lines",
      arrows: [arrow(".sku", ".sku")],
      nestedEach: [
        {
          sourceField: ".discounts",
          targetField: ".discounts",
          arrows: [arrow(".code", ".code")],
          nestedEach: [],
          nestedFlatten: [],
          nestedArrows: [],
          location: loc,
        },
      ],
      nestedFlatten: [],
      nestedArrows: [],
      location: loc,
    },
  ],
  flattenBlocks: [
    {
      sourceField: "tags",
      targetField: "invoice",
      arrows: [arrow(".label", "tag_label")],
      nestedEach: [],
      nestedFlatten: [],
      nestedArrows: [],
      location: loc,
    },
  ],
  nestedArrows: [],
  sourceBlock: null,
  notes: [],
  comments: [],
  location: loc,
});

describe("countMappingArrows (sl-fm0q)", () => {
  it("counts arrows inside nestedEach blocks, not just the top-level collections", async () => {
    // Pre-fix the two "N arrows" surfaces summed top-level collections and
    // reported 3 for this mapping; the nested-each arrow makes it 4.
    const { countMappingArrows } = await import("../dist/satsuma-viz.js");
    assert.equal(countMappingArrows(arrowAtEveryLevel()), 4);
  });

  it("counts arrows inside a flatten nested in an each (sl-vu22)", async () => {
    // The shape of examples/nested-iteration/pipeline.stm:100. `each` carried
    // only nestedEach, so a `flatten` inside it had nowhere to live in the model
    // and every arrow under it was invisible to the count, the hover lookups and
    // the coverage overlay alike. Two arrows here: the each's and the flatten's.
    const { countMappingArrows } = await import("../dist/satsuma-viz.js");
    const mapping = {
      ...arrowAtEveryLevel(),
      arrows: [],
      flattenBlocks: [],
      nestedArrows: [],
      eachBlocks: [
        {
          sourceField: "orders",
          targetField: "orders",
          arrows: [arrow(".id", ".id")],
          nestedEach: [],
          nestedFlatten: [
            {
              sourceField: ".parcels.contents",
              targetField: ".packed_items",
              arrows: [arrow(".sku", ".sku")],
              nestedEach: [],
              nestedFlatten: [],
              nestedArrows: [],
              location: loc,
            },
          ],
          nestedArrows: [],
          location: loc,
        },
      ],
    };
    assert.equal(countMappingArrows(mapping), 2);
  });

  it("counts nested_arrow headers and bodies at mapping level and inside each (svdfe-s6we)", async () => {
    // nested_arrow had no model representation at all, so its arrows were
    // invisible to every counting surface. Unlike an each/flatten header (an
    // iteration scope, not a mapping), a nested_arrow header genuinely maps
    // record to record and core's extractArrowRecords counts it as an arrow —
    // so viz must too, or its "N arrows" disagrees with the CLI's for the same
    // file (PR #414 review). Five arrows here: one flat, then a header + body
    // arrow each for a mapping-level nested_arrow and one inside an each.
    const { countMappingArrows } = await import("../dist/satsuma-viz.js");
    const nestedArrowBlock = (src, tgt, arrows) => ({
      sourceField: src,
      targetField: tgt,
      arrows,
      nestedEach: [],
      nestedFlatten: [],
      nestedArrows: [],
      location: loc,
    });
    const mapping = {
      ...arrowAtEveryLevel(),
      arrows: [arrow("id", "id")],
      flattenBlocks: [],
      nestedArrows: [nestedArrowBlock("addr", "address", [arrow(".line1", ".line1")])],
      eachBlocks: [
        {
          sourceField: "items",
          targetField: "lines",
          arrows: [],
          nestedEach: [],
          nestedFlatten: [],
          nestedArrows: [nestedArrowBlock(".dims", ".dims", [arrow(".h", ".h")])],
          location: loc,
        },
      ],
    };
    assert.equal(countMappingArrows(mapping), 5);
  });
});

describe("sz-mapping-detail hover lookups recurse into nestedEach (sl-fm0q)", () => {
  const order = schema("order", [
    field("id"),
    field("items", [field("sku"), field("discounts", [field("code")])]),
    field("tags", [field("label")]),
  ]);
  const invoice = schema("invoice", [
    field("id"),
    field("lines", [field("sku"), field("discounts", [field("code")])]),
    field("tag_label"),
  ]);

  async function makeDetail() {
    const m = await import("../dist/satsuma-viz.js");
    const detail = new m.SzMappingDetail();
    detail.mapping = arrowAtEveryLevel();
    detail.sourceSchemas = [order];
    detail.targetSchema = invoice;
    return detail;
  }

  it("hovering a nested-each target field highlights its source counterpart", async () => {
    const detail = await makeDetail();
    const bySchema = detail._findSourceFieldsForTarget("lines.discounts.code", detail.mapping);
    assert.deepEqual(
      [...(bySchema.get("order") ?? [])],
      ["items.discounts.code"],
      "the nested-each arrow's source field must be found",
    );
  });

  it("hovering a nested-each source field highlights its target counterpart", async () => {
    const detail = await makeDetail();
    const targets = detail._findTargetFieldsForSource(
      "items.discounts.code",
      "order",
      detail.mapping,
    );
    assert.deepEqual([...targets], ["lines.discounts.code"]);
  });
});

// ── Element-relative paths inside containers (3cdd-yavi) ─────────────────────
//
// Arrows inside `nested_arrow`, `each` and `flatten` bodies are authored
// relative to the container (`.line1 -> .line1`, spec §4.6) and the model keeps
// them that way, because that is what the mapping-detail table shows. Anything
// matching an arrow against a *declared field* has to qualify first — and until
// this ticket nothing did, so `resolveSchemaLocalFieldPath(".line1", …)` split
// to ["", "line1"], matched no field, and every relative-path arrow silently
// contributed nothing to hover highlighting or overview edges.
//
// Asserted on the resolved paths themselves rather than through coverage: since
// sl-46wr coverage is core's answer, not this module's, so the property this
// module still owns is "what absolute path does this arrow name?".

describe("relative arrow paths resolve against their container (3cdd-yavi)", () => {
  /** @type {typeof import("../dist/satsuma-viz.js")} */
  let mod;

  /** A mapping whose only arrow sits inside `blocks`, authored relatively. */
  const mappingWith = (over) => ({
    id: "m",
    sourceRefs: ["s"],
    targetRef: "t",
    arrows: [],
    eachBlocks: [],
    flattenBlocks: [],
    nestedArrows: [],
    sourceBlock: null,
    notes: [],
    comments: [],
    location: loc,
    ...over,
  });

  const block = (sourceField, targetField, over = {}) => ({
    sourceField,
    targetField,
    arrows: [],
    nestedEach: [],
    nestedFlatten: [],
    nestedArrows: [],
    location: loc,
    ...over,
  });

  /** Every arrow's resolved `source -> target` pair, in walk order. */
  const resolvedPaths = (mapping) => {
    const pairs = [];
    mod.forEachMappingArrow(mapping, ({ sourceFields, targetField }) => {
      pairs.push(`${sourceFields.join(",")} -> ${targetField}`);
    });
    return pairs;
  };

  before(async () => {
    mod = await import("../dist/satsuma-viz.js");
  });

  it("qualifies a nested_arrow body's relative arrow against the header", () => {
    // The ticket's headline case: `.line1 -> .line1` under `addr -> address`
    // names addr.line1 and address.line1. The header itself is an arrow too —
    // it maps record to record — so both appear.
    const mapping = mappingWith({
      nestedArrows: [block("addr", "address", { arrows: [arrow(".line1", ".line1")] })],
    });
    assert.deepEqual(resolvedPaths(mapping), ["addr -> address", "addr.line1 -> address.line1"]);
  });

  it("accumulates prefixes through a flatten nested inside an each", () => {
    // The sl-vu22 shape. Each container level contributes one segment, so the
    // rule has to compose — a single level of qualification would resolve
    // `.sku` to `parcels.sku` and still match nothing.
    const mapping = mappingWith({
      eachBlocks: [
        block("orders", "orders", {
          nestedFlatten: [block(".parcels", ".packed", { arrows: [arrow(".sku", ".sku")] })],
        }),
      ],
    });
    assert.deepEqual(resolvedPaths(mapping), ["orders.parcels.sku -> orders.packed.sku"]);
  });

  it("leaves a mapping-level arrow untouched, dot and all", () => {
    // At mapping-body level there is no container to resolve against, so a
    // stray leading dot must stay as authored rather than be quietly matched to
    // a top-level field — nothing may rise on a malformed path.
    const mapping = mappingWith({ arrows: [arrow(".orders", ".orders")] });
    assert.deepEqual(resolvedPaths(mapping), [".orders -> .orders"]);

    // And it still resolves to no declared field, which is what keeps it out of
    // every path-matched surface.
    const src = schema("s", [field("orders", [field("id")])]);
    assert.equal(mod.resolveSchemaLocalFieldPath(".orders", src, ["s"]), null);
  });
});

// ── "Not computed" is not "nothing is covered" (sl-46wr review) ──────────────
//
// `MappingBlock.coverage` is optional, and its contract — with ADR-042 — says
// absent means the figure was not produced: a model assembled without a
// workspace index, or a payload cached by a host predating the field. Rendering
// that as `0/N` asserts a completeness figure nobody measured, and it is
// indistinguishable from the genuine zero of a schema no mapping references.
//
// These go through the two public selectors the UI actually calls. Passing an
// empty array straight to the card tests the card and skips the conversion,
// which is how the fallback survived review of the card's own tests.

describe("absent coverage stays unavailable, distinct from 0/N", () => {
  /** @type {typeof import("../dist/satsuma-viz.js")} */
  let mod;

  const src = schema("s", [field("a"), field("b")]);
  const orphan = schema("orphan", [field("z")]);

  /** A mapping referencing `s`, with no coverage attached. */
  const uncomputed = () => ({
    id: "m",
    sourceRefs: ["s"],
    targetRef: "t",
    arrows: [],
    eachBlocks: [],
    flattenBlocks: [],
    nestedArrows: [],
    sourceBlock: null,
    metadata: [],
    notes: [],
    comments: [],
    location: loc,
  });

  const modelWith = (mappings, schemas) => ({
    uri: loc.uri,
    fileNotes: [],
    namespaces: [{ name: null, schemas, mappings, metrics: [], fragments: [] }],
  });

  before(async () => {
    mod = await import("../dist/satsuma-viz.js");
  });

  it("reports null from the detail selector when the mapping carries no coverage", () => {
    // The detail view's own accessor. Returning an all-uncovered list here is
    // what made the card claim 0/N for a payload that simply never had coverage.
    assert.equal(mod.mappingSchemaCoverage(uncomputed(), src, "source"), null);
  });

  it("reports null from the detail selector when coverage omits this schema", () => {
    // Coverage present but naming no entry for this schema means core could not
    // resolve the reference — again no answer, not an answer of zero.
    const mapping = { ...uncomputed(), coverage: { schemas: [] } };
    assert.equal(mod.mappingSchemaCoverage(mapping, src, "source"), null);
  });

  it("reports null from the overview index for a schema a coverage-less mapping references", () => {
    // Unknown has to beat partial: the union would otherwise silently omit that
    // mapping's contribution and understate the schema.
    const index = mod.buildCoverageIndex(modelWith([uncomputed()], [src]));
    assert.equal(index.get("s"), null);
  });

  it("still reports a genuine 0/N for a schema no mapping references", () => {
    // The case that must NOT be swept up with it: nothing touches `orphan`, so
    // every leaf really is uncovered and the card should say so.
    const index = mod.buildCoverageIndex(modelWith([uncomputed()], [src, orphan]));
    assert.deepEqual(
      index.get("orphan").map((e) => [e.path, e.state]),
      [["z", "uncovered"]],
    );
  });
});
