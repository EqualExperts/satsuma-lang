/**
 * Tests for canonicalizeFileUri and canonical workspace-index keys (sl-akz6,
 * gh-274).
 *
 * The same file can arrive under different `file://` spellings: VS Code
 * clients send `file:///c%3A/...` (lowercase drive, percent-encoded colon)
 * while Node's pathToFileURL produces `file:///C:/...`. The index must key
 * both to ONE canonical entry, or every definition in an opened file is
 * counted twice and flagged as a duplicate.
 */
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const {
  canonicalizeFileUri,
  createWorkspaceIndex,
  indexFile,
  removeFile,
  getImportReachableUris,
} = require("../dist/workspace-index");
const { initTestParser, parse } = require("./helper");

before(async () => {
  await initTestParser();
});

describe("canonicalizeFileUri", () => {
  // The core gh-274 collision: both Windows spellings must map to one key.
  it("maps the scan spelling and the VS Code client spelling of a Windows path to the same URI", () => {
    const scanSpelling = canonicalizeFileUri("file:///C:/Users/bob/ws/a.stm");
    const clientSpelling = canonicalizeFileUri("file:///c%3A/Users/bob/ws/a.stm");
    assert.equal(scanSpelling, clientSpelling);
  });

  // POSIX paths have no drive letter and typically no escapes — the common
  // macOS/Linux case must be a byte-for-byte no-op.
  it("leaves an ordinary POSIX file URI unchanged", () => {
    const uri = "file:///Users/bob/ws/pipeline.stm";
    assert.equal(canonicalizeFileUri(uri), uri);
  });

  // Percent-encoding differences beyond the drive colon (e.g. spaces) must
  // also collapse to one canonical encoding.
  it("normalizes equivalent percent-encodings of the same path", () => {
    const encoded = canonicalizeFileUri("file:///ws/My%20Docs/a.stm");
    const reencoded = canonicalizeFileUri(encoded);
    assert.equal(reencoded, encoded, "canonical form must be a fixed point");
  });

  // Canonicalization is a file-URI concern only; other schemes (untitled:
  // buffers, virtual docs) must pass through untouched.
  it("returns non-file URIs unchanged", () => {
    assert.equal(canonicalizeFileUri("untitled:Untitled-1"), "untitled:Untitled-1");
  });

  it("returns unparseable input unchanged instead of throwing", () => {
    assert.equal(canonicalizeFileUri("not a uri"), "not a uri");
  });
});

describe("workspace index canonical keys", () => {
  // The actual bug mechanism: didOpen re-indexing the already-scanned file
  // under the alternate spelling must REPLACE its entries, not duplicate them.
  it("indexes one file arriving under two URI spellings as a single entry", () => {
    const idx = createWorkspaceIndex();
    const src = "schema orders { id UUID }";
    indexFile(idx, "file:///C:/ws/a.stm", parse(src));
    indexFile(idx, "file:///c%3A/ws/a.stm", parse(src));

    assert.equal(idx.indexedFiles.size, 1, "one file must occupy one index slot");
    const defs = idx.definitions.get("orders") ?? [];
    assert.equal(defs.length, 1, "one definition must not be double-counted");
  });

  // removeFile must accept either spelling, or stale entries survive a close.
  it("removes a file's entries when removal uses a different spelling than indexing", () => {
    const idx = createWorkspaceIndex();
    indexFile(idx, "file:///C:/ws/a.stm", parse("schema orders { id UUID }"));
    removeFile(idx, "file:///c%3A/ws/a.stm");
    assert.equal(idx.indexedFiles.size, 0);
    assert.equal(idx.definitions.size, 0);
  });

  // Import reachability seeds from a client-supplied URI; a raw spelling must
  // still reach the canonical keys the index stores.
  it("computes import reachability when the entry URI uses an alternate spelling", () => {
    const idx = createWorkspaceIndex();
    indexFile(
      idx,
      "file:///C:/ws/a.stm",
      parse(`import { orders } from "b.stm"\nschema customers { id UUID }`),
    );
    indexFile(idx, "file:///C:/ws/b.stm", parse("schema orders { id UUID }"));

    const reachable = getImportReachableUris("file:///c%3A/ws/a.stm", idx);
    assert.equal(reachable.size, 2, "entry file and its import must both be reachable");
  });
});
