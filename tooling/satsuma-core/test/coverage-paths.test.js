/**
 * coverage-paths.test.js — Field-path set helpers for nested field coverage.
 *
 * These tests pin the path-normalisation rules that every coverage consumer
 * depends on (CLI `coverage`/`fields --unmapped-by`, the VS Code gutter, the
 * viz overlay). The higher-level walk that produces these paths is tested in
 * coverage.test.js.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCoveredFieldPaths,
  buildCoveredFieldSet,
  hasDirectlyCoveredAncestor,
  isCoveredFieldPath,
  isCoveredPath,
  isDirectlyCovered,
  schemaLocalFieldPath,
} from "@satsuma/core";

describe("buildCoveredFieldSet()", () => {
  it("marks nested field paths and their parents as covered", () => {
    // Coverage of "address" must fire when an arrow targets a path inside it —
    // without ancestor registration the parent record always reads as unmapped.
    const covered = buildCoveredFieldSet(["customer.email"]);
    assert.equal(isCoveredFieldPath("customer", covered), true);
    assert.equal(isCoveredFieldPath("customer.email", covered), true);
  });

  it("registers every ancestor of a deep path, not just one level", () => {
    // Three-level paths appear in real workbooks; a one-level implementation
    // would leave "a.b" unregistered and report the middle record uncovered.
    const covered = buildCoveredFieldSet(["a.b.c"]);
    assert.deepEqual([...covered].sort(), ["a", "a.b", "a.b.c"]);
  });

  it("returns false for unrelated paths", () => {
    const covered = buildCoveredFieldSet(["customer.email"]);
    assert.equal(isCoveredFieldPath("customer.tier", covered), false);
  });

  it("leaves a top-level field uncovered when only a nested field shares its name", () => {
    // sl-joeq's live failure mode: a top-level field's qualified path IS its
    // bare name, so bare-segment registration made it collide with any nested
    // leaf of the same name. Reported 100% for a schema half of whose fields
    // no arrow touches.
    const covered = buildCoveredFieldSet(["home_address.city"]);
    assert.equal(isCoveredFieldPath("city", covered), false);
  });

  it("leaves every intermediate segment of a deep path uncovered as a top-level name", () => {
    // Middle segments leaked as well as leaves: with only a.b.c.d covered,
    // top-level fields named b, c or d all read as mapped.
    const covered = buildCoveredFieldSet(["a.b.c.d"]);
    for (const segment of ["b", "c", "d"]) {
      assert.equal(isCoveredFieldPath(segment, covered), false, `'${segment}' must be uncovered`);
    }
    assert.equal(isCoveredFieldPath("a", covered), true, "'a' is a genuine ancestor prefix");
  });

  it("leaves a sibling record's same-named leaf uncovered", () => {
    // Sibling records sharing a leaf name (the fragment-spread shape of
    // examples/lib/sfdc_fragments.stm, where one fragment lands in both
    // BillingAddress and ShippingAddress) must be judged independently.
    const covered = buildCoveredFieldSet(["home_address.city"]);
    assert.equal(isCoveredFieldPath("work_address.city", covered), false);
  });

  it("leaves a sibling list container's same-named leaf uncovered", () => {
    // Sibling lists whose element records share field names are the norm in
    // nested schemas; only the container an arrow actually writes is covered.
    const covered = buildCoveredFieldSet(["orders.lines.sku"]);
    assert.equal(isCoveredFieldPath("orders.lines.sku", covered), true);
    assert.equal(isCoveredFieldPath("orders.packed.sku", covered), false);
  });
});

describe("buildCoveredFieldPaths() — the direct/derived model", () => {
  // PRD 38 R1 (sl-fmx0): the model must record WHY a path is covered, because
  // container reasoning (tri-state, whole-subtree arrows) hangs off the
  // difference between "an arrow wrote exactly this" and "an arrow wrote
  // something inside this".

  it("separates directly-referenced paths from their ancestor prefixes", () => {
    // The core distinction: "address.city" was written; "address" only contains
    // something that was. A flat set cannot tell these apart.
    const covered = buildCoveredFieldPaths(["address.city"]);
    assert.equal(isDirectlyCovered("address.city", covered), true);
    assert.equal(
      isDirectlyCovered("address", covered),
      false,
      "'address' is an ancestor, not direct",
    );
    assert.equal(isCoveredPath("address", covered), true, "…but it still counts as covered");
  });

  it("lets one path be both direct and an ancestor, with direct as the stronger claim", () => {
    // Arrows writing both "address" and "address.city" are legal; membership in
    // ancestors must not mask the direct claim.
    const covered = buildCoveredFieldPaths(["address", "address.city"]);
    assert.equal(isDirectlyCovered("address", covered), true);
    assert.equal(isCoveredPath("address", covered), true);
  });

  it("answers the whole-subtree query: a leaf beneath a DIRECTLY covered record inherits", () => {
    // sl-fmx0 AC / PRD 38 R5: `addr -> address` writes "address" exactly, so
    // its unmentioned leaves descend from a directly-covered container.
    // (computeMappingCoverage does not consult this yet — see sl-r6b0.)
    const covered = buildCoveredFieldPaths(["address"]);
    assert.equal(hasDirectlyCoveredAncestor("address.line1", covered), true);
    assert.equal(hasDirectlyCoveredAncestor("address.nested.deeper", covered), true);
  });

  it("refuses the trap 3cc-iedv documents: a merely-ancestor record confers nothing downward", () => {
    // With only "address.city" written, "address" is covered as an ancestor —
    // but its OTHER leaves must not inherit, or "one of twelve address fields
    // is mapped" reads as "all twelve are".
    const covered = buildCoveredFieldPaths(["address.city"]);
    assert.equal(hasDirectlyCoveredAncestor("address.line1", covered), false);
    assert.equal(isCoveredPath("address.line1", covered), false);
  });

  it("does not report a path as its own ancestor", () => {
    // hasDirectlyCoveredAncestor is a PROPER-ancestor query: a directly covered
    // leaf inherits nothing from itself, so callers can compose it with
    // isDirectlyCovered without double counting.
    const covered = buildCoveredFieldPaths(["address"]);
    assert.equal(hasDirectlyCoveredAncestor("address", covered), false);
  });

  it("ignores empty paths rather than registering an '' entry", () => {
    // Malformed arrows can yield empty path text; the model must stay clean
    // rather than gaining an "" entry that matches nothing but inflates counts.
    const covered = buildCoveredFieldPaths([""]);
    assert.equal(covered.direct.size, 0);
    assert.equal(covered.ancestors.size, 0);
  });

  it("registers a path verbatim, applying no bracket normalisation", () => {
    // sl-8o1n: v1's "items[].id" notation is a parse error in v2 (iteration is
    // each/flatten), so extraction can never produce it — parser.test.js pins
    // that. The old [] stripping ran only on the build side and never on the
    // probe side, so it was deleted rather than left silently asymmetric. This
    // test pins the deletion: paths pass through exactly as given.
    const covered = buildCoveredFieldPaths(["items[].id"]);
    assert.ok(covered.direct.has("items[].id"), "path must be registered exactly as given");
    assert.ok(!covered.direct.has("items.id"), "no bracket-stripped variant may be registered");
    assert.ok(covered.ancestors.has("items[]"), "the ancestor split is on dots alone");
  });

  it("keeps the flat-set view equal to the union of direct and ancestors", () => {
    // buildCoveredFieldSet is defined as the model's union, so consumers on the
    // boolean view can never drift from consumers on the model.
    const paths = ["a.b.c", "x", "a.other"];
    const flat = buildCoveredFieldSet(paths);
    const model = buildCoveredFieldPaths(paths);
    assert.deepEqual(flat, new Set([...model.direct, ...model.ancestors]));
    for (const p of flat) {
      assert.equal(isCoveredPath(p, model), true, `'${p}' must probe as covered on the model too`);
    }
  });
});

describe("schemaLocalFieldPath()", () => {
  // The counterpart rule to path-only matching: because a field is no longer
  // matched by local name, an arrow's schema prefix must be resolved away
  // explicitly. Every consumer (CLI coverage, VS Code gutter, viz overlay) runs
  // this same reduction, so it is pinned once here.

  it("strips a prefix naming the schema itself", () => {
    assert.equal(schemaLocalFieldPath("crm.email", ["crm"], []), "email");
  });

  it("leaves an already-local path untouched", () => {
    // Single-source mappings write bare paths, and a nested path's first segment
    // is a field name, not a schema name.
    assert.equal(schemaLocalFieldPath("customer.email", ["orders"], []), "customer.email");
  });

  it("returns null for a path naming another schema in the same block", () => {
    // Multi-source mappings report each schema separately; crediting one
    // schema's arrow to a sibling is the over-count sl-joeq is about.
    assert.equal(schemaLocalFieldPath("ledger.email", ["crm"], ["ledger"]), null);
  });

  it("accepts a namespaced schema by its bare name as well as its qualified id", () => {
    // Arrows keep authored text: inside `namespace crm` an arrow writes
    // `customers.id` while the index reports `crm::customers` (sl-iqud).
    assert.equal(schemaLocalFieldPath("customers.id", ["crm::customers"], []), "id");
    assert.equal(schemaLocalFieldPath("crm::customers.id", ["crm::customers"], []), "id");
  });

  it("treats a sibling schema's bare-name prefix as belonging to that sibling", () => {
    // The bare form has to be recognised on the rival side too, or a namespaced
    // multi-source mapping credits every arrow to every schema.
    assert.equal(schemaLocalFieldPath("orders.total", ["crm::customers"], ["crm::orders"]), null);
  });

  it("returns null for a bare reference that is just the schema's name", () => {
    // Spec §4.6's top-level flatten targets the target *schema*
    // (`flatten contacts -> tgt`), and extraction reports that target verbatim.
    // Without this rule `tgt` would enter the covered set as though a field of
    // that name had been written (sl-vu22).
    assert.equal(schemaLocalFieldPath("tgt", ["tgt"], []), null);
    assert.equal(schemaLocalFieldPath("customers", ["crm::customers"], []), null);
  });

  it("keeps a bare reference that names a declared field, not the schema", () => {
    // A single-source mapping's `id -> id` is a field reference even when the
    // schema is called `id`; the declaration settles it.
    assert.equal(
      schemaLocalFieldPath("id", ["id"], [], (n) => n === "id"),
      "id",
    );
  });

  it("prefers a declared field over a schema prefix of the same name", () => {
    // A schema and one of its own top-level fields can collide. The declared
    // field is concrete evidence, so the path is read as-is rather than stripped.
    const declaresTopLevel = (name) => name === "orders";
    assert.equal(
      schemaLocalFieldPath("orders.amount", ["orders"], [], declaresTopLevel),
      "orders.amount",
    );
    // Without the declaration the same input is a schema-qualified reference.
    assert.equal(schemaLocalFieldPath("orders.amount", ["orders"], []), "amount");
  });
});
