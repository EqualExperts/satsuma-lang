/**
 * ground-truth.test.js — the oracle's own tests.
 *
 * Every lineage property in this repository asserts against `ground-truth.js`.
 * An oracle that is quietly wrong does not fail: it *weakens*, and the properties
 * built on it keep passing while defending less than they claim to. So the oracle
 * gets hand-written cases of its own, small enough to read in full and check by
 * eye against the Satsuma the same scenario renders to.
 *
 * These are deliberately not property tests. A property over the oracle could only
 * compare it against another traversal of the same data — which is the circularity
 * the oracle exists to avoid.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scalarField } from "../src/model.js";
import {
  computedArrow,
  eachBlock,
  endpoint,
  mapArrow,
  mappingDecl,
  nlTransform,
  scenarioFile,
  scenarioWorkspace,
  schemaDecl,
} from "../src/workspace-model.js";
import { renderWorkspace } from "../src/workspace-render.js";
import {
  USAGE_KIND,
  scenarioAncestorsWithin,
  scenarioChangedDeclarations,
  scenarioDeclaredEntities,
  scenarioDeclaredFieldPaths,
  scenarioDeclaredUsageSites,
  scenarioDescendantsWithin,
  scenarioEntityKeyForRef,
  scenarioFieldEdges,
  scenarioSchemaEdges,
  scenarioSchemaProjection,
} from "../src/ground-truth.js";
import { listRecordField } from "../src/model.js";

/** Compact `from -> to (classification)` form, so a failure is readable. */
function shown(edges) {
  return edges.map((edge) => `${edge.from} -> ${edge.to} (${edge.classification})`).sort();
}

/** A one-file workspace, the shape most of these cases need. */
function oneFile({ fragments = [], schemas, mappings }) {
  return scenarioWorkspace([scenarioFile({ path: "entry.stm", fragments, schemas, mappings })]);
}

describe("scenarioDeclaredFieldPaths", () => {
  it("includes container paths as well as leaves", () => {
    // An arrow may legitimately name a container — `each orders -> shipments`
    // names two. An endpoint-existence check built on leaves alone would report
    // every container-header edge as an invented endpoint.
    const workspace = oneFile({
      schemas: [
        schemaDecl({
          name: "s0",
          fields: [listRecordField("lines", [scalarField("sku")])],
        }),
      ],
      mappings: [],
    });
    assert.deepEqual(scenarioDeclaredFieldPaths(workspace), ["::s0.lines", "::s0.lines.sku"]);
  });

  it("includes fields a schema only gets from a spread fragment", () => {
    // A spread field is declared by the fragment, not the schema body. Reading the
    // body alone would call a perfectly valid endpoint invented.
    const workspace = oneFile({
      fragments: [{ name: "audit", fields: [scalarField("loaded_at")] }],
      schemas: [schemaDecl({ name: "s0", fields: [scalarField("id")], spreads: ["audit"] })],
      mappings: [],
    });
    assert.deepEqual(scenarioDeclaredFieldPaths(workspace), ["::s0.id", "::s0.loaded_at"]);
  });

  it("lets a body declaration shadow a spread field rather than duplicating it", () => {
    // ADR-041. The same name reached through both routes is one declared path, not
    // two — a duplicate here would make an exactly-once edge property unfalsifiable.
    const workspace = oneFile({
      fragments: [{ name: "audit", fields: [scalarField("id")] }],
      schemas: [schemaDecl({ name: "s0", fields: [scalarField("id")], spreads: ["audit"] })],
      mappings: [],
    });
    assert.deepEqual(scenarioDeclaredFieldPaths(workspace), ["::s0.id"]);
  });

  it("qualifies a namespaced schema's paths with its namespace", () => {
    // `ns::schema.field`, not `::schema.field`: the canonical key of a namespaced
    // entity keeps its namespace, and comparing the two forms is how a namespace
    // branch bug hides.
    const workspace = oneFile({
      schemas: [schemaDecl({ name: "s0", namespace: "ns_a", fields: [scalarField("id")] })],
      mappings: [],
    });
    assert.deepEqual(scenarioDeclaredFieldPaths(workspace), ["ns_a::s0.id"]);
  });
});

