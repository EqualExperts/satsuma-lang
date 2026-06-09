/**
 * command-loader.test.ts — Unit tests for src/command-loader.ts
 *
 * Guards the gh-265 regression: the CLI entry point must hand `import()` a
 * file:// URL, never a bare OS path. On Windows, Node's ESM loader rejects a
 * bare absolute path (it reads the drive letter as a URL scheme), which crashed
 * the CLI at startup before any command could run.
 *
 * The crash is Windows-only and cannot be reproduced on the POSIX CI host, so we
 * pin the platform-independent invariant that prevents it: the specifier is a
 * file:// URL that round-trips back to the requested on-disk path.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { commandModuleSpecifier } from "#src/command-loader.js";

describe("commandModuleSpecifier", () => {
  it("returns a file:// URL, not a bare path", () => {
    // The core gh-265 invariant: a bare absolute path is what Node's ESM loader
    // rejects on Windows. Requiring the file:// scheme is what keeps it valid.
    const spec = commandModuleSpecifier("/opt/satsuma/dist", "commands/summary.js");
    assert.ok(spec.startsWith("file://"), `expected a file:// URL, got: ${spec}`);
  });

  it("round-trips back to the joined on-disk path", () => {
    // The URL must point at exactly the module we asked for — encoding the
    // directory and relative module path without corrupting them.
    const dir = "/opt/satsuma/dist";
    const rel = "commands/lineage.js";
    const spec = commandModuleSpecifier(dir, rel);
    assert.equal(fileURLToPath(spec), join(dir, rel));
  });

  it("percent-encodes characters that are unsafe in a URL path", () => {
    // Directories can contain spaces (e.g. Windows "Program Files"); a raw
    // path concatenated into a URL would break, so the result must be encoded
    // yet still decode back to the original path.
    const dir = "/opt/My Tools/satsuma";
    const spec = commandModuleSpecifier(dir, "commands/fmt.js");
    assert.ok(!spec.includes(" "), "spaces must be percent-encoded in the URL");
    assert.equal(fileURLToPath(spec), join(dir, "commands/fmt.js"));
  });
});
