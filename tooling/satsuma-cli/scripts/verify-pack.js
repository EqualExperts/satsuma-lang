#!/usr/bin/env node

import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..");
const tarballPath = join(cliRoot, "satsuma-cli.tgz");

const readManifest = (packageDir) => JSON.parse(readFileSync(join(packageDir, "package.json")));
const expectedArtifactVersion = process.env.EXPECTED_ARTIFACT_VERSION;

if (!existsSync(tarballPath)) {
  throw new Error(`verify-pack: tarball not found at ${tarballPath}`);
}

const contents = execFileSync("tar", ["-tzf", tarballPath], {
  cwd: cliRoot,
  encoding: "utf8",
});

const packedManifest = JSON.parse(
  execFileSync("tar", ["-xzOf", tarballPath, "package/package.json"], {
    cwd: cliRoot,
    encoding: "utf8",
  }),
);
if (expectedArtifactVersion && packedManifest.version !== expectedArtifactVersion) {
  throw new Error(
    `verify-pack: manifest version is ${packedManifest.version}, ` +
      `expected ${expectedArtifactVersion}`,
  );
}
console.log(`verify-pack: manifest carries build version ${packedManifest.version}`);

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

// ── The bundled dependency closure ──
//
// `npm install -g ./satsuma-cli.tgz` must need nothing from a registry:
// @satsuma/core is a private workspace package no registry could supply, and the
// tarball's declared range for it (`*`) would otherwise let npm resolve some
// unrelated public package instead. npm fills a bundled dependency from
// node_modules and silently omits any it cannot find there — which is precisely
// what npm workspaces' hoisting caused (feature 42, R2) — so assert presence
// rather than trust it.
//
// Checked against the manifest, not a hardcoded list, so adding a bundled
// dependency cannot leave this check behind. Core's own runtime dependencies are
// included: they ship nested beneath it and are just as load-bearing.

const cliManifest = readManifest(cliRoot);
const coreManifest = readManifest(join(cliRoot, "..", "satsuma-core"));

const bundledClosure = [
  ...(cliManifest.bundleDependencies ?? []).map((name) => `package/node_modules/${name}`),
  ...Object.keys(coreManifest.dependencies ?? {}).map(
    (name) => `package/node_modules/@satsuma/core/node_modules/${name}`,
  ),
];

for (const packageDir of bundledClosure) {
  const manifestEntry = `${packageDir}/package.json`;
  if (!contents.includes(`${manifestEntry}\n`) && !contents.endsWith(manifestEntry)) {
    throw new Error(
      `verify-pack: bundled dependency missing from tarball: ${packageDir}. ` +
        "npm omits a bundled dependency it cannot find in node_modules — check scripts/pack.js staged it.",
    );
  }
}

console.log(
  `verify-pack: all ${bundledClosure.length} bundled dependencies are present in the tarball`,
);

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
