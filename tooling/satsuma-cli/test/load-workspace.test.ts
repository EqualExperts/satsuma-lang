/**
 * load-workspace.test.ts — Unit tests for the shared CLI workspace loader
 *
 * `loadWorkspace` is the single point through which 18 of 21 CLI commands
 * resolve, parse, and index a workspace. The contract pinned here is what
 * those commands rely on:
 *
 *   • a successful load returns both the parsed files and the assembled
 *     `ExtractedWorkspace` index, with the same data shape an inline
 *     resolveInput / parseFile / buildIndex sequence used to produce;
 *   • a resolution failure (bad path, directory argument) is reported via
 *     a CommandError carrying the standard `Error resolving path '<arg>': …`
 *     message and EXIT_PARSE_ERROR;
 *   • `followImports: false` disables transitive import resolution so the
 *     loader can be used by tools that compare two single files;
 *   • a `pathArg` of `undefined` resolves the current working directory,
 *     mirroring how every CLI command treats a missing positional path.
 *
 * After sl-3291, error paths are observed by asserting on the thrown
 * CommandError directly — no process.exit stubbing required. The dispatcher
 * behaviour is covered in command-runner.test.ts.
 */

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { initParser } from "#src/parser.js";
import { loadWorkspace } from "#src/load-workspace.js";
import { CommandError, EXIT_PARSE_ERROR } from "#src/command-runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = resolve(__dirname, "../../../examples");
const WASM_PATH = resolve(__dirname, "../dist/tree-sitter-satsuma.wasm");

before(async () => {
  // The WASM parser must be initialised once before any parseFile call;
  // otherwise loadWorkspace explodes inside loadFiles.
  await initParser(WASM_PATH);
});

// ── happy path ───────────────────────────────────────────────────────────────

describe("loadWorkspace", () => {
  it("returns parsed files and an index whose schemas reflect the source", async () => {
    // A real example file with known schemas — verifies the round-trip
    // from path argument to a populated ExtractedWorkspace.
    const entry = resolve(EXAMPLES, "lib/common.stm");
    const { files, index } = await loadWorkspace(entry);

    assert.ok(files.length >= 1, "expected at least the entry file to be parsed");
    assert.ok(
      files.every((f) => f.tree && f.src),
      "every parsed file must carry a tree and source",
    );
    assert.ok(index.schemas.size > 0, "common.stm defines schemas — index should be populated");
  });

  it("treats an undefined pathArg as the current working directory", async () => {
    // CLI commands that omit `[path]` pass undefined; the loader must
    // mirror the historical `pathArg ?? "."` behaviour. We point cwd at
    // a directory and verify the rejection path includes the default
    // path string — proving the default was applied.
    const tmp = mkdtempSync(join(tmpdir(), "satsuma-loadws-"));
    writeFileSync(join(tmp, "x.stm"), "schema s { f string }\n");
    const prevCwd = process.cwd();
    try {
      process.chdir(tmp);
      await assert.rejects(
        () => loadWorkspace(undefined),
        (err: unknown) =>
          err instanceof CommandError &&
          err.code === EXIT_PARSE_ERROR &&
          /Error resolving path '\.':/.test(err.message),
      );
    } finally {
      process.chdir(prevCwd);
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("forwards followImports: false to skip transitive resolution", async () => {
    // The diff command needs to compare two files in isolation. Verifies
    // the option flows through to resolveInput and we get exactly one
    // file back even when the entry imports others.
    const entry = resolve(__dirname, "fixtures/import-entry.stm");
    const { files } = await loadWorkspace(entry, { followImports: false });
    assert.equal(files.length, 1, "followImports: false must yield only the entry file");
    assert.equal(files[0]!.filePath, entry);
  });
});

// ── failure modes ────────────────────────────────────────────────────────────

describe("loadWorkspace failure handling", () => {
  it("rejects directory arguments with the standard message and EXIT_PARSE_ERROR", async () => {
    // ADR-022: directory arguments are rejected by resolveInput. The
    // loader catches that and surfaces it as a CommandError with the
    // canonical message format every command shares.
    await assert.rejects(
      () => loadWorkspace(EXAMPLES),
      (err: unknown) =>
        err instanceof CommandError &&
        err.code === EXIT_PARSE_ERROR &&
        /^Error resolving path '/.test(err.message) &&
        /directory arguments are not supported/.test(err.message),
    );
  });

  it("includes the user-supplied path argument verbatim in the error message", async () => {
    // The previous inline sequences printed `Error resolving path: <msg>`
    // without the path itself, which made shell scripts harder to debug
    // when multiple commands were chained. Pinning the new format here
    // so a future drive-by change cannot silently regress it.
    const bogus = "/definitely/does/not/exist.stm";
    await assert.rejects(
      () => loadWorkspace(bogus),
      (err: unknown) => err instanceof CommandError && err.message.includes(`'${bogus}'`),
    );
  });
});
