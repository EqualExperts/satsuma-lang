/**
 * Parity + browser-portability tests for the isomorphic import resolver in
 * workspace-index.ts (feature 33 §1a).
 *
 * The resolver was rewritten from a Node `path`/`url` round-trip to a single
 * WHATWG `URL` call so it runs unchanged in the browser. These tests pin two
 * properties:
 *
 *   1. **Parity** — for `file://` URIs the new resolver produces byte-for-byte
 *      the same result the old `fileURLToPath → resolve → pathToFileURL` chain
 *      did, so CLI/LSP/server behaviour is unchanged. The "old" output is
 *      recomputed here from Node's own `path`/`url` as the oracle.
 *   2. **Cross-runtime resolution** — virtual `file:///` URIs (the form the
 *      browser playground uses) resolve cross-file, and the resolved URI matches
 *      what an index keyed by `pathToFileURL` would contain.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");
const {
  createWorkspaceIndex,
  indexFile,
  getImportReachableUris,
  buildImportSuggestion,
  _resolverTestInternals,
} = require("../dist/workspace-index");
const { initTestParser, parse } = require("./helper");

const { resolveImportUri } = _resolverTestInternals;

/**
 * The previous implementation, reproduced verbatim as the parity oracle. Any
 * divergence between this and `resolveImportUri` is a regression in the
 * file-based (CLI/LSP/server) contract.
 */
function legacyResolveImportUri(importerUri, pathText) {
  try {
    const importerPath = fileURLToPath(importerUri);
    const importerDir = path.dirname(importerPath);
    const resolved = path.resolve(importerDir, pathText);
    return pathToFileURL(resolved).toString();
  } catch {
    return null;
  }
}

describe("resolveImportUri parity with the legacy path-based resolver", () => {
  // Each case is a file:// importer + an import path string in a distinct
  // resolution shape. The resolver must match the Node path/url oracle for all
  // of them, since those are the inputs the CLI and LSP feed it today.
  const importer = "file:///workspace/crm/pipeline.stm";
  const cases = [
    { label: "bare sibling name", pathText: "customers.stm" },
    { label: "explicit ./ relative", pathText: "./customers.stm" },
    { label: "../ parent-directory relative", pathText: "../shared/types.stm" },
    { label: "deep ../../ relative", pathText: "../../root.stm" },
    { label: "absolute path", pathText: "/workspace/billing/invoices.stm" },
    { label: "nested subdirectory", pathText: "./sub/dir/leaf.stm" },
  ];

  for (const { label, pathText } of cases) {
    it(`matches the legacy output for ${label}`, () => {
      assert.equal(
        resolveImportUri(importer, pathText),
        legacyResolveImportUri(importer, pathText),
      );
    });
  }

  // Percent-encoding parity: a space in the path must survive identically. The
  // old chain decoded via fileURLToPath then re-encoded via pathToFileURL; the
  // URL constructor must yield the same encoded form so indexedFiles keys match.
  it("matches the legacy output when the path contains a space", () => {
    const pathText = "./order items.stm";
    assert.equal(
      resolveImportUri(importer, pathText),
      legacyResolveImportUri(importer, pathText),
    );
  });

  // A malformed importer URI must degrade to null rather than throw, so a
  // stray buffer can never crash import-graph traversal.
  it("returns null for an unparseable importer URI", () => {
    assert.equal(resolveImportUri("not a uri", "./x.stm"), null);
  });
});

describe("getImportReachableUris with virtual file:/// URIs (browser form)", () => {
  // The browser playground indexes documents under virtual file:/// URIs rooted
  // at a library base. This proves an import between two such documents resolves
  // and the importee is reported reachable — the foundation of in-browser
  // cross-file lineage, with no filesystem involved.
  it("resolves a cross-file import between virtual library documents", async () => {
    await initTestParser();
    const base = "file:///library/";
    const entryUri = `${base}crm/pipeline.stm`;
    const importeeUri = `${base}crm/customers.stm`;

    const index = createWorkspaceIndex();
    indexFile(
      index,
      entryUri,
      parse('import { customers } from "./customers.stm"\n'),
    );
    indexFile(index, importeeUri, parse("schema customers { id INT }\n"));

    const reachable = getImportReachableUris(entryUri, index);

    assert.ok(reachable.has(entryUri), "entry file is always reachable");
    assert.ok(
      reachable.has(importeeUri),
      "imported sibling resolves to the library-keyed URI",
    );
  });

  // An import to a path with no matching indexed document must be skipped, not
  // throw — this is the single-file fallback the playground relies on when a
  // buffer references something outside the library.
  it("skips an import that resolves to an unindexed URI", async () => {
    await initTestParser();
    const entryUri = "file:///library/solo.stm";
    const index = createWorkspaceIndex();
    indexFile(
      index,
      entryUri,
      parse('import { missing } from "./nowhere.stm"\n'),
    );

    const reachable = getImportReachableUris(entryUri, index);

    assert.deepEqual([...reachable], [entryUri]);
  });
});

describe("buildImportSuggestion relative-path computation", () => {
  // The quick-fix must emit an explicitly-relative path. A sibling file is the
  // common case and must gain a leading ./ so it is not read as a bare-name import.
  it("emits a ./-prefixed path for a sibling file", () => {
    const suggestion = buildImportSuggestion(
      "file:///ws/a.stm",
      "Customer",
      "file:///ws/b.stm",
    );
    assert.equal(suggestion, 'import { Customer } from "./b.stm"');
  });

  // A definition in a parent directory must produce ../ segments, matching the
  // POSIX path.relative semantics the old implementation provided.
  it("emits ../ segments for a definition in an ancestor directory", () => {
    const suggestion = buildImportSuggestion(
      "file:///ws/crm/a.stm",
      "Customer",
      "file:///ws/shared/b.stm",
    );
    assert.equal(suggestion, 'import { Customer } from "../shared/b.stm"');
  });

  // Unparseable URIs must fall back to the placeholder rather than throw, so the
  // quick-fix degrades gracefully.
  it("falls back to a placeholder path when a URI is unparseable", () => {
    const suggestion = buildImportSuggestion("::bad::", "X", "::also-bad::");
    assert.equal(suggestion, 'import { X } from "..."');
  });
});
