/**
 * arrow-path.test.js — the CST decomposition of an arrow path into its anchor,
 * namespace and unquoted segments (arrow-path.ts).
 *
 * extractArrowRecords' end-to-end resolution of these paths is pinned in
 * arrow-records.test.js; this suite pins only what the rendered string cannot
 * show — the structure container resolution will consume (bsw-f9fq).
 */

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { initParser, getParser, arrowPathParts, allDescendants, child } from "@satsuma/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(__dirname, "../../tree-sitter-satsuma/tree-sitter-satsuma.wasm");

before(async () => {
  await initParser(WASM_PATH);
});

/** Parts of the source path of the first arrow in a one-arrow mapping body. */
function sourceParts(path) {
  const root = getParser().parse(`mapping m {\n  ${path} -> x\n}`).rootNode;
  const arrow = allDescendants(root, "map_arrow")[0];
  const src = child(arrow, "src_path");
  return arrowPathParts(src);
}

describe("arrowPathParts()", () => {
  it("keeps a quoted segment containing a dot as one segment", () => {
    // The rendered string `a.b.c` cannot tell this apart from three segments;
    // the parts can, which is what a dot-safe container resolver needs.
    assert.deepEqual(sourceParts("orders.`a.b`"), {
      anchor: { kind: "plain" },
      namespace: null,
      segments: ["orders", "a.b"],
    });
  });

  it("counts one parent level per ^. marker", () => {
    assert.deepEqual(sourceParts("^.^.`odd name`").anchor, { kind: "parent", levels: 2 });
  });

  it("separates the namespace from the schema and field segments", () => {
    assert.deepEqual(sourceParts("crm::orders.`odd name`"), {
      anchor: { kind: "plain" },
      namespace: "crm",
      segments: ["orders", "odd name"],
    });
  });
});

describe("arrowPathParts() — error recovery", () => {
  it("returns null for a path error recovery split with an ERROR node", () => {
    // Skipping the ERROR in `items[].id` would rebuild the declared path
    // `items.id`; the raw-text fallback keeps the malformed path unmatched.
    assert.equal(sourceParts("items[].id"), null);
  });
});
