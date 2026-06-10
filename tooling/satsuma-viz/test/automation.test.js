import "./dom-shim.js";
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

describe("viz automation helpers", () => {
  it("sanitizes test-id segments into stable selector-friendly names", async () => {
    const mod = await import("../dist/satsuma-viz.js");
    assert.equal(mod.sanitizeTestIdSegment("crm::Customer Orders"), "crm-customer-orders");
    assert.equal(mod.sanitizeTestIdSegment("---crm---orders---"), "crm-orders");
  });

  it("reports loading state before layout is available", async () => {
    const mod = await import("../dist/satsuma-viz.js");
    assert.deepEqual(
      mod.describeVizAutomationState({
        hasModel: true,
        hasOverviewLayout: false,
        hasDetailLayout: false,
        layoutError: false,
        viewMode: "overview",
      }),
      { readyState: "loading", renderMode: "empty", viewMode: "overview" },
    );
  });

  it("reports ready overview state once layout is complete", async () => {
    const mod = await import("../dist/satsuma-viz.js");
    assert.deepEqual(
      mod.describeVizAutomationState({
        hasModel: true,
        hasOverviewLayout: true,
        hasDetailLayout: true,
        layoutError: false,
        viewMode: "overview",
      }),
      { readyState: "ready", renderMode: "overview", viewMode: "overview" },
    );
  });

  it("reports fallback state when layout computation fails", async () => {
    const mod = await import("../dist/satsuma-viz.js");
    assert.deepEqual(
      mod.describeVizAutomationState({
        hasModel: true,
        hasOverviewLayout: false,
        hasDetailLayout: false,
        layoutError: true,
        viewMode: "overview",
      }),
      { readyState: "fallback", renderMode: "fallback", viewMode: "overview" },
    );
  });

  it("uses the dotted field path in nested field test ids and exposes coverage state", async () => {
    // Nested fields like customer.email must be selectable separately from a
    // sibling top-level email field, and Playwright should be able to assert
    // mapped vs unmapped state via a stable attribute (sl-eikr).
    const mod = await import("../dist/satsuma-viz.js");
    const card = new mod.SzSchemaCard();
    card.testIdPrefix = "src-customers";
    card.mappedFields = new Set(["customer.email"]);
    const child = {
      name: "email",
      type: "STRING",
      constraints: [],
      metadata: [],
      notes: [],
      comments: [],
      children: [],
      location: { uri: "file:///t.stm", line: 2, character: 0 },
    };
    const childTpl = card._renderField(child, 1, "customer");
    const serialized = [...childTpl.strings, ...childTpl.values.map(String)].join(" ");
    assert.match(serialized, /src-customers-field-customer-email/);
    assert.match(serialized, /data-coverage/);
    assert.match(serialized, /mapped/);
    // The parent struct must not collide with a top-level "email" segment.
    assert.ok(!/src-customers-field-email[^-]/.test(serialized));
  });

  it("renders a field whose model predates the metadata property (sl-6x1o)", async () => {
    // FieldEntry.metadata was added for sl-6x1o. Models serialized by older
    // LSP servers or cached webview payloads omit it, and the renderer must
    // still produce the field row rather than crash in _fieldMetaPills.
    const mod = await import("../dist/satsuma-viz.js");
    const card = new mod.SzSchemaCard();
    card.testIdPrefix = "src-legacy";
    card.mappedFields = new Set();
    const legacyField = {
      name: "amount",
      type: "DECIMAL",
      constraints: [],
      // no metadata property — pre-sl-6x1o payload shape
      notes: [],
      comments: [],
      children: [],
      location: { uri: "file:///t.stm", line: 1, character: 0 },
    };
    const tpl = card._renderField(legacyField, 0);
    const serialized = [...tpl.strings, ...tpl.values.map(String)].join(" ");
    assert.match(serialized, /src-legacy-field-amount/);
  });

  it("gives mapping-detail source and target schema cards distinct testIdPrefix values", async () => {
    // Source and target schema cards in the mapping detail must be addressable
    // separately even when the same schema id appears on both sides (sl-eikr).
    const mod = await import("../dist/satsuma-viz.js");
    const detail = new mod.SzMappingDetail();
    const schema = {
      id: "customers",
      qualifiedId: "crm::customers",
      kind: "schema",
      label: null,
      fields: [],
      notes: [],
      comments: [],
      metadata: [],
      location: { uri: "file:///t.stm", line: 0, character: 0 },
      hasExternalLineage: false,
      spreads: [],
    };
    detail.mapping = {
      id: "m1",
      sourceRefs: ["crm::customers"],
      targetRef: "crm::customers",
      sourceBlock: null,
      arrows: [],
      eachBlocks: [],
      flattenBlocks: [],
      metadata: [],
      location: { uri: "file:///t.stm", line: 0, character: 0 },
    };
    detail.sourceSchemas = [schema];
    detail.targetSchema = schema;
    const tpl = detail.render();
    const serialize = (t) => {
      if (t == null || typeof t !== "object") return String(t ?? "");
      if (Array.isArray(t)) return t.map(serialize).join(" ");
      if (t.strings && t.values) {
        return [...t.strings, ...t.values.map(serialize)].join(" ");
      }
      return "";
    };
    const serialized = serialize(tpl);
    assert.match(serialized, /mapping-detail-source-column/);
    assert.match(serialized, /mapping-detail-mapping-column/);
    assert.match(serialized, /mapping-detail-target-column/);
    assert.match(serialized, /mapping-detail-source-schema-card-crm-customers/);
    assert.match(serialized, /mapping-detail-target-schema-card-crm-customers/);
  });

  it("renders stable selector markers into the schema-card template", async () => {
    const mod = await import("../dist/satsuma-viz.js");
    const schemaCard = new mod.SzSchemaCard();
    schemaCard.testIdPrefix = "detail-schema-card-customers";
    schemaCard.schema = {
      id: "customers",
      qualifiedId: "customers",
      kind: "schema",
      label: null,
      fields: [{
        name: "customer_id",
        type: "UUID",
        constraints: [],
        metadata: [],
        notes: [],
        comments: [],
        children: [],
        location: { uri: "file:///test.stm", line: 1, character: 0 },
      }],
      notes: [],
      comments: [],
      metadata: [],
      location: { uri: "file:///test.stm", line: 0, character: 0 },
      hasExternalLineage: false,
      spreads: [],
    };
    const output = schemaCard.render();
    const fieldTemplate = schemaCard._renderField(schemaCard.schema.fields[0], 0);
    const serialized = [
      ...output.strings,
      ...output.values.map(String),
      ...fieldTemplate.strings,
      ...fieldTemplate.values.map(String),
    ].join(" ");

    assert.match(serialized, /data-testid/);
    assert.match(serialized, /detail-schema-card-customers-header/);
    assert.match(serialized, /detail-schema-card-customers-fields/);
    assert.match(serialized, /detail-schema-card-customers-field-customer-id-lineage/);
  });
});
