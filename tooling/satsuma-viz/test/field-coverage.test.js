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
// Arrows can nest arbitrarily deep: each_block → nestedEach → nestedEach.
// Surfaces that sum only the top-level collections (mapping.arrows +
// eachBlocks[].arrows + flattenBlocks[].arrows) silently lose every arrow
// below the first nesting level.
// ---------------------------------------------------------------------------

/** A mapping with one arrow at each level: top, each, nested-each, flatten. */
const arrowAtEveryLevel = () => ({
  id: "m1",
  sourceRefs: ["order"],
  targetRef: "invoice",
  arrows: [{ sourceFields: ["id"], targetField: "id", transform: null, metadata: [], comments: [], location: loc }],
  eachBlocks: [{
    sourceField: "items",
    targetField: "lines",
    arrows: [{ sourceFields: ["items.sku"], targetField: "lines.sku", transform: null, metadata: [], comments: [], location: loc }],
    nestedEach: [{
      sourceField: "items.discounts",
      targetField: "lines.discounts",
      arrows: [{ sourceFields: ["items.discounts.code"], targetField: "lines.discounts.code", transform: null, metadata: [], comments: [], location: loc }],
      nestedEach: [],
      location: loc,
    }],
    location: loc,
  }],
  flattenBlocks: [{
    sourceField: "tags",
    arrows: [{ sourceFields: ["tags.label"], targetField: "tag_label", transform: null, metadata: [], comments: [], location: loc }],
    location: loc,
  }],
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
