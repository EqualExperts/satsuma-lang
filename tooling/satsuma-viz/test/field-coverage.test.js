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
    assert.equal(typeof mod.buildMappingCoveredFields, "function");
    assert.equal(typeof mod.resolveSchemaLocalFieldPath, "function");
    assert.equal(typeof mod.schemaHasFieldPath, "function");
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

  it("builds mapping coverage sets that include nested parents and children", () => {
    const orderEvents = schema("order_events", [
      field("customer", [field("email"), field("tier")]),
    ]);
    const target = schema("completed_orders", [field("customer_email")]);
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

  it("covers both schemas of a namespaced multi-source mapping (sl-iqud)", () => {
    // End-to-end coverage repro from the ticket: a namespaced join mapping
    // with bare-prefixed arrow refs left sourceMapped empty for both schemas.
    const customers = schema("customers", [field("id"), field("email")], "crm::customers");
    const orders = schema("orders", [field("customer_id"), field("total")], "crm::orders");
    const target = schema(
      "customer_orders",
      [field("email"), field("total")],
      "crm::customer_orders",
    );
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
// contributed nothing to coverage, hover highlighting or overview edges.

describe("relative arrow paths resolve against their container (3cdd-yavi)", () => {
  /** @type {typeof import("../dist/satsuma-viz.js")} */
  let mod;

  const src = schema("s", [field("addr", [field("line1")]), field("orders", [field("id")])]);
  const tgt = schema("t", [field("address", [field("line1")]), field("orders", [field("id")])]);

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

  before(async () => {
    mod = await import("../dist/satsuma-viz.js");
  });

  it("counts a nested_arrow body's relative arrow as covering the qualified leaf", () => {
    // The ticket's headline case: `.line1 -> .line1` under `addr -> address`
    // covers addr.line1 and address.line1 on their respective cards.
    const mapping = mappingWith({
      nestedArrows: [block("addr", "address", { arrows: [arrow(".line1", ".line1")] })],
    });
    const { sourceMapped, targetMapped } = mod.buildMappingCoveredFields(mapping, [src], tgt);

    assert.equal(sourceMapped.get("s").has("addr.line1"), true);
    assert.equal(targetMapped.has("address.line1"), true);
    // The containers come along as ancestors of a covered leaf, which is what
    // makes the record row render as touched rather than as a gap.
    assert.equal(targetMapped.has("address"), true);
  });

  it("accumulates prefixes through a flatten nested inside an each", () => {
    // The sl-vu22 shape. Each container level contributes one segment, so the
    // rule has to compose — a single level of qualification would resolve
    // `.sku` to `parcels.sku` and still match nothing.
    const deepSrc = schema("s", [field("orders", [field("parcels", [field("sku")])])]);
    const deepTgt = schema("t", [field("orders", [field("packed", [field("sku")])])]);
    const mapping = mappingWith({
      eachBlocks: [
        block("orders", "orders", {
          nestedFlatten: [block(".parcels", ".packed", { arrows: [arrow(".sku", ".sku")] })],
        }),
      ],
    });

    const { sourceMapped, targetMapped } = mod.buildMappingCoveredFields(
      mapping,
      [deepSrc],
      deepTgt,
    );
    assert.equal(sourceMapped.get("s").has("orders.parcels.sku"), true);
    assert.equal(targetMapped.has("orders.packed.sku"), true);
  });

  it("leaves a mapping-level arrow untouched, dot and all", () => {
    // At mapping-body level there is no container to resolve against, so a
    // stray leading dot must stay unresolvable rather than be quietly matched
    // to a top-level field — coverage must never rise on a malformed path.
    const mapping = mappingWith({ arrows: [arrow(".orders", ".orders")] });
    const { sourceMapped, targetMapped } = mod.buildMappingCoveredFields(mapping, [src], tgt);

    assert.equal(sourceMapped.get("s").has("orders"), false);
    assert.equal(targetMapped.has("orders"), false);
  });
});
