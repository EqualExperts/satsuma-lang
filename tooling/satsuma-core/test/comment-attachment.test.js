/**
 * comment-attachment.test.js — which field or arrow a trailing `//!` / `//?`
 * annotates, against real parsed source.
 *
 * Comments are tree-sitter extras, so their place in the CST does not follow
 * the item they describe: a comment trailing a body's last item is hoisted
 * out of the body. The viz once looked comments up with `indexOf` on a fresh
 * `.children` array, which never matches a web-tree-sitter node, so every
 * field comment silently vanished from the schema cards.
 */

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  initParser,
  getParser,
  allDescendants,
  trailingCommentOwner,
  trailingComments,
} from "@satsuma/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(__dirname, "../../tree-sitter-satsuma/tree-sitter-satsuma.wasm");

before(async () => {
  await initParser(WASM_PATH);
});

/** Parse source and return the CST root. */
function rootOf(src) {
  return getParser().parse(src).rootNode;
}

/** The field_decl whose name is `name`. */
function field(root, name) {
  return allDescendants(root, "field_decl").find((f) => f.namedChildren[0].text === name);
}

/** Text of every comment trailing `node`. */
function trailingTexts(node) {
  return trailingComments(node).map((c) => c.text);
}

describe("trailingComments", () => {
  it("finds a comment trailing a field in the middle of a schema body", () => {
    const root = rootOf("schema s {\n  id INT (pk) //! legacy key\n  name STRING\n}");
    assert.deepEqual(trailingTexts(field(root, "id")), ["//! legacy key"]);
    assert.deepEqual(trailingTexts(field(root, "name")), []);
  });

  it("finds a comment trailing the last field, which the grammar hoists out of the body", () => {
    const root = rootOf("schema s {\n  id INT\n  status STRING //? enum?\n}");
    assert.deepEqual(trailingTexts(field(root, "status")), ["//? enum?"]);
  });

  it("finds comments trailing mapping arrows, including the last one", () => {
    const root = rootOf(
      "mapping m {\n  source { a }\n  target { b }\n  x -> y //! lossy\n  -> z //? derive?\n}",
    );
    assert.deepEqual(trailingTexts(allDescendants(root, "map_arrow")[0]), ["//! lossy"]);
    assert.deepEqual(trailingTexts(allDescendants(root, "computed_arrow")[0]), ["//? derive?"]);
  });

  it("ignores a comment on its own line below a field", () => {
    const root = rootOf("schema s {\n  id INT\n  //! about the schema\n  name STRING\n}");
    assert.deepEqual(trailingTexts(field(root, "id")), []);
  });
});

describe("trailingCommentOwner", () => {
  it("returns null for a comment that trails no field, so it stays with the block", () => {
    const root = rootOf("schema s {\n  //! whole schema\n  id INT\n}");
    const [comment] = allDescendants(root, "warning_comment");
    assert.equal(trailingCommentOwner(comment), null);
  });

  it("credits a comment after a nested record's closing brace to the record, not its last child", () => {
    const root = rootOf("schema s {\n  addr record { street STRING } //! legacy\n}");
    const [comment] = allDescendants(root, "warning_comment");
    assert.equal(trailingCommentOwner(comment)?.namedChildren[0].text, "addr");
  });
});
