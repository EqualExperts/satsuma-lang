#!/usr/bin/env node

// Packages satsuma-cli for distribution, producing satsuma-cli.tgz.
//
// The CLI ships as a self-contained tarball: the packages it needs at runtime are
// packed *inside* it, so `npm install -g ./satsuma-cli.tgz` needs nothing from a
// registry. @satsuma/core in particular is a private workspace package that no
// registry could supply.
//
// It packs from a staging copy in a temp directory rather than in place, because
// `npm pack` inside a workspace member does not produce a self-contained tarball
// (feature 42, R2). Two workspace-specific behaviours get in the way:
//
//   1. npm resolves ignore rules from the *workspace root*, so the repo-wide
//      .gitignore ('**/*.wasm', '**/*.js.map', '**/generated') strips the CLI's
//      own build output out of its tarball.
//   2. `bundleDependencies` are filled from the package's own node_modules, and
//      hoisting means they are not there — npm silently omits every one it cannot
//      find, yielding a tarball that installs cleanly and then fails at runtime.
//
// A staging directory outside the repository has neither problem: npm sees an
// ordinary standalone package whose node_modules holds exactly the closure this
// script put there. scripts/verify-pack.js then asserts that closure survived.
//
// Run via `npm run pack` locally or from CI. Both must use this script so that
// the tarball is produced identically in every environment.

import { execFileSync } from "child_process";
import { createRequire } from "module";
import {
  cpSync,
  mkdtempSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..");
const satsumaCoreSource = join(cliRoot, "..", "satsuma-core");

// Two resolution contexts, because a dependency may be hoisted to the workspace
// root *or* nested inside the package that needs it. Each package's own
// dependencies must therefore be resolved from that package's own directory.
const requireFromCli = createRequire(join(cliRoot, "package.json"));
const requireFromCore = createRequire(join(satsumaCoreSource, "package.json"));

const readManifest = (packageDir) => JSON.parse(readFileSync(join(packageDir, "package.json")));

/** Copies a package tree, leaving any nested node_modules behind. */
function copyPackage(sourceDir, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(sourceDir, destination, {
    recursive: true,
    dereference: true,
    // Nested dependencies are staged explicitly below, so a stale nested tree in
    // the working copy can never ride along into the tarball. Matched on the path
    // *below* sourceDir: a hoisted dependency's own directory sits inside the
    // root node_modules, so testing the absolute path would reject every source
    // this function is asked to copy.
    filter: (source) => !relative(sourceDir, source).split(/[\\/]/).includes("node_modules"),
  });
}

/** Resolves an installed package's directory by name, wherever npm placed it. */
function resolvePackageDir(require, name) {
  // Every package has a package.json; not every one exports it, so fall back to
  // walking up from the resolved entry point when the exports map hides it.
  try {
    return dirname(require.resolve(`${name}/package.json`));
  } catch {
    let directory = dirname(require.resolve(name));
    while (!existsSync(join(directory, "package.json"))) {
      const parent = dirname(directory);
      if (parent === directory) throw new Error(`pack: cannot locate ${name}'s package directory`);
      directory = parent;
    }
    return directory;
  }
}

if (!existsSync(satsumaCoreSource)) {
  throw new Error(`pack: satsuma-core not found at ${satsumaCoreSource}`);
}

const stagingRoot = mkdtempSync(join(tmpdir(), "satsuma-cli-pack-"));
const stagedPackage = join(stagingRoot, "satsuma-cli");
const stagedModules = join(stagedPackage, "node_modules");

try {
  // --- Step 1: stage the package itself ---------------------------------------
  // `files` in package.json decides what npm pack then takes from this copy.

  copyPackage(cliRoot, stagedPackage);
  console.log(`pack: staged satsuma-cli → ${stagedPackage}`);

  // --- Step 2: stage @satsuma/core from the workspace, not from node_modules ---
  // node_modules/@satsuma/core is a symlink into the workspace; npm pack follows
  // it and writes tarball entries containing '..', which npm rejects on install
  // with TAR_ENTRY_ERROR. A real directory copy avoids that.

  const stagedCore = join(stagedModules, "@satsuma", "core");
  copyPackage(satsumaCoreSource, stagedCore);
  console.log("pack: staged @satsuma/core");

  // --- Step 3: stage core's own runtime dependencies beneath it ----------------
  // Nested rather than flat, so core resolves them at runtime exactly as it does
  // in the workspace, and so a dependency of core that the CLI does not itself
  // declare (`yaml`, needed by @satsuma/core/config) still ships.

  for (const name of Object.keys(readManifest(satsumaCoreSource).dependencies ?? {})) {
    copyPackage(resolvePackageDir(requireFromCore, name), join(stagedCore, "node_modules", name));
    console.log(`pack: staged @satsuma/core → ${name}`);
  }

  // --- Step 4: stage the CLI's remaining bundled dependencies ------------------

  const bundled = readManifest(cliRoot).bundleDependencies ?? [];
  for (const name of bundled.filter((name) => name !== "@satsuma/core")) {
    copyPackage(resolvePackageDir(requireFromCli, name), join(stagedModules, name));
    console.log(`pack: staged ${name}`);
  }

  // --- Step 5: pack the staging copy ------------------------------------------
  // --ignore-scripts because the staging copy exists only to be archived: the
  // build already ran in the real package directory (see the `pack` npm script).

  execFileSync("npm", ["pack", "--ignore-scripts"], { cwd: stagedPackage, stdio: "inherit" });

  // --- Step 6: move it back under a stable filename ---------------------------

  const [generatedTarball] = readdirSync(stagedPackage).filter(
    (f) => f.startsWith("satsuma-cli-") && f.endsWith(".tgz"),
  );

  if (!generatedTarball) {
    throw new Error("pack: npm pack did not produce a satsuma-cli-*.tgz file");
  }

  renameSync(join(stagedPackage, generatedTarball), join(cliRoot, "satsuma-cli.tgz"));
  console.log(`pack: ${generatedTarball} → satsuma-cli.tgz`);
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}

// --- Step 7: verify the tarball ----------------------------------------------

execFileSync("node", ["scripts/verify-pack.js"], { cwd: cliRoot, stdio: "inherit" });