describe("scenarioFieldEdges", () => {
  it("declares one edge per source for a multi-source arrow", () => {
    // Spec §4.2: `a, b -> t` is two edges to the same target, not one edge with
    // two sources. A consumer that emitted one would lose half the lineage.
    const workspace = oneFile({
      schemas: ["s0", "s1", "t"].map((name) => schemaDecl({ name, fields: [scalarField("id")] })),
      mappings: [
        mappingDecl({
          name: "m0",
          sources: ["s0", "s1"],
          targets: ["t"],
          arrows: [mapArrow([endpoint("s0", "id"), endpoint("s1", "id")], endpoint("t", "id"))],
        }),
      ],
    });
    assert.deepEqual(shown(scenarioFieldEdges(workspace)), [
      "::s0.id -> ::t.id (none)",
      "::s1.id -> ::t.id (none)",
    ]);
  });

  it("counts a container header as an edge in its own right", () => {
    // An `each` header names a source and a target, so it is an arrow record like
    // any other. Treating it as mere syntax loses the container-to-container edge
    // — which is the one a graph draws between two list fields.
    const workspace = oneFile({
      schemas: ["s0", "s1"].map((name) =>
        schemaDecl({ name, fields: [listRecordField("lines", [scalarField("sku")])] }),
      ),
      mappings: [
        mappingDecl({
          name: "m0",
          sources: ["s0"],
          targets: ["s1"],
          arrows: [
            eachBlock(endpoint("s0", "lines"), endpoint("s1", "lines"), [
              mapArrow([endpoint("s0", "lines.sku")], endpoint("s1", "lines.sku")),
            ]),
          ],
        }),
      ],
    });
    assert.deepEqual(shown(scenarioFieldEdges(workspace)), [
      "::s0.lines -> ::s1.lines (none)",
      "::s0.lines.sku -> ::s1.lines.sku (none)",
    ]);
  });

  it("gives a computed arrow a null source", () => {
    // A sourceless arrow still populates its target. A consumer that dropped it
    // would lose the target field from the graph entirely.
    const workspace = oneFile({
      schemas: [schemaDecl({ name: "t", fields: [scalarField("stamp")] })],
      mappings: [
        mappingDecl({
          name: "m0",
          sources: [],
          targets: ["t"],
          arrows: [computedArrow(endpoint("t", "stamp"), nlTransform("Load time."))],
        }),
      ],
    });
    assert.deepEqual(shown(scenarioFieldEdges(workspace)), ["null -> ::t.stamp (nl)"]);
  });

  it("adds an nl-derived edge for each @ref an arrow body mentions", () => {
    // The implicit tier: `@s0.other` inside a transform states that `other` also
    // feeds this target. It is a distinct classification because it is a weaker
    // claim than a declared arrow, and it is the tier that once manufactured
    // phantom edges (cbh-y5og).
    const workspace = oneFile({
      schemas: ["s0", "t"].map((name) =>
        schemaDecl({ name, fields: [scalarField("id"), scalarField("other")] }),
      ),
      mappings: [
        mappingDecl({
          name: "m0",
          sources: ["s0"],
          targets: ["t"],
          arrows: [
            mapArrow(
              [endpoint("s0", "id")],
              endpoint("t", "id"),
              nlTransform("Combine.", [endpoint("s0", "other")]),
            ),
          ],
        }),
      ],
    });
    assert.deepEqual(shown(scenarioFieldEdges(workspace)), [
      "::s0.id -> ::t.id (nl)",
      "::s0.other -> ::t.id (nl-derived)",
    ]);
  });
});

describe("scenarioSchemaEdges", () => {
  it("derives source and target roles from the declared lists, not from arrows", () => {
    // A mapping with no arrows still connects its schemas. Deriving topology from
    // arrows alone would make a declared-but-unmapped hop vanish from the graph.
    const workspace = oneFile({
      schemas: ["s0", "t"].map((name) => schemaDecl({ name, fields: [scalarField("id")] })),
      mappings: [mappingDecl({ name: "m0", sources: ["s0"], targets: ["t"], arrows: [] })],
    });
    assert.deepEqual(scenarioSchemaEdges(workspace), [
      { from: "::s0", to: "::m0", role: "source" },
      { from: "::m0", to: "::t", role: "target" },
    ]);
  });

  it("derives metric_source from the metric's own metadata token", () => {
    // A separate mechanism from mappings, and therefore a separate role: a metric
    // names its provenance in its declaration, with no arrow involved.
    const workspace = oneFile({
      schemas: [
        schemaDecl({ name: "fact", fields: [scalarField("amount")] }),
        schemaDecl({
          name: "mrr",
          fields: [scalarField("value")],
          metric: true,
          metricSources: ["fact"],
        }),
      ],
      mappings: [],
    });
    assert.deepEqual(scenarioSchemaEdges(workspace), [
      { from: "::fact", to: "::mrr", role: "metric_source" },
    ]);
  });
});

