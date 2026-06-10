// svg-export.test.js — exported SVG is self-contained (sl-7pdf).
//
// The export builds its SVG from the component's templates, which style
// everything with `var(--sz-*)` theme tokens. Those tokens live in the
// component's stylesheets and do NOT travel with a downloaded .svg file, so
// every reference must be inlined to the literal colour of the active theme
// at export time. These tests pin the inlining helper's contract.
import "./dom-shim.js";
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

describe("inlineCssVariables", () => {
  it("replaces every var(--*) reference with the resolved literal value", async () => {
    const { inlineCssVariables } = await import("../dist/satsuma-viz.js");
    const palette = { "--sz-orange": "#F2913D", "--sz-card-bg": "rgb(255, 250, 245)" };

    const svg = '<rect fill="var(--sz-card-bg)" stroke="var(--sz-orange)"/>'
      + ".cls { color: var(--sz-orange); }";
    const out = inlineCssVariables(svg, (name) => palette[name] ?? "");

    assert.equal(
      out,
      '<rect fill="rgb(255, 250, 245)" stroke="#F2913D"/>.cls { color: #F2913D; }',
    );
    assert.ok(!out.includes("var("), "no unresolved references remain");
  });

  it("resolves values with surrounding whitespace (getComputedStyle returns ' #fff')", async () => {
    const { inlineCssVariables } = await import("../dist/satsuma-viz.js");
    const out = inlineCssVariables("<rect fill=\"var(--sz-bg)\"/>", () => "  #0f1117  ");
    assert.equal(out, '<rect fill="#0f1117"/>');
  });

  it("leaves a reference intact when the token resolves to nothing", async () => {
    // An empty substitution would produce `fill=""` — invisible content with
    // no trace of why. Keeping the var() makes the gap inspectable.
    const { inlineCssVariables } = await import("../dist/satsuma-viz.js");
    const out = inlineCssVariables('<rect fill="var(--sz-unknown)"/>', () => "");
    assert.equal(out, '<rect fill="var(--sz-unknown)"/>');
  });
});
