/**
 * meta-extract.test.js — Unit tests for satsuma-core meta-extract module
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractMetadata } from "../dist/meta-extract.js";

function n(type, namedChildren = [], text = "") {
  return { type, text, isNamed: true, namedChildren, children: namedChildren };
}

function metaBlock(children) {
  return n("metadata_block", children);
}

describe("extractMetadata()", () => {
  it("returns empty array for null input", () => {
    assert.deepEqual(extractMetadata(null), []);
  });

  it("returns empty array for undefined input", () => {
    assert.deepEqual(extractMetadata(undefined), []);
  });

  it("extracts tag_token entries", () => {
    const meta = metaBlock([n("tag_token", [], "#pii")]);
    assert.deepEqual(extractMetadata(meta), [{ kind: "tag", tag: "#pii" }]);
  });

  it("extracts tag_with_value entries", () => {
    const key = n("identifier", [], "owner");
    const val = n("value_text", [], "data-team");
    const kv = n("tag_with_value", [key, val]);
    const meta = metaBlock([kv]);
    assert.deepEqual(extractMetadata(meta), [{ kind: "kv", key: "owner", value: "data-team" }]);
  });

  it("strips nl_string delimiters from kv value", () => {
    const key = n("identifier", [], "label");
    const val = n("nl_string", [], '"some label"');
    const kv = n("tag_with_value", [key, val]);
    const meta = metaBlock([kv]);
    assert.deepEqual(extractMetadata(meta), [{ kind: "kv", key: "label", value: "some label" }]);
  });

  it("unwraps quoted strings wrapped by value_text", () => {
    // The parser stores metadata key/value payloads under value_text, so the
    // extractor must normalize the wrapper node rather than only bare nl_string nodes.
    const key = n("identifier", [], "classification");
    const val = n("value_text", [n("nl_string", [], '"INTERNAL"')], '"INTERNAL"');
    const kv = n("tag_with_value", [key, val]);
    const meta = metaBlock([kv]);
    assert.deepEqual(extractMetadata(meta), [{ kind: "kv", key: "classification", value: "INTERNAL" }]);
  });

  // sl-cvx9: value_text legally mixes quoted strings with surrounding tokens
  // (e.g. `default "unknown" if null`). The extractor previously discarded
  // everything except the first nl_string child, silently losing data in all
  // extraction JSON and hover output. Mixed values must round-trip verbatim.

  it("preserves tokens around a quoted string in a mixed value (sl-cvx9)", () => {
    // CST shape of `(default "unknown" if null)`: value_text with an nl_string
    // child followed by two identifier children.
    const key = n("identifier", [], "default");
    const val = n(
      "value_text",
      [n("nl_string", [], '"unknown"'), n("identifier", [], "if"), n("identifier", [], "null")],
      '"unknown" if null',
    );
    const kv = n("tag_with_value", [key, val]);
    const meta = metaBlock([kv]);
    assert.deepEqual(extractMetadata(meta), [{ kind: "kv", key: "default", value: '"unknown" if null' }]);
  });

  it("preserves all strings in a multi-string value (sl-cvx9)", () => {
    // `(default "a" or "b")` — two nl_strings with an identifier between them.
    // The old code returned just "a"; the outer-quote fallback must also not
    // fire here (it would mangle the value to `a" or "b`).
    const key = n("identifier", [], "default");
    const val = n(
      "value_text",
      [n("nl_string", [], '"a"'), n("identifier", [], "or"), n("nl_string", [], '"b"')],
      '"a" or "b"',
    );
    const kv = n("tag_with_value", [key, val]);
    const meta = metaBlock([kv]);
    assert.deepEqual(extractMetadata(meta), [{ kind: "kv", key: "default", value: '"a" or "b"' }]);
  });

  it("extracts enum_body entries", () => {
    const id1 = n("identifier", [], "open");
    const id2 = n("identifier", [], "closed");
    const enumBody = n("enum_body", [id1, id2]);
    const meta = metaBlock([enumBody]);
    assert.deepEqual(extractMetadata(meta), [{ kind: "enum", values: ["open", "closed"] }]);
  });

  it("extracts note_tag entries", () => {
    const str = n("nl_string", [], '"this is a note"');
    const noteTag = n("note_tag", [str]);
    const meta = metaBlock([noteTag]);
    assert.deepEqual(extractMetadata(meta), [{ kind: "note", text: "this is a note" }]);
  });

  it("extracts slice_body entries", () => {
    const id1 = n("identifier", [], "region");
    const id2 = n("identifier", [], "channel");
    const sliceBody = n("slice_body", [id1, id2]);
    const meta = metaBlock([sliceBody]);
    assert.deepEqual(extractMetadata(meta), [{ kind: "slice", values: ["region", "channel"] }]);
  });

  it("extracts multiple entries in order", () => {
    const tag = n("tag_token", [], "#required");
    const key = n("identifier", [], "owner");
    const val = n("value_text", [], "eng");
    const kv = n("tag_with_value", [key, val]);
    const meta = metaBlock([tag, kv]);
    assert.deepEqual(extractMetadata(meta), [
      { kind: "tag", tag: "#required" },
      { kind: "kv", key: "owner", value: "eng" },
    ]);
  });
});
