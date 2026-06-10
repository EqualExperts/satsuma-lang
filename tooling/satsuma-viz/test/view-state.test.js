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

const schema = (id, qualifiedId = id) => ({
  id,
  qualifiedId,
  kind: "schema",
  label: null,
  fields: [],
  notes: [],
  comments: [],
  metadata: [],
  location: loc,
  hasExternalLineage: false,
  spreads: [],
});

const mapping = (id, sourceRefs = ["src"], targetRef = "tgt") => ({
  id,
  sourceRefs,
  targetRef,
  arrows: [],
  eachBlocks: [],
  flattenBlocks: [],
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
    assert.equal(viz._selectedMapping, newMapping, "selection must point at the NEW model's object");
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
