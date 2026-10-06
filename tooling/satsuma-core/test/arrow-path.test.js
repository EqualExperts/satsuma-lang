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
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  initParser,
  getParser,
  arrowPathParts,
  allDescendants,
  child,
  children,
  extractArrowRecords,
  resolveArrowPathInPlace,
  resolvedSegmentsThrough,
} from "@satsuma/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(__dirname, "../../tree-sitter-satsuma/tree-sitter-satsuma.wasm");
const EXAMPLES_DIR = resolve(__dirname, "../../../examples");

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

// ── resolveArrowPathInPlace() ────────────────────────────────────────────────

/**
 * A mapping with one `each` block whose body holds `bodyArrow`, nested in a
 * flatten when `flatten` is given. Returns the parsed root.
 */
function parseInEach(bodyArrow, { flatten = null } = {}) {
  const body = flatten
    ? `each orders -> rows {\n    flatten ${flatten} -> lines {\n      ${bodyArrow}\n    }\n  }`
    : `each orders -> rows {\n    ${bodyArrow}\n  }`;
  return getParser().parse(`mapping m {\n  source { src }\n  target { tgt }\n  ${body}\n}`)
    .rootNode;
}

/** The src_path and tgt_path of the innermost map_arrow in `root`. */
function innermostArrowPaths(root) {
  const arrows = allDescendants(root, "map_arrow");
  const arrow = arrows[arrows.length - 1];
  return { src: child(arrow, "src_path"), tgt: child(arrow, "tgt_path") };
}

describe("resolveArrowPathInPlace()", () => {
  it("prefixes a relative path with its each block's header on the same side", () => {
    // bsw-89wr: an editor starting from `.id` must reach `orders.id` /
    // `rows.id`, not the top-level `id` a by-name lookup finds.
    const { src, tgt } = innermostArrowPaths(parseInEach(".id -> .id"));
    assert.deepEqual(resolveArrowPathInPlace(src).resolved.segments, ["orders", "id"]);
    assert.deepEqual(resolveArrowPathInPlace(tgt).resolved.segments, ["rows", "id"]);
  });

  it("pops one container level per ^. through nested containers, unquoting the segment", () => {
    // Two levels deep (each orders → flatten lines), `^.^.` returns to the
    // schema root, and the backtick segment arrives unquoted.
    const { src } = innermostArrowPaths(
      parseInEach("^.^.`tr ref` -> .note", { flatten: ".lines" }),
    );
    assert.deepEqual(resolveArrowPathInPlace(src).resolved.segments, ["tr ref"]);
  });

  it("aligns the authored segment nodes with the tail of the resolved segments", () => {
    // resolvedSegmentsThrough relies on this: the cursor on `a` in `.a.b`
    // inside `each orders` names `orders.a`, and on `b` names `orders.a.b`.
    const { src } = innermostArrowPaths(parseInEach(".a.b -> .x"));
    const inPlace = resolveArrowPathInPlace(src);
    const [a, b] = inPlace.segmentNodes;
    assert.deepEqual(resolvedSegmentsThrough(inPlace, a), ["orders", "a"]);
    assert.deepEqual(resolvedSegmentsThrough(inPlace, b), ["orders", "a", "b"]);
  });

  it("returns the whole resolved path when the node is not one of the path's segments", () => {
    // The cursor can sit on a `^.` marker; the path then means its full field.
    const { src } = innermostArrowPaths(parseInEach("^.code -> .x"));
    const inPlace = resolveArrowPathInPlace(src);
    assert.deepEqual(resolvedSegmentsThrough(inPlace, src), ["code"]);
  });
});

describe("resolveArrowPathInPlace() agrees with extractArrowRecords() on the example corpus", () => {
  // Extraction resolves top-down while walking a mapping; the in-place
  // resolver walks up from one path. Two implementations of one rule drift
  // unless something compares them, so every arrow in every example must get
  // the same absolute sources and target from both.
  const ARROW_NODE_TYPES = [
    "map_arrow",
    "computed_arrow",
    "nested_arrow",
    "each_block",
    "flatten_block",
  ];
  const stmFiles = readdirSync(EXAMPLES_DIR, { recursive: true }).filter((f) => f.endsWith(".stm"));

  for (const file of stmFiles) {
    it(`examples/${file}`, () => {
      const root = getParser().parse(readFileSync(join(EXAMPLES_DIR, file), "utf8")).rootNode;
      const byPosition = new Map(
        extractArrowRecords(root).map((r) => [`${r.line}:${r.startColumn}`, r]),
      );
      const arrows = ARROW_NODE_TYPES.flatMap((type) => allDescendants(root, type));
      for (const arrow of arrows) {
        const record = byPosition.get(`${arrow.startPosition.row}:${arrow.startPosition.column}`);
        if (!record) continue; // outside a mapping body (none expected, but not this test's claim)
        const sources = children(arrow, "src_path")
          .map((n) => resolveArrowPathInPlace(n)?.resolved.text)
          .filter((t) => t !== undefined);
        const target = resolveArrowPathInPlace(child(arrow, "tgt_path"))?.resolved.text ?? null;
        const where = `line ${arrow.startPosition.row + 1}`;
        assert.deepEqual(sources, record.sources, `sources at ${where}`);
        assert.equal(target, record.target, `target at ${where}`);
      }
    });
  }
});
