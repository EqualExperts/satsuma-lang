#!/usr/bin/env node
/**
 * Packages the VS Code extension with a git-derived, non-release identity.
 *
 * VS Code reads an extension's version only from package.json. Rather than
 * dirtying the tracked release manifest during local packaging, this script
 * builds in place, copies the packageable tree to a temporary directory, and
 * changes only that staging copy before invoking vsce.
 */

const { execFileSync } = require("child_process");
const { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("fs");
const os = require("os");
const path = require("path");

const extensionRoot = path.join(__dirname, "..");
const repoRoot = path.join(extensionRoot, "..", "..");
const outputPath = path.join(extensionRoot, "vscode-satsuma.vsix");

execFileSync("npm", ["run", "build"], { cwd: extensionRoot, stdio: "inherit" });

const buildVersion = execFileSync(
  process.execPath,
  [path.join(repoRoot, "scripts", "release-metadata.mjs"), "build-version"],
  { cwd: repoRoot, encoding: "utf8" },
).trim();
const stagingRoot = mkdtempSync(path.join(os.tmpdir(), "vscode-satsuma-pack-"));
const stagedExtension = path.join(stagingRoot, "vscode-satsuma");

try {
  cpSync(extensionRoot, stagedExtension, {
    recursive: true,
    filter: (source) => {
      const relativePath = path.relative(extensionRoot, source);
      const firstSegment = relativePath.split(path.sep)[0];
      return (
        firstSegment !== "node_modules" &&
        firstSegment !== ".turbo" &&
        !relativePath.endsWith(".vsix")
      );
    },
  });

  const stagedManifestPath = path.join(stagedExtension, "package.json");
  const stagedManifest = JSON.parse(readFileSync(stagedManifestPath, "utf8"));
  stagedManifest.version = buildVersion;
  writeFileSync(stagedManifestPath, `${JSON.stringify(stagedManifest, null, 2)}\n`);

  execFileSync("npx", ["--yes", "@vscode/vsce", "package", "--no-dependencies", "-o", outputPath], {
    cwd: stagedExtension,
    stdio: "inherit",
  });
  console.log(`package: vscode-satsuma.vsix carries build version ${buildVersion}`);
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}
