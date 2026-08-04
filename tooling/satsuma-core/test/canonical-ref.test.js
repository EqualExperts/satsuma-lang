/**
 * canonical-ref.test.js — Unit tests for satsuma-core canonical-ref module
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalRef, canonicalEntityName, resolveFieldEndpoint } from "../dist/canonical-ref.js";
import { createAuthoredFieldRef } from "../dist/reference-stages.js";

describe("canonicalRef()", () => {
  it("returns ::schema.field when no namespace", () => {
    assert.equal(canonicalRef(undefined, "customers", "email"), "::customers.email");
  });

  it("returns ::schema.field when namespace is null", () => {
    assert.equal(canonicalRef(null, "customers", "email"), "::customers.email");
  });

  it("returns namespace::schema.field when namespace present", () => {
    assert.equal(canonicalRef("crm", "customers", "email"), "crm::customers.email");
  });

  it("returns ::schema when field is omitted", () => {
    assert.equal(canonicalRef(undefined, "customers"), "::customers");
  });

  it("returns namespace::schema when field is omitted", () => {
    assert.equal(canonicalRef("crm", "customers"), "crm::customers");
  });

  it("returns ::schema when field is null", () => {
    assert.equal(canonicalRef(null, "customers", null), "::customers");
  });
});

describe("canonicalEntityName()", () => {
  it("returns namespace::name when both present", () => {
    assert.equal(canonicalEntityName({ namespace: "crm", name: "customers" }), "crm::customers");
  });

  it("returns ::name when no namespace", () => {
    assert.equal(canonicalEntityName({ name: "customers" }), "::customers");
  });

  it("returns :: when name is null", () => {
    assert.equal(canonicalEntityName({ name: null }), "::");
  });
});

describe("resolveFieldEndpoint()", () => {
  /** Resolve authored arrow text against a mapping side's declared schemas. */
  const resolve = (authored, schemas) =>
    resolveFieldEndpoint(createAuthoredFieldRef(authored), schemas);

  it("attaches a bare field to the mapping side's primary schema", () => {
    assert.deepEqual(resolve("customer_id", ["orders"]), {
      kind: "field",
      endpoint: "::orders.customer_id",
    });
  });

  it("qualifies leading-dot nested paths without retaining the synthetic dot", () => {
    assert.deepEqual(resolve(".address.street", ["customers"]), {
      kind: "field",
      endpoint: "::customers.address.street",
    });
  });

  it("restores the namespace on a field prefixed by a namespaced schema's bare name", () => {
    // Container extraction prefixes flatten children with the authored target
    // schema (`customers.id`). That is not canonical until the namespace from
    // the mapping endpoint has been restored.
    assert.deepEqual(resolve("customers.id", ["crm::customers"]), {
      kind: "field",
      endpoint: "crm::customers.id",
    });
  });

  it("prefers an exactly-matching index key over a namespaced schema's bare name", () => {
    // One mapping side may declare both a global `customers` and `crm::customers`.
    // The authored text `customers.id` names the global one, so the exact-key
    // pass must run before the bare-name pass across all declared schemas.
    assert.deepEqual(resolve("customers.id", ["crm::customers", "customers"]), {
      kind: "field",
      endpoint: "::customers.id",
    });
  });

  it("adopts an already-namespaced endpoint instead of re-prefixing it", () => {
    // Re-qualifying would produce `crm::customers.crm::customers.id`.
    assert.deepEqual(resolve("crm::customers.id", ["crm::customers"]), {
      kind: "field",
      endpoint: "crm::customers.id",
    });
  });

  it("keeps an unmatched dotted prefix as part of the path under the primary schema", () => {
    // `address.city` is a nested path, not a schema reference: no declared
    // schema is named `address`, so the whole token is a path within the primary.
    assert.deepEqual(resolve("address.city", ["customers"]), {
      kind: "field",
      endpoint: "::customers.address.city",
    });
  });

  it("reports both readings when a bare token also names a declared schema", () => {
    // `flatten observations -> species_fact` names the target schema's root, but
    // the same token is a legal field name. This is the fork that used to be
    // silently resolved as a field, inventing `::species_fact.species_fact`
    // (r0-7w76). Core reports it; the caller decides.
    assert.deepEqual(resolve("species_fact", ["species_fact"]), {
      kind: "schema-root-or-field",
      schemaRoot: "::species_fact",
      asField: "::species_fact.species_fact",
    });
  });

  it("reports the ambiguity for a namespaced schema named by its bare half", () => {
    // The same fork exists under a namespace, where the schema root and the
    // invented field differ in more than one segment.
    assert.deepEqual(resolve("species_fact", ["mart::species_fact"]), {
      kind: "schema-root-or-field",
      schemaRoot: "mart::species_fact",
      asField: "mart::species_fact.species_fact",
    });
  });

  it("reports an authored token as unqualifiable when the mapping side is empty", () => {
    // A mapping with no declared schema on this side offers no owner to attach
    // to, so no endpoint can be composed and the authored text is all there is.
    assert.deepEqual(resolve("amount", []), { kind: "unqualifiable", authored: "amount" });
  });
});