describe("scenarioSchemaProjection", () => {
  it("reads the owning schema off a namespaced endpoint without splitting on the first dot", () => {
    // `warehouse::staged.field_0` owns `warehouse::staged`. Splitting on the first
    // `.` happens to work for a file-scope key and is wrong the moment a namespace
    // is involved — which is the ad-hoc unbranding R6 replaces.
    const edges = [
      { from: "warehouse::staged.field_0", to: "::mart.field_0" },
      { from: null, to: "::mart.stamp" },
      { from: "::mart.a", to: "::mart.b" },
    ];
    assert.deepEqual(scenarioSchemaProjection(edges), ["warehouse::staged->::mart"]);
  });
});

describe("reachability", () => {
  /** `a → b → c → d`, one field each: the smallest graph with an interior node. */
  const chain = [
    { from: "::a.f", to: "::b.f", classification: "none" },
    { from: "::b.f", to: "::c.f", classification: "none" },
    { from: "::c.f", to: "::d.f", classification: "none" },
  ];

  it("records each reachable field's shortest hop count, not its first arrival", () => {
    // sl-y89y stated positively. A traversal that expands a node once at whatever
    // depth it first arrived can truncate the subtree below it when a shorter path
    // arrives later with budget remaining. Distances are what make depth
    // *exactness* assertable, where monotonicity alone would have passed the bug.
    const downstream = scenarioDescendantsWithin(chain, "::a.f", 3);
    assert.deepEqual([...downstream.entries()].sort(), [
      ["::b.f", 1],
      ["::c.f", 2],
      ["::d.f", 3],
    ]);
  });

  it("stops exactly at the depth limit", () => {
    // `--depth n` means n hops. Off by one here and every depth property is
    // asserting the wrong thing while looking healthy.
    assert.deepEqual([...scenarioDescendantsWithin(chain, "::a.f", 1).keys()], ["::b.f"]);
    assert.deepEqual([...scenarioDescendantsWithin(chain, "::a.f", 2).keys()].sort(), [
      "::b.f",
      "::c.f",
    ]);
  });

  it("returns every branch of a diamond, not one path through it", () => {
    // sg-pufq: `lineage --to` once returned a single upstream chain. Both branches
    // of a diamond are at the same distance, so a single-predecessor walk produces
    // an answer that looks entirely plausible.
    const diamond = [
      { from: "::a.f", to: "::left.f" },
      { from: "::a.f", to: "::right.f" },
      { from: "::left.f", to: "::sink.f" },
      { from: "::right.f", to: "::sink.f" },
    ];
    const upstream = scenarioAncestorsWithin(diamond, "::sink.f", 2);
    assert.deepEqual([...upstream.entries()].sort(), [
      ["::a.f", 2],
      ["::left.f", 1],
      ["::right.f", 1],
    ]);
  });

  it("terminates on a cycle and reports each field once", () => {
    // A loop is reachable from itself. The start field is excluded from its own
    // result set, and no field appears twice however large the depth budget is.
    const cycle = [
      { from: "::a.f", to: "::b.f" },
      { from: "::b.f", to: "::a.f" },
    ];
    assert.deepEqual([...scenarioDescendantsWithin(cycle, "::a.f", 99).keys()], ["::b.f"]);
  });

  it("contributes no upstream hop for a computed arrow's null source", () => {
    // There is no field to walk from. Treating null as a node would put a
    // synthetic entry in every upstream answer for a computed target.
    const edges = [{ from: null, to: "::t.stamp" }];
    assert.deepEqual([...scenarioAncestorsWithin(edges, "::t.stamp", 5).keys()], []);
  });
});

