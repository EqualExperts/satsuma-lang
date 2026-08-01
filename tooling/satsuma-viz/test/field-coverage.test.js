import "./dom-shim.js";
import { describe, it } from "node:test";
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
    assert.equal(typeof mod.buildMappingCoveredFields, "function");
    assert.equal(typeof mod.resolveSchemaLocalFieldPath, "function");
    assert.equal(typeof mod.schemaHasFieldPath, "function");
  });

  it("resolves unqualified nested source paths against the owning schema", () => {
    const src = schema("order_events", [
      field("customer", [field("email"), field("tier")]),
    ]);
    assert.equal(mod.schemaHasFieldPath(src, "customer.email"), true);
    assert.equal(
      mod.resolveSchemaLocalFieldPath("customer.email", src, ["order_events", "customer_profiles"]),
      "customer.email",
    );
  });

  it("strips explicit schema qualifiers when resolving local paths", () => {
    const profiles = schema("customer_profiles", [field("region")]);
    assert.equal(
      mod.resolveSchemaLocalFieldPath("customer_profiles.region", profiles, ["order_events", "customer_profiles"]),
      "region",
    );
  });

  it("builds mapping coverage sets that include nested parents and children", () => {
    const orderEvents = schema("order_events", [
      field("customer", [field("email"), field("tier")]),
    ]);
    const target = schema("completed_orders", [
      field("customer_email"),
    ]);
    const mapping = {
      id: "completed orders",
      sourceRefs: ["order_events", "customer_profiles"],
      targetRef: "completed_orders",
      arrows: [
        {
          sourceFields: ["customer.email"],
          targetField: "customer_email",
          transform: null,
          metadata: [],
          comments: [],
          location: loc,
        },
      ],
      eachBlocks: [],
      flattenBlocks: [],
      nestedArrows: [],
      sourceBlock: null,
      notes: [],
      comments: [],
      location: loc,
    };

    const { sourceMapped, targetMapped } = mod.buildMappingCoveredFields(
      mapping,
      [orderEvents],
      target,
    );

    const sourceSet = sourceMapped.get("order_events");
    assert.ok(sourceSet);
    assert.equal(sourceSet.has("customer"), true);
    assert.equal(sourceSet.has("customer.email"), true);
    assert.equal(targetMapped.has("customer_email"), true);
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
      mod.resolveSchemaLocalFieldPath("crm::customers.id", customers, ["crm::customers", "crm::orders"]),
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

  it("covers both schemas of a namespaced multi-source mapping (sl-iqud)", () => {
    // End-to-end coverage repro from the ticket: a namespaced join mapping
    // with bare-prefixed arrow refs left sourceMapped empty for both schemas.
    const customers = schema("customers", [field("id"), field("email")], "crm::customers");
    const orders = schema("orders", [field("customer_id"), field("total")], "crm::orders");
    const target = schema("customer_orders", [field("email"), field("total")], "crm::customer_orders");
    const mapping = {
      id: "join_orders",
      sourceRefs: ["crm::customers", "crm::orders"],
      targetRef: "crm::customer_orders",
      arrows: [
        {
          sourceFields: ["customers.email"],
          targetField: "email",
          transform: null,
          metadata: [],
          comments: [],
          location: loc,
        },
        {
          sourceFields: ["orders.total"],
          targetField: "total",
          transform: null,
          metadata: [],
          comments: [],
          location: loc,
        },
      ],
      eachBlocks: [],
      flattenBlocks: [],
      nestedArrows: [],
      sourceBlock: null,
      notes: [],
      comments: [],
      location: loc,
    };

    const { sourceMapped, targetMapped } = mod.buildMappingCoveredFields(
      mapping,
      [customers, orders],
      target,
    );

    assert.deepEqual([...sourceMapped.get("crm::customers")], ["email"]);
    assert.deepEqual([...sourceMapped.get("crm::orders")], ["total"]);
    assert.equal(targetMapped.has("email"), true);
    assert.equal(targetMapped.has("total"), true);
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
  sourceFields: [src], targetField: tgt, transform: null, metadata: [], comments: [], location: loc,
});

/** A mapping with one arrow at each level: top, each, nested-each, flatten. */
const arrowAtEveryLevel = () => ({
  id: "m1",
  sourceRefs: ["order"],
  targetRef: "invoice",
  arrows: [arrow("id", "id")],
  eachBlocks: [{
    sourceField: "items",
    targetField: "lines",
    arrows: [arrow("items.sku", "lines.sku")],
    nestedEach: [{
      sourceField: "items.discounts",
      targetField: "lines.discounts",
      arrows: [arrow("items.discounts.code", "lines.discounts.code")],
      nestedEach: [],
      nestedFlatten: [],
      nestedArrows: [],
      location: loc,
    }],
    nestedFlatten: [],
    nestedArrows: [],
    location: loc,
  }],
  flattenBlocks: [{
    sourceField: "tags",
    targetField: "invoice",
    arrows: [arrow("tags.label", "tag_label")],
    nestedEach: [],
    nestedFlatten: [],
    nestedArrows: [],
    location: loc,
  }],
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
      eachBlocks: [{
        sourceField: "orders",
        targetField: "orders",
        arrows: [arrow("orders.id", "orders.id")],
        nestedEach: [],
        nestedFlatten: [{
          sourceField: "orders.parcels.contents",
          targetField: "orders.packed_items",
          arrows: [arrow("orders.parcels.contents.sku", "orders.packed_items.sku")],
          nestedEach: [],
          nestedFlatten: [],
          nestedArrows: [],
          location: loc,
        }],
        nestedArrows: [],
        location: loc,
      }],
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
      sourceField: src, targetField: tgt, arrows,
      nestedEach: [], nestedFlatten: [], nestedArrows: [], location: loc,
    });
    const mapping = {
      ...arrowAtEveryLevel(),
      arrows: [arrow("id", "id")],
      flattenBlocks: [],
      nestedArrows: [nestedArrowBlock("addr", "address", [arrow(".line1", ".line1")])],
      eachBlocks: [{
        sourceField: "items",
        targetField: "lines",
        arrows: [],
        nestedEach: [],
        nestedFlatten: [],
        nestedArrows: [nestedArrowBlock(".dims", ".dims", [arrow(".h", ".h")])],
        location: loc,
      }],
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
    const targets = detail._findTargetFieldsForSource("items.discounts.code", "order", detail.mapping);
    assert.deepEqual([...targets], ["lines.discounts.code"]);
  });
});
