// meta-pills-layout.test.js — metadata pills stack vertically and never
// drive card width (sl-dw9x).
//
// The original layout put all metadata pills in one nowrap row, so a long
// namespace URI set the card's intrinsic width and left a sea of white space
// under the pills (meta-pill-wasted-space.jpg in features/34-live-editor-ux).
// Pills are now width-contained (contain: inline-size) and stack one per row.
// These tests pin the layout side of that contract through
// computeOverviewLayout: width ignores pills entirely; height grows by
// exactly one pinned row per pill.
import "./dom-shim.js";
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

const loc = { uri: "file:///test.stm", line: 1, character: 0 };

const schema = (id, metadata = []) => ({
  id,
  qualifiedId: id,
  kind: "schema",
  label: null,
  fields: [],
  notes: [],
  comments: [],
  metadata,
  location: loc,
  hasExternalLineage: false,
  spreads: [],
});

const model = (...schemas) => ({
  uri: "file:///test.stm",
  fileNotes: [],
  namespaces: [{ name: null, schemas, mappings: [], metrics: [], fragments: [] }],
});

const node = (layout, id) => layout.nodes.find((n) => n.id === id);

describe("metadata pill geometry in the overview layout", () => {
  it("a long metadata value does not widen the card", async () => {
    const { computeOverviewLayout } = await import("../dist/satsuma-viz.js");
    const longUri = "namespace http://example.com/commerce/order/v2/with/a/really/long/path";
    const layout = await computeOverviewLayout(
      model(
        schema("plain"),
        schema("pilled", [{ key: "namespace", value: longUri }]),
      ),
    );

    // Same id-length headers → identical widths; the URI pill must not
    // contribute (it truncates inside the card instead).
    assert.equal(node(layout, "pilled").width, node(layout, "plain").width);
  });

  it("each pill adds exactly one pinned row to the card height", async () => {
    const {
      computeOverviewLayout,
      META_PILL_ROW_HEIGHT,
      META_PILL_ROW_GAP,
      METADATA_PILLS_CHROME,
    } = await import("../dist/satsuma-viz.js");

    const pills = (n) =>
      Array.from({ length: n }, (_, i) => ({ key: `k${i}`, value: `v${i}` }));
    const layout = await computeOverviewLayout(
      model(schema("none"), schema("one", pills(1)), schema("three", pills(3))),
    );

    const h = (id) => node(layout, id).height;
    // First pill brings the section chrome + one row…
    assert.equal(h("one") - h("none"), METADATA_PILLS_CHROME + META_PILL_ROW_HEIGHT);
    // …each further pill exactly one row + one gap. The card CSS pins these
    // same constants, so renderer and layout cannot drift.
    assert.equal(
      h("three") - h("one"),
      2 * (META_PILL_ROW_HEIGHT + META_PILL_ROW_GAP),
    );
  });
});
