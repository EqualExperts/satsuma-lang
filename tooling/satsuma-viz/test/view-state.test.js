// view-state.test.js — model-replacement view-state reconciliation (sl-2ksz).
//
// Live editing reassigns the `model` property on every debounced keystroke.
// These tests pin the contract of _reconcileViewState: the detail view and
// per-schema expansion state survive a model rebuild when their subjects
// still exist (matched by name, since every object is replaced), and reset
// only when they are gone. A regression here means every edit in the
// playground kicks the user back to the overview.
import "./dom-shim.js";
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

const loc = { uri: "file:///test.stm", line: 1, character: 0 };

const schema = (id, qualifiedId = id, fields = []) => ({
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

const field = (name) => ({
  name,
  type: "STRING",
  constraints: [],
  metadata: [],
  notes: [],
  comments: [],
  children: [],
  location: loc,
});

const mapping = (id, sourceRefs = ["src"], targetRef = "tgt") => ({
  id,
  sourceRefs,
  targetRef,
  arrows: [],
  eachBlocks: [],
  flattenBlocks: [],
  nestedArrows: [],
  sourceBlock: null,
  notes: [],
  comments: [],
  location: loc,
});

const namespace = (name, { schemas = [], mappings = [], metrics = [], fragments = [] } = {}) => ({
  name,
  schemas,
  mappings,
  metrics,
  fragments,
});

const model = (...namespaces) => ({
  uri: "file:///test.stm",
  fileNotes: [],
  namespaces,
});

/** Build a viz instance in detail view, as if the user opened `m` from `oldModel`. */
async function vizInDetailView(oldModel, m) {
  const mod = await import("../dist/satsuma-viz.js");
  const viz = new mod.SatsumaViz();
  viz.model = oldModel;
  viz._viewMode = "detail";
  viz._selectedMapping = m;
  viz._selectedMappingKey = viz._mappingKey(m);
  return viz;
}

describe("view-state reconciliation across model updates", () => {
  it("keeps the detail view open and re-binds the selection when the mapping still exists", async () => {
    const oldMapping = mapping("orders_pipeline");
    const oldModel = model(namespace(null, { mappings: [oldMapping] }));
    const viz = await vizInDetailView(oldModel, oldMapping);

    const newMapping = mapping("orders_pipeline"); // fresh object, same name
    viz._reconcileViewState(model(namespace(null, { mappings: [newMapping] })));

    assert.equal(viz._viewMode, "detail");
    assert.equal(
      viz._selectedMapping,
      newMapping,
      "selection must point at the NEW model's object",
    );
  });

  it("falls back to the overview when the selected mapping was renamed or deleted", async () => {
    const oldMapping = mapping("orders_pipeline");
    const oldModel = model(namespace(null, { mappings: [oldMapping] }));
    const viz = await vizInDetailView(oldModel, oldMapping);

    viz._reconcileViewState(model(namespace(null, { mappings: [mapping("renamed_pipeline")] })));

    assert.equal(viz._viewMode, "overview");
    assert.equal(viz._selectedMapping, null);
    assert.equal(viz._selectedMappingKey, null);
  });

  it("does not match a same-named mapping from a different namespace", async () => {
    // Mapping ids are only unique within a namespace; matching by bare id
    // would silently jump the user into another namespace's mapping.
    const oldMapping = mapping("pipeline");
    const oldModel = model(namespace("crm", { mappings: [oldMapping] }));
    const viz = await vizInDetailView(oldModel, oldMapping);

    viz._reconcileViewState(model(namespace("billing", { mappings: [mapping("pipeline")] })));

    assert.equal(viz._viewMode, "overview");
  });

  it("prunes expansion state for ids that no longer exist, keeping survivors", async () => {
    const mod = await import("../dist/satsuma-viz.js");
    const viz = new mod.SatsumaViz();
    viz._expandedModels = new Map([
      ["kept_schema", []],
      ["dropped_schema", []],
    ]);
    viz._compactExpandedIds = new Set(["kept_schema", "dropped_schema"]);

    viz._reconcileViewState(model(namespace(null, { schemas: [schema("kept_schema")] })));

    assert.deepEqual([...viz._expandedModels.keys()], ["kept_schema"]);
    assert.deepEqual([...viz._compactExpandedIds], ["kept_schema"]);
  });

  it("stays in the overview on first load with no prior selection", async () => {
    const mod = await import("../dist/satsuma-viz.js");
    const viz = new mod.SatsumaViz();

    viz._reconcileViewState(model(namespace(null, { mappings: [mapping("m1")] })));

    assert.equal(viz._viewMode, "overview");
    assert.equal(viz._selectedMapping, null);
  });
});

describe("openFieldChain (sl-4czz)", () => {
  it("enters chain view with the host-supplied traversal", async () => {
    const mod = await import("../dist/satsuma-viz.js");
    const viz = new mod.SatsumaViz();
    const chain = { field: "::orders.id", maxDepth: 10, upstream: [], downstream: [] };

    viz.openFieldChain(chain);

    assert.equal(viz._viewMode, "chain");
    assert.equal(viz._chainModel, chain);
  });
});

describe("chain view reconciliation across model updates (sl-4czz)", () => {
  /** Build a viz instance in chain view, as if the host had just traced `focusField`. */
  async function vizInChainView(oldModel, chain) {
    const mod = await import("../dist/satsuma-viz.js");
    const viz = new mod.SatsumaViz();
    viz.model = oldModel;
    viz.openFieldChain(chain);
    return viz;
  }

  it("re-requests a retrace of the same field when its schema and path still exist", async () => {
    // Chain data cannot be reconstructed from VizModel alone (it is a
    // host-supplied traversal), so surviving a model edit means asking the
    // host to recompute it — not rebinding locally, unlike mapping detail.
    const oldModel = model(
      namespace(null, { schemas: [schema("orders", "orders", [field("id")])] }),
    );
    const chain = { field: "::orders.id", maxDepth: 10, upstream: [], downstream: [] };
    const viz = await vizInChainView(oldModel, chain);
    const received = [];
    viz.addEventListener("field-lineage", (e) => received.push(e));

    viz._reconcileViewState(
      model(namespace(null, { schemas: [schema("orders", "orders", [field("id")])] })),
    );

    assert.equal(viz._viewMode, "chain");
    assert.equal(received.length, 1);
    assert.equal(received[0].schemaId, "orders");
    assert.equal(received[0].fieldName, "id");
  });

  it("falls back to the overview when the focus field's schema no longer exists", async () => {
    const oldModel = model(
      namespace(null, { schemas: [schema("orders", "orders", [field("id")])] }),
    );
    const chain = { field: "::orders.id", maxDepth: 10, upstream: [], downstream: [] };
    const viz = await vizInChainView(oldModel, chain);

    viz._reconcileViewState(model(namespace(null, { schemas: [] })));

    assert.equal(viz._viewMode, "overview");
    assert.equal(viz._chainModel, null);
  });

  it("falls back to the overview when the schema survives but the field was removed", async () => {
    const oldModel = model(
      namespace(null, { schemas: [schema("orders", "orders", [field("id")])] }),
    );
    const chain = { field: "::orders.id", maxDepth: 10, upstream: [], downstream: [] };
    const viz = await vizInChainView(oldModel, chain);

    viz._reconcileViewState(
      model(namespace(null, { schemas: [schema("orders", "orders", [field("total")])] })),
    );

    assert.equal(viz._viewMode, "overview");
    assert.equal(viz._chainModel, null);
  });

  it("does not match a same-named schema from a different namespace", async () => {
    const oldModel = model(
      namespace("crm", { schemas: [schema("orders", "crm::orders", [field("id")])] }),
    );
    const chain = { field: "crm::orders.id", maxDepth: 10, upstream: [], downstream: [] };
    const viz = await vizInChainView(oldModel, chain);

    viz._reconcileViewState(
      model(
        namespace("billing", { schemas: [schema("orders", "billing::orders", [field("id")])] }),
      ),
    );

    assert.equal(viz._viewMode, "overview");
  });
});

describe("chain hop mapping-label navigation (sl-4czz)", () => {
  // _openMappingByRef is exercised directly rather than via a dispatched
  // "chain-open-mapping" event: the internal listener that routes the event
  // to it is registered in connectedCallback(), which the dom-shim never
  // fires for an unattached element — the same reason every other case in
  // this file drives _reconcileViewState directly instead of a model-change
  // event.
  it("opens the mapping detail view for a global mapping referenced by a chain hop", async () => {
    const mod = await import("../dist/satsuma-viz.js");
    const viz = new mod.SatsumaViz();
    const m = mapping("load_orders");
    viz.model = model(namespace(null, { mappings: [m] }));

    viz._openMappingByRef("::load_orders");

    assert.equal(viz._viewMode, "detail");
    assert.equal(viz._selectedMapping, m);
  });

  it("opens the mapping detail view for a namespaced mapping referenced by a chain hop", async () => {
    const mod = await import("../dist/satsuma-viz.js");
    const viz = new mod.SatsumaViz();
    const m = mapping("load_orders");
    viz.model = model(namespace("crm", { mappings: [m] }));

    viz._openMappingByRef("crm::load_orders");

    assert.equal(viz._viewMode, "detail");
    assert.equal(viz._selectedMapping, m);
  });

  it("does nothing when the referenced mapping is not in the currently loaded model", async () => {
    // A cross-file chain hop's mapping may live outside the loaded document;
    // silently doing nothing is preferable to a crash or a wrong navigation.
    const mod = await import("../dist/satsuma-viz.js");
    const viz = new mod.SatsumaViz();
    viz.model = model(namespace(null, { mappings: [mapping("load_orders")] }));

    viz._openMappingByRef("::not_loaded");

    assert.equal(viz._viewMode, "overview");
    assert.equal(viz._selectedMapping, null);
  });

  // The connectedCallback() listener that routes a dispatched
  // "chain-open-mapping" event to _openMappingByRef is not separately
  // exercised: this package's dom-shim provides no `window`/ResizeObserver,
  // so connectedCallback() throws outside a real browser. The cases above
  // cover _openMappingByRef's resolution logic directly, matching how every
  // other case in this file drives _reconcileViewState rather than a
  // dispatched model-change event.
});
