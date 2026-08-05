// sz-chain-view.test.js — the field-chain rail rendering (sl-4czz, PRD 36 R4).
//
// The component only paints a host-supplied FieldChainModel; it never traces
// lineage itself. These tests pin: column ordering (furthest-first moving away
// from the focus card), the classification badge invented for this feature
// (no prior rendering precedent existed for "nl-derived"), the depth-limit
// affordance that makes truncation explicit rather than silent, namespace-fan
// collapse/expand, and the two events a host must handle to complete the
// "trace this field" and "open this mapping" interactions.
import "./dom-shim.js";
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

/** Flatten a Lit TemplateResult tree into plain text, the same way sibling test files do. */
function serialize(t) {
  if (t == null || typeof t !== "object") return String(t ?? "");
  if (Array.isArray(t)) return t.map(serialize).join(" ");
  if (t.strings && t.values) {
    return [...t.strings, ...t.values.map(serialize)].join(" ");
  }
  return "";
}

const hop = (field, viaMapping, classification, depth) => ({
  field,
  via_mapping: viaMapping,
  classification,
  depth,
});

describe("sz-chain-view", () => {
  it("renders an empty state when no chain is supplied", async () => {
    const mod = await import("../dist/satsuma-viz.js");
    const view = new mod.SzChainView();
    const serialized = serialize(view.render());
    assert.match(serialized, /chain-empty/);
  });

  it("renders the focus field's namespace, schema, and path", async () => {
    const mod = await import("../dist/satsuma-viz.js");
    const view = new mod.SzChainView();
    view.chain = { field: "crm::orders.id", maxDepth: 5, upstream: [], downstream: [] };
    const serialized = serialize(view.render());
    assert.match(serialized, /chain-focus/);
    assert.match(serialized, /crm/);
    assert.match(serialized, /orders/);
    assert.match(serialized, /\bid\b/);
  });

  it("orders upstream columns furthest-first so hop distance increases moving away from the focus card", async () => {
    // Depth 2 must appear before depth 1 in the upstream rail so the reader's
    // eye moves focus -> near -> far in the same left-to-right direction the
    // downstream rail already reads in.
    const mod = await import("../dist/satsuma-viz.js");
    const view = new mod.SzChainView();
    view.chain = {
      field: "::orders.id",
      maxDepth: 5,
      upstream: [
        hop("::customers.id", "::load_customers", "none", 1),
        hop("::legacy.id", "::migrate", "none", 2),
      ],
      downstream: [],
    };
    const serialized = serialize(view.render());
    assert.ok(
      serialized.indexOf("chain-column-upstream-2") < serialized.indexOf("chain-column-upstream-1"),
      "expected the depth-2 column before the depth-1 column",
    );
  });

  describe("classification badge", () => {
    it("renders no badge for a direct, undeclared-transform hop", async () => {
      const mod = await import("../dist/satsuma-viz.js");
      const view = new mod.SzChainView();
      assert.equal(view._renderClassificationBadge("none"), "");
    });

    it("labels a declared arrow with a transform as NL", async () => {
      const mod = await import("../dist/satsuma-viz.js");
      const view = new mod.SzChainView();
      const serialized = serialize(view._renderClassificationBadge("nl"));
      assert.match(serialized, /classification-badge nl"/);
      assert.match(serialized, /\bNL\b/);
    });

    it("distinctly labels an @ref-inferred hop as NL-derived, not just NL", async () => {
      // This classification had zero rendering precedent anywhere in the
      // package before this feature — reviewers must be able to tell an
      // inferred hop from a declared one at a glance.
      const mod = await import("../dist/satsuma-viz.js");
      const view = new mod.SzChainView();
      const serialized = serialize(view._renderClassificationBadge("nl-derived"));
      assert.match(serialized, /nl-derived/);
      assert.match(serialized, /NL-derived/);
    });
  });

  it("flags only the hop sitting exactly on the requested depth cap, not shallower hops", async () => {
    // maxDepth: 2. The depth-1 hops are confirmed nearer hops; the depth-2
    // hop sits on the boundary and may have further, untraced neighbours.
    const mod = await import("../dist/satsuma-viz.js");
    const view = new mod.SzChainView();
    view.chain = {
      field: "::orders.id",
      maxDepth: 2,
      upstream: [
        hop("::customers.id", "::load_customers", "none", 1),
        hop("::legacy.id", "::migrate", "nl-derived", 2),
      ],
      downstream: [hop("::invoices.order_id", "::bill", "none", 1)],
    };
    const serialized = serialize(view.render());
    assert.match(serialized, /chain-depth-limit-upstream-2/);
    assert.doesNotMatch(serialized, /chain-depth-limit-upstream-1/);
    assert.doesNotMatch(serialized, /chain-depth-limit-downstream-1/);
  });

  describe("namespace-fan collapse", () => {
    const wideChain = {
      field: "::orders.id",
      maxDepth: 5,
      upstream: [
        hop("crm::a.id", "crm::m1", "none", 1),
        hop("crm::b.id", "crm::m1", "none", 1),
        hop("crm::c.id", "crm::m1", "none", 1),
        hop("crm::d.id", "crm::m1", "none", 1),
      ],
      downstream: [],
    };

    it("collapses a namespace group of more than three hops to a summary chip", async () => {
      const mod = await import("../dist/satsuma-viz.js");
      const view = new mod.SzChainView();
      view.chain = wideChain;
      const serialized = serialize(view.render());
      assert.match(serialized, /chain-group-upstream:1:crm/);
      assert.doesNotMatch(serialized, /chain-hop-field-upstream-1/);
    });

    it("expands a collapsed group on request, revealing its individual hop cards", async () => {
      const mod = await import("../dist/satsuma-viz.js");
      const view = new mod.SzChainView();
      view.chain = wideChain;
      view._expandGroup("upstream:1:crm");
      const serialized = serialize(view.render());
      assert.match(serialized, /chain-hop-field-upstream-1/);
    });

    it("never collapses a group of three or fewer hops", async () => {
      const mod = await import("../dist/satsuma-viz.js");
      const view = new mod.SzChainView();
      view.chain = {
        field: "::orders.id",
        maxDepth: 5,
        upstream: [hop("crm::a.id", "crm::m1", "none", 1), hop("crm::b.id", "crm::m1", "none", 1)],
        downstream: [],
      };
      const serialized = serialize(view.render());
      assert.match(serialized, /chain-hop-field-upstream-1/);
      assert.doesNotMatch(serialized, /chain-group-upstream:1:crm/);
    });
  });

  it("dispatches a field-lineage request when a hop's field is clicked, for the host to retrace", async () => {
    const mod = await import("../dist/satsuma-viz.js");
    const view = new mod.SzChainView();
    const received = [];
    view.addEventListener("field-lineage", (e) => received.push(e));

    view._focusField("crm::customers", "email");

    assert.equal(received.length, 1);
    assert.equal(received[0].schemaId, "crm::customers");
    assert.equal(received[0].fieldName, "email");
  });

  it("dispatches chain-open-mapping when a hop's mapping label is clicked", async () => {
    const mod = await import("../dist/satsuma-viz.js");
    const view = new mod.SzChainView();
    const received = [];
    view.addEventListener("chain-open-mapping", (e) => received.push(e));

    view._openMapping("crm::load_customers");

    assert.equal(received.length, 1);
    assert.equal(received[0].viaMapping, "crm::load_customers");
  });
});