describe("renderWorkspace guards against unrenderable scenarios", () => {
  it("refuses a child arrow that reaches outside its container block", () => {
    // Satsuma has no notation for reaching an ancestor from inside a block
    // (spec §4.4), so such an arrow cannot be spelled. Rendering it anyway would
    // silently produce a path resolving to a field nobody declared, and the
    // resulting property failure would be blamed on the toolchain.
    const workspace = oneFile({
      schemas: ["s0", "s1"].map((name) =>
        schemaDecl({
          name,
          fields: [listRecordField("lines", [scalarField("sku")]), scalarField("top")],
        }),
      ),
      mappings: [
        mappingDecl({
          name: "m0",
          sources: ["s0"],
          targets: ["s1"],
          arrows: [
            eachBlock(endpoint("s0", "lines"), endpoint("s1", "lines"), [
              mapArrow([endpoint("s0", "top")], endpoint("s1", "lines.sku")),
            ]),
          ],
        }),
      ],
    });
    assert.throws(() => renderWorkspace(workspace), /not under block path 'lines'/);
  });
});

// ── Declared entities and usage sites (gpt-l9rp) ───────────────────────────

/** Compact `kind@file` form, sorted, so a failure names the site that moved. */
function sitesOf(usageSites, key) {
  return usageSites
    .get(key)
    .map((site) => `${site.kind}@${site.file}`)
    .sort();
}

describe("scenarioDeclaredEntities", () => {
  it("keys a namespaced declaration by ns::name while keeping the authored label", () => {
    // The distinction the LSP's reference queries turn on: the index files a
    // namespaced schema under `ns_a::s0`, but the text at the declaration site
    // reads `schema s0`. An oracle that conflated the two would make a query for
    // the wrong key look like a missing reference.
    const workspace = oneFile({
      schemas: [schemaDecl({ name: "s0", namespace: "ns_a", fields: [scalarField("f")] })],
      mappings: [],
    });

    assert.deepEqual(scenarioDeclaredEntities(workspace), [
      { key: "ns_a::s0", name: "s0", namespace: "ns_a", keyword: "schema", file: "entry.stm" },
    ]);
  });

  it("declares mappings, which nothing may reference", () => {
    // Included on purpose: "this entity has no usage sites" is the assertion that
    // catches an invented reference, and it needs the entity to be listed.
    const workspace = oneFile({
      schemas: [
        schemaDecl({ name: "s0", fields: [scalarField("f")] }),
        schemaDecl({ name: "s1", fields: [scalarField("f")] }),
      ],
      mappings: [mappingDecl({ name: "m0", sources: ["s0"], targets: ["s1"], arrows: [] })],
    });

    const usageSites = scenarioDeclaredUsageSites(workspace);
    assert.deepEqual(usageSites.get("m0"), []);
  });
});

