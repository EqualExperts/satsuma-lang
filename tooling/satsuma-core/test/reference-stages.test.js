/**
 * reference-stages.test.js — Runtime contracts for opaque reference stages.
 *
 * Type tests prove that stages cannot be mixed at compile time. These tests own
 * the complementary runtime rules: boundary validation and the exact string
 * values produced by the two semantic transitions.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalizeEntityRef,
  createAuthoredEntityRef,
  createAuthoredFieldRef,
  createCanonicalEntityRef,
  createCanonicalFieldEndpoint,
  createContainerQualifiedFieldRef,
  createSchemaLocalPath,
  fieldEndpointOf,
  fieldEndpointPath,
  fieldEndpointSchema,
  qualifyContainerFieldRef,
} from "@satsuma/core";

describe("reference-stage constructors", () => {
  it("accepts every non-empty semantic string representation", () => {
    // Backtick quoting is removed during extraction, so punctuation and spaces
    // can be literal identifier content and must survive boundary validation.
    assert.equal(createAuthoredFieldRef("`not retained`.field"), "`not retained`.field");
    assert.equal(
      createContainerQualifiedFieldRef("orders.line items.sku"),
      "orders.line items.sku",
    );
    assert.equal(createSchemaLocalPath("city"), "city");
    assert.equal(createAuthoredEntityRef("crm::customers"), "crm::customers");
    assert.equal(createCanonicalEntityRef("::customers"), "::customers");
  });

  it("rejects empty values at every external construction boundary", () => {
    // Empty strings come only from recovery/incomplete input and cannot name a
    // field or entity at any semantic stage.
    for (const construct of [
      createAuthoredFieldRef,
      createContainerQualifiedFieldRef,
      createSchemaLocalPath,
      createAuthoredEntityRef,
      createCanonicalEntityRef,
    ]) {
      assert.throws(() => construct(""), TypeError);
    }
  });

  it("rejects an entity id that is not in canonical namespace form", () => {
    // Canonical ids always contain the namespace separator; global ids make
    // their empty namespace explicit as the leading `::`.
    assert.throws(() => createCanonicalEntityRef("customers"), TypeError);
    assert.throws(() => createCanonicalEntityRef("crm::"), TypeError);
  });

  it("rejects an endpoint whose owning schema is missing or unnamed", () => {
    // An endpoint identifies a field *of a schema*. A bare path names no owner,
    // and a spelling with nothing between the separators names no schema — both
    // would serialize as an edge endpoint that resolves to nobody.
    assert.throws(() => createCanonicalFieldEndpoint("customers.email"), TypeError);
    assert.throws(() => createCanonicalFieldEndpoint("crm::"), TypeError);
    assert.throws(() => createCanonicalFieldEndpoint("::.email"), TypeError);
  });

  it("accepts an endpoint that names a schema root with no field path", () => {
    // Schema-root endpoints are a legal spelling — schema-level lineage emits
    // them — so the constructor must not require a path. Whether any *authored*
    // form should resolve to one is a separate open question (r0-7w76).
    assert.equal(createCanonicalFieldEndpoint("::species_fact"), "::species_fact");
  });
});

// ── Endpoint composition and decomposition ───────────────────────────────────

describe("field endpoints", () => {
  it("composes and decomposes a namespaced nested endpoint symmetrically", () => {
    // Composition and decomposition are the same rule read in two directions;
    // if they ever disagree, an owning schema derived from a serialized endpoint
    // stops matching the schema the endpoint was built from.
    const endpoint = fieldEndpointOf(
      createCanonicalEntityRef("crm::customers"),
      createSchemaLocalPath("address.city"),
    );
    assert.equal(endpoint, "crm::customers.address.city");
    assert.equal(fieldEndpointSchema(endpoint), "crm::customers");
    assert.equal(fieldEndpointPath(endpoint), "address.city");
  });

  it("does not mistake a global endpoint's empty namespace for a path", () => {
    // `::orders.id` starts with the path separator's cousin. Decomposition must
    // search for the path only after the namespace separator, or the owning
    // schema comes back empty for every global entity.
    const endpoint = createCanonicalFieldEndpoint("::orders.id");
    assert.equal(fieldEndpointSchema(endpoint), "::orders");
    assert.equal(fieldEndpointPath(endpoint), "id");
  });

  it("reports a null path for a schema-root endpoint", () => {
    // A caller aggregating field edges onto schemas needs to distinguish "this
    // endpoint is a schema" from "this endpoint is a field named after one".
    const endpoint = fieldEndpointOf(createCanonicalEntityRef("::species_fact"), null);
    assert.equal(endpoint, "::species_fact");
    assert.equal(fieldEndpointSchema(endpoint), "::species_fact");
    assert.equal(fieldEndpointPath(endpoint), null);
  });
});

describe("reference-stage transitions", () => {
  it("qualifies a relative child path against its already-qualified container", () => {
    // Nested each/flatten/arrow bodies advance authored paths to the absolute
    // container-qualified stage and remove the relative marker exactly once.
    const authored = createAuthoredFieldRef(".sku");
    const container = createContainerQualifiedFieldRef("orders.lines");
    assert.equal(qualifyContainerFieldRef(authored, container), "orders.lines.sku");
  });

  it("advances a top-level authored path without changing its string value", () => {
    // A stage transition may be representationally invisible; the nominal type
    // still records that container qualification has been considered.
    assert.equal(
      qualifyContainerFieldRef(createAuthoredFieldRef("customer.id"), null),
      "customer.id",
    );
  });

  it("canonicalizes namespaced, local-namespace, and global entity refs", () => {
    // The resolver checks the same lookup order as workspace indexing while
    // ensuring the returned global id retains its unambiguous `::` prefix.
    const entities = new Map([
      ["crm::orders", {}],
      ["customers", {}],
    ]);
    assert.equal(
      canonicalizeEntityRef(createAuthoredEntityRef("crm::orders"), null, entities),
      "crm::orders",
    );
    assert.equal(
      canonicalizeEntityRef(createAuthoredEntityRef("orders"), "crm", entities),
      "crm::orders",
    );
    assert.equal(
      canonicalizeEntityRef(createAuthoredEntityRef("customers"), "crm", entities),
      "::customers",
    );
  });

  it("returns null when no workspace entity matches the authored ref", () => {
    // Branding must not turn a syntactically valid but unresolved name into a
    // canonical identity that does not exist.
    assert.equal(canonicalizeEntityRef(createAuthoredEntityRef("missing"), "crm", new Map()), null);
  });
});
