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

describe("extractArrowRecords — authored paths and container on nested arrows (sl-i9ve)", () => {
  it("records the container and the paths as written, alongside the resolved ones", () => {
    // Validation needs what the author typed to explain a failed path; the
    // resolved `sources` alone cannot say which part the container added.
    const root = rootOf(`${MAPPING_HEADER}
  flatten Order.LineItems -> t {
    Order.OrderId -> .order_id
  }
}`);
    const child = extractArrowRecords(root).find((r) => r.kind === "map");
    assert.deepEqual(child.sources, ["Order.LineItems.Order.OrderId"]);
    assert.deepEqual(child.nesting, {
      containerKind: "flatten",
      sourceContainer: "Order.LineItems",
      targetContainer: "t",
      sourceContainerSegments: ["Order", "LineItems"],
      targetContainerSegments: ["t"],
      authoredSources: ["Order.OrderId"],
      authoredTarget: ".order_id",
    });
  });

  it("records the innermost container for an arrow two blocks deep", () => {
    // The hint must name the block the arrow is actually written in.
    const root = rootOf(`${MAPPING_HEADER}
  each a -> x {
    each b -> .y {
      .c -> .z
    }
  }
}`);
    const leaf = extractArrowRecords(root).find((r) => r.kind === "map");
    assert.equal(leaf.nesting.containerKind, "each");
    assert.equal(leaf.nesting.sourceContainer, "a.b");
  });

  it("leaves mapping-body arrows without nesting", () => {
    // No container means nothing was prefixed and nothing needs explaining.
    const root = rootOf(`${MAPPING_HEADER}  a -> b\n}`);
    assert.equal(extractArrowRecords(root)[0].nesting, undefined);
  });
});

describe("extractArrowRecords — backtick segments anywhere in a path (bsw-f9fq)", () => {
  // A quoted segment names the same field as its declaration (`` `odd name` ``
  // declares `odd name`), so the resolved path must carry it unquoted wherever
  // it sits. Before bsw-f9fq only a path whose *first* segment was quoted lost
  // its backticks — and then only the outermost pair — so every case below
  // reached validation and coverage as a field no declaration matched.

  it("unquotes a backtick segment after a plain first segment", () => {
    const root = rootOf(`${MAPPING_HEADER}  orders.\`odd name\` -> x\n}`);
    assert.deepEqual(pairs(extractArrowRecords(root)), ["orders.odd name -> x"]);
  });

  it("unquotes every segment of a path made only of backtick segments", () => {
    // The old whole-path slice(1, -1) turned this into "my orders`.`odd name".
    const root = rootOf(`${MAPPING_HEADER}  \`my orders\`.\`odd name\` -> x\n}`);
    assert.deepEqual(pairs(extractArrowRecords(root)), ["my orders.odd name -> x"]);
  });

  it("unquotes a relative backtick segment and prefixes the each container", () => {
    const root = rootOf(`${MAPPING_HEADER}
  each orders -> rows {
    .\`odd name\` -> .\`odd y\`
  }
}`);
    assert.deepEqual(pairs(extractArrowRecords(root)), [
      "orders -> rows",
      "orders.odd name -> rows.odd y",
    ]);
  });

  it("unquotes a root-escaped backtick segment and ignores the container", () => {
    const root = rootOf(`${MAPPING_HEADER}
  each orders -> rows {
    $.\`long name\` -> .c
  }
}`);
    const leaf = extractArrowRecords(root).find((r) => r.target === "rows.c");
    assert.deepEqual(leaf?.sources, ["long name"]);
  });

  it("unquotes a parent-escaped backtick segment after popping one level", () => {
    const root = rootOf(`${MAPPING_HEADER}
  each orders -> rows {
    each lines -> .items {
      ^.\`odd name\` -> .y
    }
  }
}`);
    const leaf = extractArrowRecords(root).find((r) => r.target === "rows.items.y");
    assert.deepEqual(leaf?.sources, ["orders.odd name"]);
  });

  it("keeps a backtick field segment on a namespaced path instead of dropping it", () => {
    // The namespaced branch used to keep identifier children only, so the
    // quoted field vanished and the arrow pointed at the schema itself.
    const root = rootOf(`${MAPPING_HEADER}  crm::orders.\`odd name\` -> x\n}`);
    assert.deepEqual(pairs(extractArrowRecords(root)), ["crm::orders.odd name -> x"]);
  });
});

describe("extractArrowRecords — a container named by a dotted backtick segment (bsw-2yzd)", () => {
  // `` `line.items` `` is one field whose name contains a dot. Its children
  // resolve against it as one container level, so ^. must pop the whole name.
  const SRC = `${MAPPING_HEADER}
  each \`line.items\` -> rows {
    .v -> .x
    ^.sid -> .y
  }
}`;

  it("pops the whole dotted segment for ^., reaching the schema root", () => {
    const records = extractArrowRecords(rootOf(SRC));
    const escaped = records.find((r) => r.target === "rows.y");
    assert.deepEqual(escaped?.sources, ["sid"]);
  });

  it("still prefixes a relative child with the whole container name", () => {
    const records = extractArrowRecords(rootOf(SRC));
    assert.deepEqual(records.find((r) => r.target === "rows.x")?.sources, ["line.items.v"]);
  });

  it("records the container as segments so validation can count its levels", () => {
    const leaf = extractArrowRecords(rootOf(SRC)).find((r) => r.target === "rows.y");
    assert.deepEqual(leaf?.nesting?.sourceContainerSegments, ["line.items"]);
    assert.deepEqual(leaf?.nesting?.targetContainerSegments, ["rows"]);
  });
});

describe("extractArrowRecords — a namespaced container with a dotted backtick segment (bsw-2yzd)", () => {
  // The namespaced form must keep `line.items` one level too: the namespace
  // qualifier rides on the schema segment, never splitting the field name.
  const SRC = `namespace a { schema src { sid STRING  \`line.items\` list_of record { v STRING } } }
schema src2 { k STRING }
schema tgt { rows list_of record { x STRING  y STRING } }
mapping m {
  source { a::src, src2 }
  target { tgt }
  each a::src.\`line.items\` -> rows {
    .v -> .x
    ^.sid -> .y
  }
}`;

  it("pops the whole dotted segment for ^., reaching the namespaced schema root", () => {
    const records = extractArrowRecords(rootOf(SRC));
    assert.deepEqual(records.find((r) => r.target === "rows.y")?.sources, ["a::src.sid"]);
  });

  it("records the container as namespaced-schema plus whole-field segments", () => {
    const leaf = extractArrowRecords(rootOf(SRC)).find((r) => r.target === "rows.y");
    assert.deepEqual(leaf?.nesting?.sourceContainerSegments, ["a::src", "line.items"]);
  });
});
