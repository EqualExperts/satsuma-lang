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

// ---------------------------------------------------------------------------
// XML escaping of authored names (sl-6m5k)
//
// Backtick names legally contain & < > " ' (grammar backtick_name). The
// export used to interpolate node ids raw into <text> elements, so a schema
// named `P&L <quarterly>` produced a file no XML parser would open.
// ---------------------------------------------------------------------------

/**
 * Minimal strict XML well-formedness check: every open tag is closed in
 * order and no raw `<` or dangling `&` appears in text content. Node has no
 * DOMParser, so this stands in for "an XML parser accepts the file" — it
 * fails on exactly the breakage hostile names used to cause.
 */
function assertWellFormedXml(doc) {
  const body = doc.replace(/^<\?xml[^?]*\?>/, "");
  const stack = [];
  // Tags and text alternate; capture both so text segments can be vetted.
  const tagRe = /<(\/?)([A-Za-z][\w:-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>|([^<]+)/g;
  let m;
  while ((m = tagRe.exec(body)) !== null) {
    const [whole, closing, name, attrs, text] = m;
    if (text !== undefined) {
      assert.ok(!/&(?![A-Za-z]+;|#\d+;)/.test(text), `dangling & in text: ${JSON.stringify(text.trim())}`);
      continue;
    }
    assert.ok(name, `unparseable markup at: ${whole.slice(0, 40)}`);
    if (closing) {
      assert.equal(stack.pop(), name, `mismatched closing tag </${name}>`);
    } else if (!whole.endsWith("/>")) {
      stack.push(name);
    }
    assert.ok(!/[<]/.test(attrs), `raw < inside attributes of <${name}>`);
  }
  assert.deepEqual(stack, [], "all tags closed");
}

describe("buildExportSvg", () => {
  const hostileLayout = {
    width: 200,
    height: 100,
    nodes: new Map([
      ["P&L <quarterly>", { id: "P&L <quarterly>", x: 0, y: 0, width: 100, height: 40, ports: new Map() }],
    ]),
    edges: [],
    sourceBlocks: [],
  };

  it("produces well-formed XML when node ids contain & < > \" '", async () => {
    const { buildExportSvg } = await import("../dist/satsuma-viz.js");
    const out = buildExportSvg(hostileLayout, "");
    assertWellFormedXml(out);
  });

  it("escapes the authored name in the card label rather than dropping it", async () => {
    // Escaping must preserve the name's rendered form — an exported card
    // still has to read "P&L <quarterly>" when the SVG is opened.
    const { buildExportSvg } = await import("../dist/satsuma-viz.js");
    const out = buildExportSvg(hostileLayout, "");
    assert.ok(out.includes("P&amp;L &lt;quarterly&gt;"), "name must appear entity-escaped");
    assert.ok(!out.includes("P&L <quarterly>"), "raw form must not leak into markup");
  });

  it("sanity: the well-formedness checker rejects the pre-fix breakage", () => {
    // Guards the guard: if assertWellFormedXml accepted raw interpolation,
    // the two tests above would prove nothing.
    assert.throws(() => assertWellFormedXml('<svg><text>P&L <quarterly></text></svg>'));
  });
});

describe("escapeXml", () => {
  it("escapes all five XML-significant characters", async () => {
    const { escapeXml } = await import("../dist/satsuma-viz.js");
    assert.equal(escapeXml(`&<>"'`), "&amp;&lt;&gt;&quot;&apos;");
  });

  it("escapes & first so existing entities are not double-broken", async () => {
    const { escapeXml } = await import("../dist/satsuma-viz.js");
    assert.equal(escapeXml("&lt;"), "&amp;lt;");
  });
});
