/**
 * canonical-uri-map.test.js — Map keyed by canonical file URIs.
 *
 * sl-ku3c: the server's parse-tree and validate-diagnostics caches were keyed
 * by the raw client URI while the workspace index keys are canonical. On
 * Windows the same file arrives as file:///c%3A/... (didOpen) and
 * file:///c:/... (canonical / workspace scan), so canonical lookups missed
 * open files: vizFullLineage skipped them, on-save sibling diagnostics never
 * published, and the watched-file "is it open?" skip never matched. These
 * cases pin the invariant that every URI spelling addresses one entry.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { CanonicalUriMap } = require("../dist/canonical-uri-map");

describe("CanonicalUriMap", () => {
  it("treats percent-encoded and plain drive-letter spellings as one key (sl-ku3c)", () => {
    const map = new CanonicalUriMap();
    map.set("file:///c%3A/proj/x.stm", "tree"); // VS Code didOpen spelling
    assert.equal(map.get("file:///c:/proj/x.stm"), "tree"); // canonical spelling
    assert.equal(map.has("file:///C:/proj/x.stm"), true); // pathToFileURL spelling
    assert.equal(map.size, 1, "all spellings must share one entry");
  });

  it("deletes through any spelling of the key", () => {
    // The watched-file handler deletes by the watcher's spelling while
    // didOpen stored under the client's — both must address the same entry.
    const map = new CanonicalUriMap();
    map.set("file:///C:/proj/x.stm", "tree");
    assert.equal(map.delete("file:///c%3A/proj/x.stm"), true);
    assert.equal(map.size, 0);
  });

  it("leaves non-file URIs untouched", () => {
    // untitled: documents have no canonical file form; raw-string keying
    // must keep working for them.
    const map = new CanonicalUriMap();
    map.set("untitled:Untitled-1", 42);
    assert.equal(map.get("untitled:Untitled-1"), 42);
  });
});
