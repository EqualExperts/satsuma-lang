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
import {
  initParser,
  getParser,
  extractArrowRecords,
  extractMappings,
  qualifyChildArrowPath,
} from "@satsuma/core";

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

// ── The qualification rule on its own (3cdd-yavi) ────────────────────────────
//
// The prefixing above is now an exported function, because the viz has to apply
// the identical rule to the paths *its* model stores. These cases pin the two
// boundaries a caller outside extraction can hit and the CST path cannot,
// since the parser never hands extraction a container with no path.

describe("qualifyChildArrowPath()", () => {
  it("strips the relativity marker at mapping-body level, where the frame is the schema root", () => {
    // Reversed by tced-ewd4. This used to assert ".orders" came back untouched,
    // on the reasoning that a top-level dot is a typo best left matching
    // nothing. Spec §4.6 says the opposite — "a leading `.` documents the
    // relativity, but it does not decide it" — and `arrows`, `graph` and
    // `field-lineage` all resolved it already, leaving coverage the only
    // consumer that disagreed about the same arrow's identity.
    assert.equal(qualifyChildArrowPath(".orders", null), "orders");
    assert.equal(qualifyChildArrowPath("orders.id", null), "orders.id");
  });

  it("leaves an empty path empty rather than producing a dangling dot", () => {
    // A malformed block can reach a consumer with no path on one side; joining
    // it would yield "parcels." — a path that matches nothing but looks like a
    // real one in any output that prints it.
    assert.equal(qualifyChildArrowPath("", "parcels"), "");
  });

  it("prefixes with or without the authored dot, since the container is the only frame", () => {
    // `each lines -> .lines` in examples/nested-iteration/pipeline.stm writes
    // one side dotted and the other not; both mean the same thing.
    assert.equal(qualifyChildArrowPath(".sku", "parcels"), "parcels.sku");
    assert.equal(qualifyChildArrowPath("sku", "parcels"), "parcels.sku");
  });

  // ── ADR-053 ancestor escape paths ──────────────────────────────────────────
  // An escaped path resolves to the absolute path an outside-the-block arrow
  // would have written, so the arrow is visible to coverage, lineage and
  // validation instead of vanishing into a `note`.

  it("resolves a parent escape by popping one container level", () => {
    assert.equal(
      qualifyChildArrowPath("^.transect_ref", "transects.sightings"),
      "transects.transect_ref",
    );
  });

  it("resolves a repeated parent escape by popping one level per ^.", () => {
    assert.equal(
      qualifyChildArrowPath("^.^.survey_id", "transects.sightings.rings"),
      "transects.survey_id",
    );
  });

  it("resolves a root escape absolute from the schema root", () => {
    assert.equal(qualifyChildArrowPath("$.survey_id", "transects.sightings"), "survey_id");
  });

  it("resolves a parent escape on the target side against the target container", () => {
    // The escape applies to both sides of the arrow; the target pops against
    // the target container, not the source.
    assert.equal(qualifyChildArrowPath("^.ref", "transects"), "ref");
    assert.equal(qualifyChildArrowPath("^.ref", "report.transects"), "report.ref");
  });
});

describe("extractArrowRecords — ADR-053 ancestor escape paths", () => {
  // End-to-end through the full extraction walk: the escape resolves on both
  // sides against the accumulating container prefixes, so the resolved path the
  // arrow record carries is exactly what a sibling outside-the-block arrow
  // would have produced.

  it("resolves a parent-to-child-element arrow inside a nested each", () => {
    // The motivating case: the parent transect's ref populates a field on each
    // sighting element. Without the escape this was a `note` plus an
    // `field-not-in-schema` warning; with it the arrow resolves to a declared
    // field and flows through coverage and lineage.
    const root = rootOf(`${MAPPING_HEADER}
  each transects -> transects {
    each sightings -> .counts {
      ^.transect_ref -> .parent_ref
      .species_code -> .species
    }
  }
}`);
    const records = extractArrowRecords(root);
    assert.deepEqual(pairs(records), [
      "transects -> transects",
      "transects.sightings -> transects.counts",
      "transects.transect_ref -> transects.counts.parent_ref",
      "transects.sightings.species_code -> transects.counts.species",
    ]);
  });

  it("resolves a root escape from a deeply nested block", () => {
    const root = rootOf(`${MAPPING_HEADER}
  each transects -> transects {
    each sightings -> .counts {
      each rings -> .rings {
        $.survey_id -> .survey_id
      }
    }
  }
}`);
    const records = extractArrowRecords(root);
    const deepest = records.find((r) => r.target === "transects.counts.rings.survey_id");
    assert.equal(deepest?.sources.join(","), "survey_id");
  });

  it("resolves a parent escape on both sides of the arrow, each against its own container", () => {
    // The escape pops against the side it is written on: the source against the
    // source container, the target against the target container, so the two can
    // reach different ancestors.
    const root = rootOf(`${MAPPING_HEADER}
  each transects -> report_transects {
    each sightings -> .counts {
      ^.survey_id -> ^.survey_id
    }
  }
}`);
    const records = extractArrowRecords(root);
    const escaped = records.find(
      (r) => r.sources[0] === "transects.survey_id" && r.target === "report_transects.survey_id",
    );
    assert.ok(escaped, "the parent escape resolves against each side's own container");
  });
});
