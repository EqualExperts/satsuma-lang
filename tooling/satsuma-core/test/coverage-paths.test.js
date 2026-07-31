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
import { addPathAndPrefixes, buildCoveredFieldSet, isCoveredFieldPath } from "@satsuma/core";

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
    assert.ok(set.has("address"), "parent prefix 'address' must be registered");
    assert.ok(set.has("address.city"), "full path must be registered");
    assert.ok(set.has("city"), "bare leaf 'city' must be registered for cross-level matching");
  });

  it("expands prefixes recursively, not just one level deep", () => {
    // Three-level paths appear in real workbooks; a one-level implementation
    // would leave "a.b" unregistered and report the middle record uncovered.
    const set = new Set();
    addPathAndPrefixes(set, "a.b.c");
    assert.ok(set.has("a"));
    assert.ok(set.has("a.b"));
    assert.ok(set.has("a.b.c"));
    assert.ok(set.has("b"));
    assert.ok(set.has("c"));
  });

  it("strips [] array notation before splitting", () => {
    // Schemas declare "items", arrows write "items[].id". Without stripping,
    // the declared field would never match the arrow that populates it.
    const set = new Set();
    addPathAndPrefixes(set, "items[].id");
    assert.ok(set.has("items"), "'items' must be registered after stripping '[]'");
    assert.ok(set.has("items.id"));
    assert.ok(set.has("id"));
    assert.ok(!set.has("items[]"), "bracket-suffixed form must NOT appear in the set");
  });

  it("registers the bare field name for a list-root path", () => {
    // An arrow targeting the whole list ("items[]") covers the "items" field.
    const set = new Set();
    addPathAndPrefixes(set, "items[]");
    assert.deepEqual([...set], ["items"]);
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

  it("normalizes array traversal paths via addPathAndPrefixes", () => {
    const covered = buildCoveredFieldSet(["line_items[].sku"]);
    assert.equal(isCoveredFieldPath("line_items", covered), true);
    assert.equal(isCoveredFieldPath("line_items.sku", covered), true);
  });

  it("returns false for unrelated paths", () => {
    const covered = buildCoveredFieldSet(["customer.email"]);
    assert.equal(isCoveredFieldPath("customer.tier", covered), false);
  });
});
