/**
 * workspace.test.ts — Unit tests for workspace file resolution.
 *
 * The workspace boundary is the entry .stm file plus its transitive imports.
 * These tests pin directory rejection, import traversal, missing-import
 * recovery, and namespace-qualified definitions at that boundary.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolveInput } from "#src/workspace.js";
import { loadWorkspace } from "#src/load-workspace.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = resolve(__dirname, "../../../examples");
const FIXTURES = resolve(__dirname, "fixtures");
const IMPORT_ENTRY = resolve(FIXTURES, "import-entry.stm");
const IMPORT_CHAIN = resolve(FIXTURES, "import-chain-entry.stm");
const IMPORT_SOURCE = resolve(FIXTURES, "import-source.stm");
const IMPORT_TRANSITIVE = resolve(FIXTURES, "import-transitive.stm");
const IMPORT_MISSING = resolve(FIXTURES, "import-missing.stm");

describe("resolveInput", () => {
  it("rejects directory arguments with the ADR-022 workspace-boundary message", async () => {
    // Directories used to be ambiguous workspace roots; the file-only boundary
    // must remain explicit so import traversal is deterministic.
    await assert.rejects(
      () => resolveInput(EXAMPLES),
      (err: Error) => {
        assert.match(err.message, /directory arguments are not supported/);
        assert.match(err.message, /entry file and its transitive imports/);
        return true;
      },
    );
  });

  it("returns only the entry file when followImports is false", async () => {
    // Commands with custom input semantics need a way to resolve exactly one
    // file without pulling in the whole import graph.
    const result = await resolveInput(IMPORT_ENTRY, { followImports: false });

    assert.deepEqual(result, [IMPORT_ENTRY]);
  });

  it("follows direct imports by default and returns a sorted file list", async () => {
    // The common CLI path should include imported definitions in a stable order
    // so command output does not depend on traversal timing.
    const result = await resolveInput(IMPORT_ENTRY);

    assert.deepEqual(result, [IMPORT_ENTRY, IMPORT_SOURCE].sort());
  });

  it("follows transitive imports across the workspace graph", async () => {
    // Platform entry files rely on import chains rather than duplicating every
    // referenced file at the top level.
    const result = await resolveInput(IMPORT_CHAIN);

    assert.deepEqual(result, [IMPORT_CHAIN, IMPORT_SOURCE, IMPORT_TRANSITIVE].sort());
  });

  it("warns but keeps the entry file when an import target is missing", async () => {
    // Missing imports are a recoverable workspace condition: commands should
    // still operate on the files that can be parsed.
    const stderr: string[] = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      const result = await resolveInput(IMPORT_MISSING);
      assert.deepEqual(result, [IMPORT_MISSING]);
    } finally {
      process.stderr.write = originalWrite;
    }

    assert.match(stderr.join(""), /does-not-exist\.stm/);
  });
});

describe("resolveInput physical-file deduplication (sl-8zyr)", () => {
  // Two import spellings that reach the same physical file must load it once,
  // otherwise validate reports false duplicate-definition errors for every
  // schema the file defines. Fixtures are created in a temp dir because the
  // scenarios depend on filesystem identity (casing, symlinks), not content.

  /** Minimal schema so the imported file parses as a real definition. */
  const LIB_SOURCE = "schema shared {\n  id: UUID\n}\n";

  /** Build an entry file importing the given paths, in a fresh temp dir. */
  function makeWorkspace(importPaths: string[]): { dir: string; entry: string } {
    const dir = mkdtempSync(join(tmpdir(), "satsuma-ws-"));
    const entry = join(dir, "entry.stm");
    const imports = importPaths.map((p) => `import { shared } from "${p}"`).join("\n");
    writeFileSync(join(dir, "lib.stm"), LIB_SOURCE);
    writeFileSync(entry, `${imports}\n`);
    return { dir, entry };
  }

  it("loads a file once when imported under two casings on a case-insensitive filesystem", async (t) => {
    const { dir, entry } = makeWorkspace(["lib.stm", "LIB.stm"]);
    try {
      // Only meaningful where "LIB.stm" actually aliases "lib.stm" (macOS and
      // Windows defaults); on case-sensitive filesystems it is a missing import.
      if (!existsSync(join(dir, "LIB.stm"))) {
        t.skip("filesystem is case-sensitive — no alias to deduplicate");
        return;
      }
      const result = await resolveInput(entry);
      assert.equal(result.length, 2, `expected entry + one lib, got: ${result.join(", ")}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads a file once when imported both directly and through a symlink", async (t) => {
    const { dir, entry } = makeWorkspace(["lib.stm", "lib-link.stm"]);
    try {
      try {
        symlinkSync(join(dir, "lib.stm"), join(dir, "lib-link.stm"));
      } catch {
        t.skip("symlinks not supported on this platform");
        return;
      }
      const result = await resolveInput(entry);
      assert.equal(result.length, 2, `expected entry + one lib, got: ${result.join(", ")}`);
      // The surviving path must be the physical file, not the symlink spelling.
      assert.ok(
        result.includes(realpathSync.native(join(dir, "lib.stm"))),
        "canonical lib.stm path missing from workspace",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("loadWorkspace", () => {
  it("preserves namespace-qualified imported schemas at the workspace boundary", async () => {
    // Import following is not enough by itself; the loaded index must preserve
    // namespace qualification so downstream commands can resolve scoped names.
    const { files, index } = await loadWorkspace(IMPORT_ENTRY);

    assert.deepEqual(files.map((file) => file.filePath), [IMPORT_ENTRY, IMPORT_SOURCE].sort());
    assert.ok(index.schemas.has("src::customers"));
    assert.ok(index.schemas.has("mart::dim_customers"));
    assert.ok(index.mappings.has("build dim_customers"));
  });
});
