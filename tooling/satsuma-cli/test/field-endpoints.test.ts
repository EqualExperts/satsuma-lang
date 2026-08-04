/**
 * field-endpoints.test.ts — the CLI's one remaining qualification choice
 *
 * Core reports when an authored arrow token reads either as a schema root or as
 * a same-named field; `arrowEndpoint` is the single place the CLI decides which
 * reading to emit. These tests hold that decision to one site, so that changing
 * it when `r0-7w76` is settled cannot silently change some emitters and not
 * others.
 *
 * Endpoint spelling itself is core's contract and is tested there.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAuthoredFieldRef, resolveFieldEndpoint } from "@satsuma/core";
import { arrowEndpoint } from "#src/field-endpoints.js";

describe("arrowEndpoint", () => {
  it("emits the field reading of a schema-root token, pending r0-7w76", () => {
    // ⚠️ THIS TEST PINS A KNOWN DEFECT (r0-7w76).
    //
    // `flatten observations -> species_fact` names the target schema's root, and
    // `::species_fact.species_fact` is a field the workspace never declares. The
    // assertion records that graph and lineage still emit it, and that the guess
    // now lives in exactly one function instead of three emitters.
    //
    // WHEN r0-7w76 IS FIXED: this test goes red. Replace it with the schema-root
    // expectation (`::species_fact`), which core already offers as
    // `resolution.schemaRoot`.
    const schemas = ["species_fact"];
    assert.equal(arrowEndpoint("species_fact", schemas), "::species_fact.species_fact");

    // The alternative reading is available at the same call, unused: that is what
    // makes the fix a one-line change here rather than a re-derivation.
    const resolution = resolveFieldEndpoint(createAuthoredFieldRef("species_fact"), schemas);
    assert.equal(resolution.kind, "schema-root-or-field");
    assert.equal(
      resolution.kind === "schema-root-or-field" ? resolution.schemaRoot : null,
      "::species_fact",
    );
  });

  it("canonicalizes an authored token that has no schema to attach to", () => {
    // A mapping side with no declared schema still has to yield one spelling per
    // entity, because `graph --json` consumers match endpoints across arrays. The
    // authored text is canonicalized rather than emitted bare.
    assert.equal(arrowEndpoint("amount", []), "::amount");
  });

  it("rejects an empty authored endpoint instead of emitting one that names nothing", () => {
    // Extraction cannot produce an empty field expression, so an empty value is
    // an upstream defect. Failing loudly here beats emitting `::schema.` into a
    // lineage graph, where it would silently match nothing downstream.
    assert.throws(() => arrowEndpoint("", ["orders"]), TypeError);
  });
});
