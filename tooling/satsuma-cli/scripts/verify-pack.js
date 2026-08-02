#!/usr/bin/env node

import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..");
const tarballPath = join(cliRoot, "satsuma-cli.tgz");

if (!existsSync(tarballPath)) {
  throw new Error(`verify-pack: tarball not found at ${tarballPath}`);
}

const contents = execFileSync("tar", ["-tzf", tarballPath], {
  cwd: cliRoot,
  encoding: "utf8",
});

// Any tarball entry containing '..' would be rejected by npm at install time with
// TAR_ENTRY_ERROR. This happens when a file: dependency is bundled as a symlink
// pointing outside the package directory. Catch it here so the build fails fast.
const dotDotEntries = contents.split("\n").filter((e) => e.includes(".."));
if (dotDotEntries.length > 0) {
  throw new Error(
    `verify-pack: tarball contains entries with '..' in their paths — ` +
      `npm will reject these on install.\n` +
      dotDotEntries.map((e) => `  ${e}`).join("\n"),
  );
}

console.log("verify-pack: no '..' paths in tarball entries");

const requiredEntries = [
  "package/dist/index.js",
  "package/dist/tree-sitter-satsuma.wasm",
  "package/dist/web-tree-sitter.wasm",
];

for (const entry of requiredEntries) {
  if (!contents.includes(`${entry}\n`) && !contents.endsWith(entry)) {
    throw new Error(`verify-pack: required tarball entry missing: ${entry}`);
  }
}

console.log("verify-pack: tarball contains CLI entrypoint and both WASM assets");

// Verify the CLI entrypoint has the executable bit set inside the tarball.
const verbose = execFileSync("tar", ["-tvf", tarballPath, "package/dist/index.js"], {
  cwd: cliRoot,
  encoding: "utf8",
});
if (!/^-rwx/.test(verbose)) {
  throw new Error(
    `verify-pack: dist/index.js is not executable in the tarball. ` +
      `Permissions: ${verbose.split(/\s+/)[0]}`,
  );
}

console.log("verify-pack: dist/index.js has executable permission");
