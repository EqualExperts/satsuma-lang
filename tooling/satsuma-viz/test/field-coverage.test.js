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
