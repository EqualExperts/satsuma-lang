/**
 * library.test.mjs — unit tests for the localStorage document library (sl-kd45).
 *
 * These pin the persistence semantics the playground's privacy/no-data-loss
 * story rests on: version-gated seeding that never overwrites a user-edited
 * document, per-document Restore original, global Reset, user-document
 * isolation from built-ins, the blank-slate starter, and guarded writes that
 * degrade to memory on quota failure.
 *
 * library.ts is browser TypeScript; this suite transpiles it once with esbuild
 * (already a build dependency) and imports the bundle via a data: URL, so the
 * tests run under plain `node --test` with no extra test framework. Storage is
 * injected (StorageLike), so a Map-backed stub stands in for localStorage.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

// ---------- Load the module under test ----------

/** Bundle src/client/library.ts in-memory and import it as an ES module. */
async function importLibraryModule() {
  const here = dirname(fileURLToPath(import.meta.url));
  const entry = join(here, "..", "..", "src", "client", "library.ts");
  const result = buildSync({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    write: false,
    platform: "neutral",
  });
  const code = Buffer.from(result.outputFiles[0].contents).toString("utf-8");
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

let lib; // the imported library module (DocumentLibrary, builtinUri, constants)

before(async () => {
  lib = await importLibraryModule();
});

// ---------- Test fixtures ----------

/** A Map-backed StorageLike stub standing in for window.localStorage. */
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

/** A StorageLike whose writes always throw, simulating an exhausted quota. */
function quotaExceededStorage() {
  return {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
}

/** Minimal two-document manifest where the entry imports its sibling. */
function manifestV1() {
  return {
    librarySeedVersion: "v1hash",
    examples: [
      {
        name: "demo/pipeline.stm",
        path: "demo/pipeline.stm",
        source: 'import { customers } from "./customers.stm"\nschema users { id INT }',
      },
      {
        name: "demo/customers.stm",
        path: "demo/customers.stm",
        source: "schema customers { id INT }",
      },
    ],
  };
}

/** A later corpus version: pipeline.stm changed upstream, one example added. */
function manifestV2() {
  const v2 = manifestV1();
  v2.librarySeedVersion = "v2hash";
  v2.examples[0].source = "schema users { id INT, email STRING }";
  v2.examples.push({
    name: "demo/orders.stm",
    path: "demo/orders.stm",
    source: "schema orders { id INT }",
  });
  return v2;
}

/** Construct a library over `storage` and open it with `manifest`. */
function openLibrary(storage, manifest, options = {}) {
  const library = new lib.DocumentLibrary({ storage, ...options });
  library.open(manifest);
  return library;
}

// ---------- Seeding ----------

describe("first-load seeding", () => {
  // The first visit (no seed-version key) must materialise the whole bundled
  // corpus as editable built-in entries — the picker and the workspace are
  // both fed from these.
  it("seeds every bundled example as an unedited built-in on first open", () => {
    const library = openLibrary(memoryStorage(), manifestV1());
    const docs = library.list();
    assert.equal(docs.length, 2);
    for (const doc of docs) {
      assert.equal(doc.kind, "builtin");
      assert.equal(doc.edited, false);
    }
    assert.deepEqual(
      docs.map((d) => d.uri).sort(),
      ["file:///examples/demo/customers.stm", "file:///examples/demo/pipeline.stm"],
    );
  });

  // The URI contract that makes cross-file lineage work: a sibling-relative
  // import authored in one library document must resolve (via WHATWG URL, the
  // same mechanism the isomorphic resolver uses) to another document's URI.
  it("derives URIs under which sibling-relative imports resolve to library entries", () => {
    const importer = lib.builtinUri("demo/pipeline.stm");
    const resolved = new URL("./customers.stm", importer).toString();
    assert.equal(resolved, lib.builtinUri("demo/customers.stm"));
  });
});

describe("re-seed semantics across visits", () => {
  // A returning visit with an unchanged corpus must leave the user's edits
  // exactly as persisted — reload survival is the headline AC.
  it("preserves an edited document across a reopen with the same seed version", () => {
    const storage = memoryStorage();
    const first = openLibrary(storage, manifestV1());
    const uri = lib.builtinUri("demo/pipeline.stm");
    first.updateSource(uri, "// my edit");

    const second = openLibrary(storage, manifestV1());
    assert.equal(second.get(uri).source, "// my edit");
    assert.equal(second.get(uri).edited, true);
  });

  // A corpus version bump must bring in new and updated built-ins…
  it("adds new examples and refreshes unedited ones on a version bump", () => {
    const storage = memoryStorage();
    openLibrary(storage, manifestV1());
    const upgraded = openLibrary(storage, manifestV2());

    assert.ok(upgraded.get(lib.builtinUri("demo/orders.stm")), "new example was added");
    assert.equal(
      upgraded.get(lib.builtinUri("demo/pipeline.stm")).source,
      "schema users { id INT, email STRING }",
      "unedited built-in picked up the upstream change",
    );
  });

  // …but never at the cost of user work: an edited built-in is untouchable by
  // seeding regardless of what changed upstream.
  it("never overwrites an edited document on a version bump", () => {
    const storage = memoryStorage();
    const first = openLibrary(storage, manifestV1());
    const uri = lib.builtinUri("demo/pipeline.stm");
    first.updateSource(uri, "// precious user work");

    const upgraded = openLibrary(storage, manifestV2());
    assert.equal(upgraded.get(uri).source, "// precious user work");
  });
});

describe("blank-slate starter fallback", () => {
  // With no manifest (fetch failed) and nothing persisted, the library must
  // still hold something renderable so the canvas is never blank.
  it("seeds the bundled starter when the manifest is unavailable and storage is empty", () => {
    const library = openLibrary(memoryStorage(), null);
    const docs = library.list();
    assert.equal(docs.length, 1);
    assert.equal(docs[0].name, lib.STARTER_NAME);
    assert.equal(docs[0].kind, "user");
    assert.ok(docs[0].source.includes("mapping"), "starter contains a renderable mapping");
  });

  // A manifest outage on a RETURNING visit must not inject a starter next to
  // the user's existing documents.
  it("does not add the starter when documents already exist", () => {
    const storage = memoryStorage();
    openLibrary(storage, manifestV1());
    const reopened = openLibrary(storage, null);
    assert.ok(reopened.list().every((d) => d.name !== lib.STARTER_NAME));
  });
});

// ---------- Editing, user documents ----------

describe("editing and user documents", () => {
  // The edited flag is what re-seed protection keys off, so it must flip on
  // the first real change and only for built-ins.
  it("marks a built-in edited on its first source change", () => {
    const library = openLibrary(memoryStorage(), manifestV1());
    const uri = lib.builtinUri("demo/pipeline.stm");
    library.updateSource(uri, "// changed");
    assert.equal(library.get(uri).edited, true);
  });

  // User documents are a distinct kind: no original exists, so they must never
  // enter the edited/restore lifecycle.
  it("adds user documents under file:///user/ with kind 'user'", () => {
    const library = openLibrary(memoryStorage(), manifestV1());
    const doc = library.addUserDocument("mine.stm", "schema s { id INT }");
    assert.equal(doc.kind, "user");
    assert.ok(doc.uri.startsWith(lib.USER_URI_BASE));
    library.updateSource(doc.uri, "// edited");
    assert.equal(library.get(doc.uri).edited, false);
  });

  // Two opened files with the same name must coexist — the second gets a
  // suffixed name so the URI (the library key) stays unique.
  it("uniquifies duplicate user-document names", () => {
    const library = openLibrary(memoryStorage(), manifestV1());
    const a = library.addUserDocument("pipeline.stm", "// a");
    const b = library.addUserDocument("pipeline.stm", "// b");
    assert.equal(a.name, "pipeline.stm");
    assert.equal(b.name, "pipeline-2.stm");
    assert.notEqual(a.uri, b.uri);
  });

  // documents() is the workspace feed: it must expose every library entry in
  // the { uri, source } shape the model pipeline takes.
  it("exposes the whole library as workspace documents", () => {
    const library = openLibrary(memoryStorage(), manifestV1());
    library.addUserDocument("mine.stm", "schema s { id INT }");
    const docs = library.documents();
    assert.equal(docs.length, 3);
    for (const doc of docs) {
      assert.deepEqual(Object.keys(doc).sort(), ["source", "uri"]);
    }
  });
});

// ---------- Restore and Reset ----------

describe("Restore original and global Reset", () => {
  // Per-document restore must surgically revert ONE document from the bundled
  // manifest, leaving other edits alone.
  it("restoreOriginal re-copies one example's pristine source and clears its edited flag", () => {
    const library = openLibrary(memoryStorage(), manifestV1());
    const target = lib.builtinUri("demo/pipeline.stm");
    const other = lib.builtinUri("demo/customers.stm");
    library.updateSource(target, "// edit A");
    library.updateSource(other, "// edit B");

    const restored = library.restoreOriginal(target);
    assert.equal(restored.edited, false);
    assert.match(restored.source, /^import \{ customers \}/);
    assert.equal(library.get(other).source, "// edit B", "other edits untouched");
  });

  // Restore is meaningless for user documents (no bundled original) — it must
  // refuse rather than guess.
  it("restoreOriginal is a no-op for user documents", () => {
    const library = openLibrary(memoryStorage(), manifestV1());
    const doc = library.addUserDocument("mine.stm", "// original");
    assert.equal(library.restoreOriginal(doc.uri), undefined);
    assert.equal(library.get(doc.uri).source, "// original");
  });

  // Global Reset is the explicit escape hatch: the library becomes exactly the
  // bundled corpus again — edits gone, user documents gone, session cleared.
  it("reset restores the bundled corpus, drops user documents, and clears the session", () => {
    const storage = memoryStorage();
    const library = openLibrary(storage, manifestV1());
    library.updateSource(lib.builtinUri("demo/pipeline.stm"), "// edit");
    library.addUserDocument("mine.stm", "// mine");
    library.setActiveUri(lib.builtinUri("demo/pipeline.stm"));
    library.setBuffer("// edit");

    assert.equal(library.reset(), true);
    const docs = library.list();
    assert.equal(docs.length, 2, "user document was dropped");
    assert.ok(docs.every((d) => d.kind === "builtin" && !d.edited));
    assert.match(library.get(lib.builtinUri("demo/pipeline.stm")).source, /^import/);
    assert.equal(library.activeUri, null);
    assert.equal(library.buffer, null);
  });
});

// ---------- Session state ----------

describe("session state persistence", () => {
  // The reload-restore AC: active document, buffer, view-mode, and the editor
  // collapsed state must all round-trip through storage.
  it("round-trips active URI, buffer, view-mode, and editor-collapsed state", () => {
    const storage = memoryStorage();
    const library = openLibrary(storage, manifestV1());
    const uri = lib.builtinUri("demo/pipeline.stm");
    library.setActiveUri(uri);
    library.setBuffer("// mid-edit");
    library.setViewMode("single");
    library.setEditorCollapsed(true);

    const reopened = openLibrary(storage, manifestV1());
    assert.equal(reopened.activeUri, uri);
    assert.equal(reopened.buffer, "// mid-edit");
    assert.equal(reopened.viewMode, "single");
    assert.equal(reopened.editorCollapsed, true);
  });

  // A corrupted persisted library (e.g. an interrupted write) must not brick
  // the playground: open() starts clean and re-seeds.
  it("recovers from corrupt persisted library JSON by re-seeding", () => {
    const storage = memoryStorage();
    storage.setItem("satsuma-playground:library", "{not json");
    const library = openLibrary(storage, manifestV1());
    assert.equal(library.list().length, 2);
  });
});

// ---------- Quota failure ----------

describe("guarded writes", () => {
  // The quota guard from the ticket design: a throwing storage must surface a
  // non-blocking warning AND leave the in-memory library fully functional.
  it("reports persist errors and keeps working from memory when writes throw", () => {
    let errors = 0;
    const library = openLibrary(quotaExceededStorage(), manifestV1(), {
      onPersistError: () => errors++,
    });
    assert.ok(errors > 0, "the failed seed write was reported");
    assert.equal(library.list().length, 2, "in-memory library still holds the corpus");

    const uri = lib.builtinUri("demo/pipeline.stm");
    library.updateSource(uri, "// edit survives in memory");
    assert.equal(library.get(uri).source, "// edit survives in memory");
  });
});
