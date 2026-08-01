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
  addPathAndPrefixes,
  buildCoveredFieldSet,
  isCoveredFieldPath,
  schemaLocalFieldPath,
} from "@satsuma/core";

describe("addPathAndPrefixes()", () => {
  it("registers a leaf-only path unchanged", () => {
    // The degenerate case: a top-level field name has no prefixes to expand.
    const set = new Set();
    addPathAndPrefixes(set, "id");
    assert.deepEqual([...set], ["id"]);
  });

  it("registers every ancestor prefix of a dotted path", () => {
    // Coverage of "address" must fire when an arrow targets "address.city".
    // Without prefix registration the parent record always reads as unmapped.
    const set = new Set();
    addPathAndPrefixes(set, "address.city");
    assert.deepEqual([...set].sort(), ["address", "address.city"]);
  });

  it("does not register a path's segments as standalone bare names", () => {
    // sl-joeq: this assertion was inverted — the set used to contain "city" so
    // a consumer could probe by local field name, which made coverage resolve
    // by NAME rather than PATH and silently reported any same-named field
    // anywhere in the schema as mapped. Registering only qualified paths is the
    // invariant every consumer now relies on.
    const set = new Set();
    addPathAndPrefixes(set, "address.city");
    assert.ok(!set.has("city"), "bare leaf 'city' must NOT be registered");
  });

  it("expands prefixes recursively, not just one level deep", () => {
    // Three-level paths appear in real workbooks; a one-level implementation
    // would leave "a.b" unregistered and report the middle record uncovered.
    const set = new Set();
    addPathAndPrefixes(set, "a.b.c");
    assert.deepEqual([...set].sort(), ["a", "a.b", "a.b.c"]);
  });

  it("registers a path verbatim, applying no bracket normalisation", () => {
    // sl-8o1n: v1's "items[].id" notation is a parse error in v2 (iteration is
    // each/flatten), so extraction can never produce it — parser.test.js pins
    // that. The old [] stripping ran only on this build side and never on the
    // probe side, so it was deleted rather than left silently asymmetric. This
    // test pins the deletion: paths pass through exactly as given.
    const set = new Set();
    addPathAndPrefixes(set, "items[].id");
    assert.ok(set.has("items[].id"), "path must be registered exactly as given");
    assert.ok(!set.has("items.id"), "no bracket-stripped variant may be registered");
  });

  it("ignores an empty path", () => {
    // Malformed arrows can yield empty path text; the set must stay clean
    // rather than gaining an "" entry that matches nothing but inflates counts.
    const set = new Set();
    addPathAndPrefixes(set, "");
    assert.equal(set.size, 0);
  });

  it("is idempotent for a repeated path", () => {
    // Several arrows commonly target the same field; re-registering must not
    // change the set, so coverage counts cannot drift with arrow count.
    const set = new Set();
    addPathAndPrefixes(set, "name");
    const sizeAfterFirst = set.size;
    addPathAndPrefixes(set, "name");
    assert.equal(set.size, sizeAfterFirst);
  });
});

describe("buildCoveredFieldSet()", () => {
  it("marks nested field paths and their parents as covered", () => {
    const covered = buildCoveredFieldSet(["customer.email"]);
    assert.equal(isCoveredFieldPath("customer", covered), true);
    assert.equal(isCoveredFieldPath("customer.email", covered), true);
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
    assert.equal(
      schemaLocalFieldPath("orders.total", ["crm::customers"], ["crm::orders"]),
      null,
    );
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
    assert.equal(schemaLocalFieldPath("id", ["id"], [], (n) => n === "id"), "id");
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
