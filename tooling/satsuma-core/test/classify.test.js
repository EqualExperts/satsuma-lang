/**
 * classify.test.js — Unit tests for satsuma-core classify module
 *
 * After Feature 28, classification has three values: "nl", "none",
 * "nl-derived". "structural" and "mixed" are removed. All non-empty
 * pipe chains classify as "nl" — bare identifier tokens, map literals,
 * and quoted strings are all treated uniformly as NL.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyTransform, classifyArrow } from "../dist/classify.js";

function n(type, namedChildren = [], text = "") {
  return {
    type,
    text,
    isNamed: true,
    namedChildren,
    children: namedChildren,
    startPosition: { row: 0, column: 0 },
  };
}

function pipeStep(innerType, innerChildren = [], text = "") {
  return n("pipe_step", [n(innerType, innerChildren, text)]);
}

function bareTokenStep(text) {
  // Bare identifier pipe step — these are NL after Feature 28
  return pipeStep("pipe_text", [n("identifier", [], text)], text);
}

function nlStep(text) {
  return pipeStep("pipe_text", [n("nl_string", [], text)], text);
}

describe("classifyTransform()", () => {
  it("returns 'none' for empty steps", () => {
    // Validates the direct-copy (no transform body) case
    assert.equal(classifyTransform([]), "none");
  });

  it("returns 'none' for null steps", () => {
    // Null is treated identically to an empty array
    assert.equal(classifyTransform(null), "none");
  });

  it("returns 'nl' for bare identifier steps", () => {
    // Bare tokens like 'trim' are NL — no structural distinction
    assert.equal(classifyTransform([bareTokenStep("trim")]), "nl");
  });

  it("returns 'nl' for NL string steps", () => {
    // Quoted strings are NL
    assert.equal(classifyTransform([nlStep('"convert to USD"')]), "nl");
  });

  it("returns 'nl' for mixed bare and quoted steps", () => {
    // Mixing bare tokens and quoted strings is still NL — no 'mixed' variant
    assert.equal(classifyTransform([bareTokenStep("trim"), nlStep('"apply fx"')]), "nl");
  });

  it("returns 'nl' for map_literal step", () => {
    // map { } is a structural construct but the arrow as a whole is classified nl
    assert.equal(classifyTransform([pipeStep("map_literal", [], "{}")]), "nl");
  });

  it("returns 'nl' for fragment_spread step", () => {
    // Spread steps also make the transform 'nl'
    assert.equal(classifyTransform([pipeStep("fragment_spread", [], "...clean")]), "nl");
  });
});

describe("classifyArrow()", () => {
  it("returns true for computed_arrow", () => {
    assert.equal(classifyArrow(n("computed_arrow")), true);
  });

  it("returns false for map_arrow", () => {
    assert.equal(classifyArrow(n("map_arrow")), false);
  });
});
