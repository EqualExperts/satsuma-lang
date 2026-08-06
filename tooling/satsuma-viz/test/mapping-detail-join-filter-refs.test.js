/**
 * mapping-detail-join-filter-refs.test.js — @refs inside a mapping's join and
 * filter descriptions must be highlighted the same way NL transform text and
 * arrow notes are (sl-yhlj).
 *
 * Before this fix, `sz-mapping-detail` interpolated `sb.joinDescription` and
 * each filter string directly into the template, so an `@schema.field` token
 * inside them rendered as plain text while the identical token in a transform
 * or note rendered inside a styled `<span class="at-ref">`. These tests prove
 * the join/filter render paths now go through the same `highlightAtRefs`
 * pipeline by resolving the `unsafeHTML` directive's committed markup — the
 * one thing a plain-text-substitution serializer (as used by
 * mapping-detail-arrow-table.test.js) cannot observe.
 */
import "./dom-shim.js";
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

const LOC = { uri: "file:///test.stm", line: 0, character: 0 };

/**
 * A mapping block whose only interesting field is `sourceBlock` — the join
 * description and filter list under test. Every other container defaults to
 * empty, matching the "nothing else going on" shape these tests need.
 */
function mappingBlock(sourceBlock) {
  return {
    id: "consumer",
    sourceRefs: ["src"],
    targetRef: "tgt",
    arrows: [],
    eachBlocks: [],
    flattenBlocks: [],
    nestedArrows: [],
    sourceBlock,
    metadata: [],
    notes: [],
    comments: [],
    location: LOC,
  };
}

/**
 * Render the detail view's markup as text, resolving both plain lit `html`
 * template results AND `unsafeHTML()` directive results.
 *
 * `unsafeHTML(str)` does not commit its HTML at template-construction time —
 * calling it just returns a directive marker (`{_$litDirective$, values}`).
 * The actual escaped-and-@ref-wrapped markup only exists once that
 * directive's `render()` method runs, which is what lit-html's part-committing
 * machinery does inside a real DOM. Since dom-shim.js is not a full DOM (see
 * its module comment), there is no shadow root to read `innerHTML` from, so
 * this helper drives the directive class directly to get the same string a
 * browser would commit — the smallest step beyond plain-value serialization
 * that still proves the join/filter text passed through highlightAtRefs.
 */
function renderText(detail) {
  const serialize = (value) => {
    if (value == null) return "";
    if (Array.isArray(value)) return value.map(serialize).join("");
    if (value && typeof value === "object" && "_$litDirective$" in value) {
      const DirectiveClass = value._$litDirective$;
      // PartType.CHILD (2) — the only part type unsafeHTML's constructor accepts.
      const instance = new DirectiveClass({ type: 2 });
      return serialize(instance.render(...value.values));
    }
    if (typeof value === "object" && value.strings && "values" in value) {
      return value.strings
        .map((s, i) => s + (i < value.values.length ? serialize(value.values[i]) : ""))
        .join("");
    }
    return String(value);
  };
  return serialize(detail.render());
}

/** A detail view bound to `mapping`, with no schema cards to either side. */
async function makeDetail(mapping) {
  const mod = await import("../dist/satsuma-viz.js");
  const detail = new mod.SzMappingDetail();
  detail.mapping = mapping;
  detail.sourceSchemas = [];
  detail.targetSchema = null;
  return detail;
}

describe("join description @ref highlighting (sl-yhlj)", () => {
  it("wraps an @ref inside the join description in a styled span, not plain text", async () => {
    // Mirrors the shape of examples/filter-flatten-governance's `completed
    // orders` mapping: a join description naming a source field by @ref.
    const sourceBlock = {
      schemas: ["order_events", "customer_profiles"],
      joinDescription: "Join on customer_id WHERE @order_events.order_status = completed",
      filters: [],
    };
    const text = renderText(await makeDetail(mappingBlock(sourceBlock)));

    assert.match(text, /<span class="at-ref">@order_events\.order_status<\/span>/);
    // The surrounding prose must survive untouched — only the @ref token
    // itself gets wrapped, not the whole join description.
    assert.match(text, /Join on customer_id WHERE/);
  });

  it("HTML-escapes the join description before highlighting, same as NL transform text", async () => {
    // highlightAtRefs escapes first (see markdown.ts) so a join description
    // that happens to contain `<`/`>` cannot inject markup. Proves the
    // join/filter call sites inherited that safety, not just the highlighting.
    const sourceBlock = {
      schemas: ["a"],
      joinDescription: "@a.x < @a.y",
      filters: [],
    };
    const text = renderText(await makeDetail(mappingBlock(sourceBlock)));

    assert.match(text, /&lt;/);
    assert.doesNotMatch(text, /@a\.x < @a\.y/);
  });
});

describe("filter description @ref highlighting (sl-yhlj)", () => {
  it("wraps an @ref inside a filter description in a styled span, not plain text", async () => {
    const sourceBlock = {
      schemas: ["orders"],
      joinDescription: null,
      filters: ["@orders.status = active"],
    };
    const text = renderText(await makeDetail(mappingBlock(sourceBlock)));

    assert.match(text, /<span class="at-ref">@orders\.status<\/span>/);
  });
});