describe("scenarioDeclaredUsageSites", () => {
  it("records the same entity twice when two mappings both name it", () => {
    // Sites are a multiset. Collapsing them to a set would hide a reference the
    // toolchain dropped whenever some other mapping happened to name it too.
    const schemas = ["s0", "s1", "s2"].map((name) =>
      schemaDecl({ name, fields: [scalarField("f")] }),
    );
    const workspace = oneFile({
      schemas,
      mappings: [
        mappingDecl({ name: "m0", sources: ["s0"], targets: ["s1"], arrows: [] }),
        mappingDecl({ name: "m1", sources: ["s0"], targets: ["s2"], arrows: [] }),
      ],
    });

    assert.deepEqual(sitesOf(scenarioDeclaredUsageSites(workspace), "s0"), [
      "source@entry.stm",
      "source@entry.stm",
    ]);
  });

  it("counts the schema prefix of a qualified arrow path, but not a bare one", () => {
    // The renderer writes an endpoint bare when its side of the mapping declares
    // exactly that one schema, and `schema.path` when the side has several. Only
    // the second spelling puts the schema name in the text, and only that one is
    // a site a rename has to rewrite.
    const schemas = ["s0", "s1", "s2"].map((name) =>
      schemaDecl({ name, fields: [scalarField("f")] }),
    );
    const workspace = oneFile({
      schemas,
      mappings: [
        mappingDecl({
          name: "m0",
          // Two source schemas, so both source endpoints are written qualified;
          // the single target is written bare.
          sources: ["s0", "s1"],
          targets: ["s2"],
          arrows: [mapArrow([endpoint("s0", "f"), endpoint("s1", "f")], endpoint("s2", "f"))],
        }),
      ],
    });

    const usageSites = scenarioDeclaredUsageSites(workspace);
    assert.deepEqual(sitesOf(usageSites, "s0"), ["arrow@entry.stm", "source@entry.stm"]);
    assert.deepEqual(sitesOf(usageSites, "s2"), ["target@entry.stm"]);
  });

  it("counts the schema an NL @ref mentions, even though the ref names one of its fields (gpt-fjo7)", () => {
    // `@s0.other` is textually a reference to the field `s0.other`, but the
    // workspace index files it under the schema key too, specifically so a
    // rename of `s0` reaches it. The oracle must agree, or the rename
    // round-trip property (which asks the oracle, not the toolchain, what a
    // rename should touch) would expect less than the fix actually does.
    const schemas = ["s0", "s1"].map((name) =>
      schemaDecl({ name, fields: [scalarField("id"), scalarField("other")] }),
    );
    const workspace = oneFile({
      schemas,
      mappings: [
        mappingDecl({
          name: "m0",
          sources: ["s0"],
          targets: ["s1"],
          arrows: [
            mapArrow(
              [endpoint("s0", "id")],
              endpoint("s1", "id"),
              nlTransform("Combine.", [endpoint("s0", "other")]),
            ),
          ],
        }),
      ],
    });

    assert.deepEqual(sitesOf(scenarioDeclaredUsageSites(workspace), "s0"), [
      "nl@entry.stm",
      "source@entry.stm",
    ]);
  });

  it("counts the import statement the renderer derives for a cross-file reference", () => {
    // A scenario never authors its imports — `workspace-render.js` derives them
    // from usage — but an imported name is a reference site, and most of what the
    // multi-file domain exists to exercise. This is the one rule the oracle
    // restates from the renderer, so it needs its own case.
    const workspace = scenarioWorkspace([
      scenarioFile({
        path: "entry.stm",
        schemas: [schemaDecl({ name: "s1", fields: [scalarField("f")] })],
        mappings: [mappingDecl({ name: "m0", sources: ["s0"], targets: ["s1"], arrows: [] })],
      }),
      scenarioFile({
        path: "part1.stm",
        schemas: [schemaDecl({ name: "s0", fields: [scalarField("f")] })],
        mappings: [],
      }),
    ]);

    assert.deepEqual(sitesOf(scenarioDeclaredUsageSites(workspace), "s0"), [
      "import@entry.stm",
      "source@entry.stm",
    ]);
  });

  it("omits the import site for a reference the scenario deliberately withholds", () => {
    // `withheldImports` is the renderer's one hole in the derivation, and it is
    // how R1's `withhold-spread-import` mutator reaches ADR-022's import-scope
    // check. Honouring it keeps the defect reported as the missing *import
    // statement* it is, rather than as a find-references failure against a site
    // the file never wrote.
    const workspace = scenarioWorkspace([
      scenarioFile({
        path: "entry.stm",
        schemas: [schemaDecl({ name: "s1", fields: [scalarField("f")] })],
        mappings: [mappingDecl({ name: "m0", sources: ["s0"], targets: ["s1"], arrows: [] })],
        withheldImports: ["s0"],
      }),
      scenarioFile({
        path: "part1.stm",
        schemas: [schemaDecl({ name: "s0", fields: [scalarField("f")] })],
        mappings: [],
      }),
    ]);

    assert.deepEqual(sitesOf(scenarioDeclaredUsageSites(workspace), "s0"), ["source@entry.stm"]);
  });

  it("refuses a scenario that references an entity it never declares", () => {
    // A malformed scenario, not a toolchain failure. Failing loudly beats
    // silently dropping the site and letting a property read the gap as a
    // missing reference.
    const workspace = oneFile({
      schemas: [schemaDecl({ name: "s1", fields: [scalarField("f")] })],
      mappings: [mappingDecl({ name: "m0", sources: ["nowhere"], targets: ["s1"], arrows: [] })],
    });

    assert.throws(() => scenarioDeclaredUsageSites(workspace), /'nowhere' .* names no declared/);
  });
});

