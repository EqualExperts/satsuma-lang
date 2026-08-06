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
        hasChainModel: false,
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
        hasChainModel: false,
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
        hasChainModel: false,
        layoutError: true,
        viewMode: "overview",
      }),
      { readyState: "fallback", renderMode: "fallback", viewMode: "overview" },
    );
  });

  it("reports loading state for chain view before a host has supplied a chain model", async () => {
    // Chain view has no ELK layout to wait on — its own readiness signal is
    // whether openFieldChain() has been called yet, not hasOverviewLayout.
    const mod = await import("../dist/satsuma-viz.js");
    assert.deepEqual(
      mod.describeVizAutomationState({
        hasModel: true,
        hasOverviewLayout: true,
        hasDetailLayout: true,
        hasChainModel: false,
        layoutError: false,
        viewMode: "chain",
      }),
      { readyState: "loading", renderMode: "empty", viewMode: "chain" },
    );
  });

  it("reports ready chain state once a chain model has been supplied", async () => {
    const mod = await import("../dist/satsuma-viz.js");
    assert.deepEqual(
      mod.describeVizAutomationState({
        hasModel: true,
        hasOverviewLayout: true,
        hasDetailLayout: true,
        hasChainModel: true,
        layoutError: false,
        viewMode: "chain",
      }),
      { readyState: "ready", renderMode: "chain", viewMode: "chain" },
    );
  });

  it("uses the dotted field path in nested field test ids and exposes coverage state", async () => {
    // Nested fields like customer.email must be selectable separately from a
    // sibling top-level email field, and Playwright should be able to assert
    // mapped vs unmapped state via a stable attribute (sl-eikr).
    const mod = await import("../dist/satsuma-viz.js");
    const card = new mod.SzSchemaCard();
    card.testIdPrefix = "src-customers";
    card.coverage = [
      {
        path: "customer.email",
        uri: "file:///t.stm",
        mapped: true,
        state: "covered",
        tier: "declared",
      },
    ];
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
    // Asserted against the interpolated values, not as a substring of the joined
    // output: this serialization concatenates `strings` and `values` separately,
    // so an attribute name is never adjacent to its value, and a bare /mapped/
    // matched the word inside "unmapped". The case therefore kept passing after
    // the property it set was renamed away and the card was rendering no verdict
    // at all — Playwright asserts the exact attribute values, so the unit test
    // should too.
    const values = childTpl.values.map(String);
    assert.ok(values.includes("mapped"), `expected a mapped verdict, got ${values.join()}`);
    assert.ok(values.includes("covered"), `expected state=covered, got ${values.join()}`);
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
    card.coverage = [];
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

  it("renders a field note only as the field-note row, never as a meta pill (sl-1gqw)", async () => {
    // A field's (note "...") tag reaches the model twice: as a NoteBlock in
    // f.notes and as a MetadataEntry in f.metadata. Only the shaded field-note
    // row should render it — a duplicate "note ..." pill is visual noise.
    // Other kv metadata on the same field must still render as pills.
    const mod = await import("../dist/satsuma-viz.js");
    const card = new mod.SzSchemaCard();
    card.testIdPrefix = "src-orders";
    card.coverage = [];
    const field = {
      name: "order_key",
      type: "VARCHAR",
      constraints: [],
      metadata: [
        { key: "note", value: "Unique key across ORDERS tables" },
        { key: "sensitivity", value: "internal" },
      ],
      notes: [
        {
          text: "Unique key across ORDERS tables",
          isMultiline: false,
          location: { uri: "file:///t.stm", line: 1, character: 0 },
        },
      ],
      comments: [],
      children: [],
      location: { uri: "file:///t.stm", line: 1, character: 0 },
    };
    const pills = card._fieldMetaPills(field);
    assert.deepEqual(
      pills.map((p) => p.key),
      ["sensitivity"],
    );

    // The note text must still reach the rendered output via the field-note row.
    const serialize = (t) => {
      if (t == null || typeof t !== "object") return String(t ?? "");
      if (Array.isArray(t)) return t.map(serialize).join(" ");
      if (t.strings && t.values) {
        return [...t.strings, ...t.values.map(serialize)].join(" ");
      }
      return "";
    };
    const serialized = serialize(card._renderField(field, 0));
    assert.match(serialized, /field-note/);
    assert.match(serialized, /Unique key across ORDERS tables/);
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
      nestedArrows: [],
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
      fields: [
        {
          name: "customer_id",
          type: "UUID",
          constraints: [],
          metadata: [],
          notes: [],
          comments: [],
          children: [],
          location: { uri: "file:///test.stm", line: 1, character: 0 },
        },
      ],
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

/**
 * sz-schema-card enum badge (sl-2ne7) — a multi-value enum used to render as
 * one unbroken pill joining every value ("enum enterprise | mid_market | smb
 * | individual"), which was the widest thing on a field row carrying several
 * tags. These cases pin the fix: the badge always shows a collapsed count,
 * and the full value list is reachable only through the click-to-expand
 * overlay, keyed off the card's private `_expandedEnumField` state.
 *
 * Playwright coverage for the actual click/outside-click/Escape gestures and
 * the overlay's real paint (it must escape the card's clipped overflow)
 * lives in tooling/satsuma-viz-harness/test/harness.test.ts — none of that is
 * observable from a serialized render() output, which is all a Node test can
 * drive here.
 */
describe("sz-schema-card enum badge (sl-2ne7)", () => {
  const LOC = { uri: "file:///t.stm", line: 0, character: 0 };

  /** A `segment` field carrying the four-value enum from the bug report. */
  function segmentField() {
    return {
      name: "segment",
      type: "VARCHAR(20)",
      constraints: [],
      metadata: [
        {
          key: "enum",
          value: "enterprise | mid_market | smb | individual",
          values: ["enterprise", "mid_market", "smb", "individual"],
        },
      ],
      notes: [],
      comments: [],
      children: [],
      location: LOC,
    };
  }

  /**
   * Serializes a lit-html TemplateResult with template values interleaved in
   * source order, so e.g. "(" and the count and ")" land adjacent exactly as
   * the template author wrote them — a plain "strings then values" join (as
   * used for existence-only checks elsewhere in this file) would scatter the
   * count away from its parentheses and make an adjacency assertion like
   * `/\(4\)/` meaningless. Same approach as schema-card-coverage.test.js's
   * `renderText`.
   */
  function serialize(value) {
    if (value == null) return "";
    if (Array.isArray(value)) return value.map(serialize).join("");
    if (typeof value === "object" && value.strings && "values" in value) {
      return value.strings
        .map((s, i) => s + (i < value.values.length ? serialize(value.values[i]) : ""))
        .join("");
    }
    return String(value);
  }

  it("collapses to a count and omits the joined value list by default", async () => {
    const mod = await import("../dist/satsuma-viz.js");
    const card = new mod.SzSchemaCard();
    card.testIdPrefix = "src-crm";
    card.coverage = [];
    const serialized = serialize(card._renderField(segmentField(), 0));

    assert.match(serialized, /src-crm-field-segment-enum-badge/);
    assert.match(serialized, /\(4\)/);
    // The overlay must not be present at all while collapsed — not merely
    // hidden by CSS — or Playwright's `.toBeVisible()` on the collapsed
    // fixture would be trivially true for the wrong reason.
    assert.doesNotMatch(serialized, /enum-overlay/);
    assert.doesNotMatch(serialized, /enterprise \| mid_market/);
  });

  it("expands into an overlay listing every value once its field path is the expanded one", async () => {
    const mod = await import("../dist/satsuma-viz.js");
    const card = new mod.SzSchemaCard();
    card.testIdPrefix = "src-crm";
    card.coverage = [];
    card._expandedEnumField = "segment";
    const serialized = serialize(card._renderField(segmentField(), 0));

    assert.match(serialized, /src-crm-field-segment-enum-overlay/);
    for (const value of ["enterprise", "mid_market", "smb", "individual"]) {
      assert.match(serialized, new RegExp(value));
    }
  });

  it("collapses again once a different field becomes the expanded one", async () => {
    // Only one overlay is open at a time (per the card's own state doc
    // comment) — a stale path from a previously expanded field must not
    // leave this field's overlay rendered too.
    const mod = await import("../dist/satsuma-viz.js");
    const card = new mod.SzSchemaCard();
    card.testIdPrefix = "src-crm";
    card.coverage = [];
    card._expandedEnumField = "some_other_field";
    const serialized = serialize(card._renderField(segmentField(), 0));

    assert.doesNotMatch(serialized, /enum-overlay/);
  });

  it("derives the count and overlay values from the joined string when an older payload has no values array", async () => {
    // Cached webview payloads or an LSP older than sl-2ne7 emit MetadataEntry
    // without `values` — only the joined `value` string metaEntriesToViz has
    // always produced. The badge must still collapse correctly rather than
    // reading `values.length` off `undefined`.
    const mod = await import("../dist/satsuma-viz.js");
    const card = new mod.SzSchemaCard();
    card.testIdPrefix = "src-crm";
    card.coverage = [];
    const legacyField = segmentField();
    legacyField.metadata = [{ key: "enum", value: "enterprise | mid_market | smb | individual" }];
    card._expandedEnumField = "segment";
    const serialized = serialize(card._renderField(legacyField, 0));

    assert.match(serialized, /\(4\)/);
    assert.match(serialized, /individual/);
  });
});
