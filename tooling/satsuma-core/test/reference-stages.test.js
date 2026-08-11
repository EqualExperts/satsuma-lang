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
  resolveAuthoredPathAgainstContainer,
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

describe("resolveAuthoredPathAgainstContainer — ADR-053 escape prefixes", () => {
  // The ancestor-escape prefixes are the one rule every nested-arrow consumer
  // shares, so the shared resolver is the place to pin every branch of it. Each
  // case states the falsifiable property: the resolved path is exactly what the
  // container-prefixing rule produces, so coverage/lineage/viz all see the same
  // absolute path an outside-the-block arrow would have written.

  it("prefixes a relative child path and strips the leading dot (unchanged rule)", () => {
    assert.equal(
      resolveAuthoredPathAgainstContainer(".species_code", "transects.sightings"),
      "transects.sightings.species_code",
    );
    // A bare path with no leading dot resolves identically — the dot only marks.
    assert.equal(
      resolveAuthoredPathAgainstContainer("species_code", "transects.sightings"),
      "transects.sightings.species_code",
    );
  });

  it("pops one container level for a single parent escape", () => {
    // The parent transect's ref, referenced from inside the sightings each —
    // the exact gap the ticket was filed against.
    assert.equal(
      resolveAuthoredPathAgainstContainer("^.transect_ref", "transects.sightings"),
      "transects.transect_ref",
    );
  });

  it("pops one level per ^., so a grandparent field is reachable from two levels deep", () => {
    assert.equal(
      resolveAuthoredPathAgainstContainer("^.^.survey_id", "transects.sightings.rings"),
      "transects.survey_id",
    );
  });

  it("resolves root-relative when the escape pops past the schema root", () => {
    // Popping is a directional instruction, not a range check; the resolved
    // path is still validated against the schema downstream.
    assert.equal(
      resolveAuthoredPathAgainstContainer("^.^.^.survey_id", "transects.sightings"),
      "survey_id",
    );
    assert.equal(resolveAuthoredPathAgainstContainer("^.foo", null), "foo");
  });

  it("resolves a root escape absolute from the schema root, ignoring the container", () => {
    assert.equal(
      resolveAuthoredPathAgainstContainer("$.survey_id", "transects.sightings.rings"),
      "survey_id",
    );
    // A multi-segment root-absolute path keeps its segments.
    assert.equal(
      resolveAuthoredPathAgainstContainer("$.observer.ranger_id", "transects.sightings"),
      "observer.ranger_id",
    );
  });

  it("keeps continuation segments after an escape", () => {
    assert.equal(
      resolveAuthoredPathAgainstContainer("^.rings.ring_id", "transects.sightings"),
      "transects.rings.ring_id",
    );
  });

  it("leaves a top-level path with no container at its authored value", () => {
    assert.equal(resolveAuthoredPathAgainstContainer("survey_id", null), "survey_id");
    assert.equal(resolveAuthoredPathAgainstContainer("$.survey_id", null), "survey_id");
  });

  it("returns an empty path unchanged rather than inventing a dangling prefix", () => {
    assert.equal(resolveAuthoredPathAgainstContainer("", "transects.sightings"), "");
  });

  it("qualifies an escaped authored ref through the branded transition too", () => {
    // qualifyContainerFieldRef delegates to the same resolver, so the branded
    // path an arrow consumer carries already has the escape resolved away.
    assert.equal(
      qualifyContainerFieldRef(
        createAuthoredFieldRef("^.transect_ref"),
        createContainerQualifiedFieldRef("transects.sightings"),
      ),
      "transects.transect_ref",
    );
    assert.equal(
      qualifyContainerFieldRef(
        createAuthoredFieldRef("$.survey_id"),
        createContainerQualifiedFieldRef("transects.sightings"),
      ),
      "survey_id",
    );
  });
});