describe("scenarioEntityKeyForRef", () => {
  it("binds a bare reference to the enclosing namespace when that namespace declares it", () => {
    // Satsuma's scoping rule (spec §5.3), and the reason
    // `bareNamespacedWorkspaceArbitrary` is a domain of its own: `source { s0 }`
    // inside `namespace ns_a` names `ns_a::s0`, not the file-scope `s0`. Getting
    // this right here and wrong in `resolveReferenceKey` is `sl-p256`.
    const declared = new Set(["s0", "ns_a::s0"]);

    assert.equal(scenarioEntityKeyForRef("s0", "ns_a", declared), "ns_a::s0");
    assert.equal(scenarioEntityKeyForRef("s0", null, declared), "s0");
  });

  it("falls back to file scope for a bare reference the namespace does not declare", () => {
    // A namespace that declares no `s0` does not capture the reference — it binds
    // outward to the file-scope declaration.
    assert.equal(scenarioEntityKeyForRef("s0", "ns_a", new Set(["s0"])), "s0");
  });

  it("leaves a qualified reference alone whatever namespace it sits in", () => {
    // `::` names the entity outright, so the enclosing block cannot rebind it.
    assert.equal(scenarioEntityKeyForRef("ns_b::s0", "ns_a", new Set(["ns_b::s0"])), "ns_b::s0");
  });
});

describe("USAGE_KIND", () => {
  it("spells every kind exactly as the workspace index's ReferenceEntry.context", () => {
    // These strings are compared with observed values as plain strings, with no
    // translation layer. A rename on either side has to break something, and this
    // is the case that breaks.
    assert.deepEqual(Object.values(USAGE_KIND).sort(), [
      "arrow",
      "import",
      "metric_source",
      "nl",
      "source",
      "spread",
      "target",
    ]);
  });
});

describe("scenarioChangedDeclarations", () => {
  const schemasNamed = (names, extra = {}) =>
    names.map((name) => schemaDecl({ name, fields: [scalarField("f")], ...extra }));

  it("names a declaration whose body changed, and no other", () => {
    // The oracle for diff: it answers "which entities may the delta legitimately
    // mention". Reporting an unchanged neighbour would let a diff that
    // over-reports pass, which is the failure a reader would never notice.
    const before = oneFile({ schemas: schemasNamed(["s0", "s1"]), mappings: [] });
    const after = oneFile({
      schemas: [schemaDecl({ name: "s0", fields: [] }), ...schemasNamed(["s1"])],
      mappings: [],
    });

    assert.deepEqual(scenarioChangedDeclarations(before, after), ["s0"]);
  });

  it("names a declaration that exists on one side only", () => {
    // Added and removed are both changes. A one-sided walk would miss one of
    // the two directions, and which one it missed would depend on argument order.
    const before = oneFile({ schemas: schemasNamed(["s0"]), mappings: [] });
    const after = oneFile({ schemas: schemasNamed(["s0", "s1"]), mappings: [] });

    assert.deepEqual(scenarioChangedDeclarations(before, after), ["s1"]);
    assert.deepEqual(scenarioChangedDeclarations(after, before), ["s1"]);
  });

  it("keys a namespaced declaration by ns::name, which is what diff reports", () => {
    // A bare key would make `ns_a::s0` and a file-scope `s0` the same
    // declaration, so a change to one would excuse a delta mentioning the other.
    const before = oneFile({ schemas: schemasNamed(["s0"], { namespace: "ns_a" }), mappings: [] });
    const after = oneFile({
      schemas: [schemaDecl({ name: "s0", namespace: "ns_a", fields: [] })],
      mappings: [],
    });

    assert.deepEqual(scenarioChangedDeclarations(before, after), ["ns_a::s0"]);
  });

  it("sees no change when a declaration is merely duplicated", () => {
    // Every extractor in the toolchain merges a duplicate declaration, so a
    // workspace with one and a workspace with two are structurally the same and
    // `diff` is right to stay silent. Feature 46 R1's duplicate mutators depend
    // on this reading: they produce a diagnostic, not a delta.
    const before = oneFile({ schemas: schemasNamed(["s0"]), mappings: [] });
    const after = oneFile({ schemas: schemasNamed(["s0", "s0"]), mappings: [] });

    assert.deepEqual(scenarioChangedDeclarations(before, after), []);
  });

  it("sees no change when declarations are only reordered or moved between files", () => {
    // Order and file placement are not structure. This is the invariant the
    // `reverse-declaration-order` and `split-across-files` null mutators rest on.
    const before = oneFile({ schemas: schemasNamed(["s0", "s1"]), mappings: [] });
    const after = scenarioWorkspace([
      scenarioFile({
        path: "entry.stm",
        fragments: [],
        schemas: schemasNamed(["s1"]),
        mappings: [],
      }),
      scenarioFile({
        path: "part1.stm",
        fragments: [],
        schemas: schemasNamed(["s0"]),
        mappings: [],
      }),
    ]);

    assert.deepEqual(scenarioChangedDeclarations(before, after), []);
  });
});
