/**
 * coverage-overlay.test.js — Overview coverage is an opt-in paint layer.
 *
 * These tests pin the parent component's toggle contract and the key geometry
 * invariant: changing coverage visibility re-renders existing nodes without
 * asking ELK for a new layout or replacing its coordinates.
 */
import "./dom-shim.js";
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

/** Serialize a Lit template with interpolated values in source order. */
function renderText(template) {
  const serialize = (value) => {
    if (value == null) return "";
    if (Array.isArray(value)) return value.map(serialize).join("");
    if (typeof value === "object" && value.strings && "values" in value) {
      return value.strings
        .map(
          (part, index) =>
            part + (index < value.values.length ? serialize(value.values[index]) : ""),
        )
        .join("");
    }
    return String(value);
  };
  return serialize(template);
}

describe("overview coverage toggle (sl-5m9x)", () => {
  it("defaults off and exposes a reflected public property", async () => {
    // Existing embeds must retain their current overview until a user opts in;
    // reflection also makes the mode observable to hosts and CSS automation.
    const mod = await import("../dist/satsuma-viz.js");
    const viz = new mod.SatsumaViz();
    const options = mod.SatsumaViz.elementProperties.get("coverageOverlay");
    assert.equal(viz.coverageOverlay, false);
    assert.equal(options?.reflect, true);
    assert.equal(options?.attribute, "coverage-overlay");
  });

  it("toggles from the overview toolbar without replacing layout geometry", async () => {
    // Overlay state changes card text and paint only. Preserving the exact
    // layout object proves the toggle does not invoke the async ELK pipeline.
    const mod = await import("../dist/satsuma-viz.js");
    const viz = new mod.SatsumaViz();
    const layout = { width: 10, height: 10, nodes: [], edges: [] };
    viz._overviewLayout = layout;

    const before = renderText(viz._renderToolbar([]));
    assert.match(before, /data-testid="toolbar-toggle-coverage"/);
    assert.match(before, /aria-pressed="?false/);

    viz._toggleCoverageOverlay();

    assert.equal(viz.coverageOverlay, true);
    assert.equal(viz._overviewLayout, layout);
    assert.match(renderText(viz._renderToolbar([])), /aria-pressed="?true/);
  });
});
