/**
 * arrow-records.test.js — Authoritative tests for extractArrowRecords() against
 * real parsed Satsuma source.
 *
 * The grammar allows arrows to nest to arbitrary depth: nested_arrow bodies
 * hold further arrow declarations, and each/flatten bodies hold arrow
 * declarations plus nested each/flatten blocks (spec §4.4). These tests pin
 * the recursive extraction contract — every declared arrow is extracted no
 * matter how deeply it nests, with source/target paths made absolute by
 * accumulating the enclosing containers' paths (sl-zl55).
 */

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { initParser, getParser, extractArrowRecords, extractMappings } from "@satsuma/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(__dirname, "../../tree-sitter-satsuma/tree-sitter-satsuma.wasm");

before(async () => {
  await initParser(WASM_PATH);
});

/** Parse source and return the CST root. */
function rootOf(src) {
  return getParser().parse(src).rootNode;
}

/** Map records to a compact "sources -> target" form for path assertions. */
function pairs(records) {
  return records.map((r) => `${r.sources.join(",")} -> ${r.target}`);
}

const MAPPING_HEADER = "mapping m {\n  source { s }\n  target { t }\n";

describe("extractArrowRecords — nested arrow recursion (sl-zl55)", () => {
  it("extracts all three levels of a doubly-nested arrow with accumulated paths", () => {
    // Regression: the walk previously stopped one level down — `inner -> b`
    // and `leaf -> c` were invisible to lineage, coverage, and validation.
    const root = rootOf(`${MAPPING_HEADER}
  outer -> a {
    inner -> b {
      leaf -> c
    }
  }
}`);
    const records = extractArrowRecords(root);
    assert.deepEqual(pairs(records), [
      "outer -> a",
      "outer.inner -> a.b",
      "outer.inner.leaf -> a.b.c",
    ]);
  });

  it("extracts arrows inside an each block nested in another each block", () => {
    // Regression: each/flatten bodies were scanned for arrows but not for
    // nested each/flatten blocks, so the inner block and its arrows vanished.
    const root = rootOf(`${MAPPING_HEADER}
  each orders -> o {
    each items -> i {
      sku -> s
    }
  }
}`);
    const records = extractArrowRecords(root);
    assert.deepEqual(pairs(records), [
      "orders -> o",
      "orders.items -> o.i",
      "orders.items.sku -> o.i.s",
    ]);
  });

  it("extracts arrows from a nested arrow inside an each block", () => {
    // Mixed nesting: a nested_arrow child of an each block was extracted as a
    // record, but its own children were dropped because nested_arrow bodies
    // were never recursed into from the each-block branch.
    const root = rootOf(`${MAPPING_HEADER}
  each orders -> o {
    address -> addr {
      city -> town
    }
  }
}`);
    const records = extractArrowRecords(root);
    assert.deepEqual(pairs(records), [
      "orders -> o",
      "orders.address -> o.addr",
      "orders.address.city -> o.addr.town",
    ]);
  });

  it("extracts a flatten block nested inside an each block", () => {
    // flatten blocks share the each-block body rule, so they must recurse the
    // same way.
    const root = rootOf(`${MAPPING_HEADER}
  each orders -> o {
    flatten tags -> tag_rows {
      label -> name
    }
  }
}`);
    const records = extractArrowRecords(root);
    assert.deepEqual(pairs(records), [
      "orders -> o",
      "orders.tags -> o.tag_rows",
      "orders.tags.label -> o.tag_rows.name",
    ]);
  });

  it("agrees with extractMappings arrowCount for nested arrow declarations", () => {
    // extractMappings counts map/computed/nested arrows via a full-depth
    // descendant walk. For a mapping without each/flatten blocks the two
    // extraction functions must report the same arrows (the disagreement was
    // the original sl-zl55 symptom).
    const root = rootOf(`${MAPPING_HEADER}
  outer -> a {
    inner -> b {
      leaf -> c
      other -> d
    }
  }
}`);
    const records = extractArrowRecords(root);
    const [mapping] = extractMappings(root);
    assert.equal(records.length, mapping.arrowCount);
  });

  it("emits one container record per each/flatten block on top of declared arrows", () => {
    // each/flatten containers represent list-to-list arrows and are emitted as
    // records by design, but extractMappings.arrowCount counts only declared
    // map/computed/nested arrows. This pins the exact relationship so the two
    // functions cannot silently drift apart again.
    const root = rootOf(`${MAPPING_HEADER}
  each orders -> o {
    each items -> i {
      sku -> s
    }
  }
}`);
    const records = extractArrowRecords(root);
    const [mapping] = extractMappings(root);
    const EACH_FLATTEN_BLOCKS = 2;
    assert.equal(records.length, mapping.arrowCount + EACH_FLATTEN_BLOCKS);
  });
});
