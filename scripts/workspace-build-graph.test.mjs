/**
 * workspace-build-graph.test.mjs — the cross-package build order must stay
 * derivable from the manifests.
 *
 * Turborepo orders tasks by `dependsOn: ["^build"]`, which reads one thing and
 * one thing only: the `dependencies`/`devDependencies` of each workspace
 * package. So the graph is correct exactly when every package that *reaches
 * into* a sibling — imports its compiled output, copies a file out of its
 * directory, reads its fixtures — also declares it. An undeclared reach is
 * invisible until the day the two tasks happen to run in the wrong order, and
 * then it surfaces as a stale artifact or a "cannot find module" from a
 * directory that plainly exists.
 *
 * This file replaces `tooling/satsuma-cli/test/prebuild-wiring.test.ts`, which
 * asserted the same property against the mechanism feature 42's R4 deleted:
 * that a package's `prebuild` script named an `npm --prefix ../sibling run
 * build` step for each sibling its tests imported. The property is unchanged —
 * "a package cannot depend on a sibling's build output without saying so" —
 * only the place it has to be said has moved, from a script chain to a
 * dependency list. The original regression it guards is cbdr-xgy5.
 *
 * What this file owns: the shape of the dependency graph Turborepo reads. It
 * asserts nothing about what any task does, and nothing about turbo.json —
 * turbo.json's job is to say *that* dependencies build first, and this file's
 * job is to keep the dependency list it consults honest.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_ROOT = join(REPO_ROOT, "tooling");

/**
 * Directories inside a package that hold code capable of reaching a sibling.
 * Deliberately not the whole package directory: `dist/` is generated output
 * (a bundle inlines its dependencies' sources, so scanning it would report
 * every transitive package as a direct reference) and `node_modules/` is the
 * install tree.
 */
const SCANNED_SUBDIRECTORIES = ["src", "test", "scripts", "type-tests"];

/** File extensions treated as code for the purposes of the scan. */
const CODE_EXTENSIONS = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"];

/**
 * Subdirectories of a sibling package that hold *committed* files. A relative
 * path continuing into one of these is reading something git already provides,
 * so it implies no build ordering — three packages read satsuma-cli's
 * `test/fixtures/` to assert coverage parity against the same `.stm` files, and
 * none of them needs the CLI compiled to do it. Only a reach into a sibling's
 * *output* has to be ordered, and that is the distinction this list draws.
 */
const COMMITTED_SUBDIRECTORIES = ["test", "src", "queries", "type-tests", "fixtures"];

/**
 * Reaches that are real but must not be declared, with the reason why.
 *
 * The only entry is the grammar's CST-contract generator, which *writes*
 * `tooling/satsuma-core/src/generated/cst-types.ts`. Turborepo's graph has no
 * way to say "produces a file inside another package", and the ordering that
 * relationship actually needs — grammar before core — is already expressed by
 * satsuma-core declaring tree-sitter-satsuma. Declaring the reverse edge as
 * well would make the two packages mutually dependent and turbo would reject
 * the graph outright.
 *
 * @type {Map<string, Set<string>>} package name → sibling names it may reach undeclared
 */
const PERMITTED_UNDECLARED_REACHES = new Map([["tree-sitter-satsuma", new Set(["@satsuma/core"])]]);

// ── Reading the workspace ────────────────────────────────────────────────────

/**
 * Every workspace package, keyed by its declared name.
 *
 * @returns {Map<string, {name: string, dir: string, dirName: string, manifest: any}>}
 */
function readWorkspacePackages() {
  const packages = new Map();
  for (const dirName of readdirSync(WORKSPACE_ROOT)) {
    const dir = join(WORKSPACE_ROOT, dirName);
    const manifestPath = join(dir, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    packages.set(manifest.name, { name: manifest.name, dir, dirName, manifest });
  }
  return packages;
}

/** Every declared dependency name of a package, production and development alike. */
function declaredDependencies(manifest) {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);
}

/** Absolute paths of every code file under a package's scanned subdirectories. */
function codeFilesOf(pkg) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        if (entry !== "node_modules") walk(path);
      } else if (CODE_EXTENSIONS.some((extension) => entry.endsWith(extension))) {
        files.push(path);
      }
    }
  };
  for (const subdirectory of SCANNED_SUBDIRECTORIES) {
    const path = join(pkg.dir, subdirectory);
    if (existsSync(path)) walk(path);
  }
  // Build scripts that sit at the package root rather than under scripts/ —
  // vscode-satsuma's esbuild.js is the one that matters, and it reaches into
  // two siblings.
  for (const entry of readdirSync(pkg.dir)) {
    const path = join(pkg.dir, entry);
    if (statSync(path).isFile() && CODE_EXTENSIONS.some((e) => entry.endsWith(e))) {
      files.push(path);
    }
  }
  return files;
}

// ── Detecting a reach into a sibling ─────────────────────────────────────────

/**
 * Names of sibling workspace packages whose *build output* `text` reaches into.
 *
 * Three forms are recognised, which between them cover every real case in this
 * repository. Prose is deliberately not one of them: a comment or a
 * user-facing message naming a package (vscode-satsuma tells the user to
 * `npm install -g satsuma-cli`) is not a build dependency, and treating it as
 * one would make this test punish documentation.
 *
 *   1. A module specifier — `from "@satsuma/core"`, `require("satsuma-cli/x")`,
 *      or a side-effect-only `import "@satsuma/viz";`. Always counts: a bare
 *      specifier resolves through the sibling's `exports`, which for every built
 *      package here points into `dist/`. The side-effect form is included
 *      because it is idiomatic for a custom element imported only to register
 *      itself, which is exactly what vscode-satsuma's webview does with
 *      @satsuma/viz — a declared dependency today, so this catches nothing
 *      right now, and is the one spelling of a real edge that would otherwise
 *      be invisible.
 *   2. A relative path escaping into a sibling directory —
 *      `resolve(__dirname, "../../satsuma-cli/dist/index.js")` — *unless* it
 *      continues into one of COMMITTED_SUBDIRECTORIES, which is a read of
 *      something git provides rather than something a build produces.
 *   3. A string literal that *is* a sibling's directory name, which is how a
 *      path assembled from segments looks: `join(root, "..", "tree-sitter-satsuma")`.
 *      Counts, because where the assembled path lands is not visible here.
 *
 * @param {string} text            source of one file, or one npm script string
 * @param {Map<string, any>} packages  every workspace package, by name
 * @param {string} selfName       the package doing the reaching, never reported
 * @returns {Set<string>}         package names whose output is reached
 */
function siblingsReachedBy(text, packages, selfName) {
  const reached = new Set();
  const committed = COMMITTED_SUBDIRECTORIES.map(escapeForRegExp).join("|");

  for (const { name, dirName } of packages.values()) {
    if (name === selfName) continue;
    const directory = escapeForRegExp(dirName);

    // 1. Module specifier: the bare name, or the name followed by a subpath.
    const specifier = new RegExp(
      `(?:from|require\\(|import\\(|import)\\s*["']${escapeForRegExp(name)}(?:/[^"']*)?["']`,
    );
    // 2. Relative escape into the sibling, excluding its committed subtrees.
    const intoOutput = new RegExp(`\\.\\./${directory}(?!/(?:${committed})[/"'])(?:["'/]|$)`, "m");
    // 3. A standalone string literal equal to the sibling's directory name.
    const bareDirectoryName = new RegExp(`["']${directory}["']`);

    if (specifier.test(text) || intoOutput.test(text) || bareDirectoryName.test(text)) {
      reached.add(name);
    }
  }
  return reached;
}

function escapeForRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * Repo-relative paths inside a *sibling package's committed tree* that `text`
 * reads — the reaches siblingsReachedBy() deliberately ignores.
 *
 * These imply no build ordering, but they are still inputs, and Turborepo hashes
 * only a package's own directory. A read of a file it does not hash is a cache
 * hit waiting to happen, which is why the third invariant below exists.
 *
 * @param {string} text
 * @param {Map<string, any>} packages
 * @param {string} selfName
 * @returns {Set<string>} e.g. "tooling/satsuma-cli/test/fixtures"
 */
function committedSiblingPathsReadBy(text, packages, selfName) {
  const paths = new Set();
  const committed = COMMITTED_SUBDIRECTORIES.map(escapeForRegExp).join("|");

  for (const { name, dirName } of packages.values()) {
    if (name === selfName) continue;
    const pattern = new RegExp(
      `\\.\\./${escapeForRegExp(dirName)}/((?:${committed})(?:/[A-Za-z0-9_.-]+)*)`,
      "g",
    );
    for (const match of text.matchAll(pattern)) {
      paths.add(`tooling/${dirName}/${match[1]}`);
    }
  }
  return paths;
}

/**
 * turbo.json's `globalDependencies`, parsed.
 *
 * turbo.json is JSONC — Turborepo accepts `//` comments and this repo uses them
 * heavily to explain the task graph. `JSON.parse` cannot read it, and stripping
 * `//` to end-of-line naively would truncate the `$schema` URL, so comments are
 * removed with the string state tracked. Block comments are not handled because
 * the file does not use them; if one appears, `JSON.parse` throws rather than
 * silently mis-parsing.
 */
function readGlobalDependencies(turboJsonPath) {
  const source = readFileSync(turboJsonPath, "utf8");
  let stripped = "";
  let inString = false;
  for (let i = 0; i < source.length; i++) {
    const character = source[i];
    if (inString) {
      // A backslash escapes the next character, including a closing quote.
      if (character === "\\") {
        stripped += character + (source[i + 1] ?? "");
        i++;
        continue;
      }
      if (character === '"') inString = false;
      stripped += character;
      continue;
    }
    if (character === '"') {
      inString = true;
      stripped += character;
      continue;
    }
    if (character === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      stripped += "\n";
      continue;
    }
    stripped += character;
  }
  return JSON.parse(stripped).globalDependencies ?? [];
}

/**
 * True when `path` falls under one of turbo.json's `globalDependencies` globs.
 *
 * Only the trailing-wildcard forms this repo actually uses are understood
 * (`a/b/**`, `a/b/*`, and an exact path). A glob shape it cannot interpret is
 * treated as *not* covering the path — erring towards a failing test rather than
 * a silently unhashed input.
 */
function coveredByGlobalDependencies(path, globalDependencies) {
  return globalDependencies.some((pattern) => {
    const prefix = pattern.replace(/\/\*\*?$/, "");
    return path === pattern || path === prefix || path.startsWith(`${prefix}/`);
  });
}

// ── The invariants ───────────────────────────────────────────────────────────

const packages = readWorkspacePackages();

describe("the workspace dependency graph Turborepo orders builds by", () => {
  // The core R4 invariant. Every reach into a sibling must appear in the
  // manifest, because the manifest is the only thing `^build` consults. A
  // failure here is not a style complaint: it names a build ordering Turborepo
  // cannot know about, which will hold by luck until it doesn't.
  for (const pkg of packages.values()) {
    it(`${pkg.name} declares every sibling package its code reaches into`, () => {
      const declared = declaredDependencies(pkg.manifest);
      const permitted = PERMITTED_UNDECLARED_REACHES.get(pkg.name) ?? new Set();
      const needsDeclaring = (name) => !declared.has(name) && !permitted.has(name);
      const scriptText = Object.values(pkg.manifest.scripts ?? {}).join("\n");

      /** @type {Map<string, string>} package name → where it was first seen */
      const undeclared = new Map();
      const record = (names, where) => {
        for (const name of names) {
          if (needsDeclaring(name) && !undeclared.has(name)) undeclared.set(name, where);
        }
      };

      record(siblingsReachedBy(scriptText, packages, pkg.name), "its npm scripts");
      for (const file of codeFilesOf(pkg)) {
        record(
          siblingsReachedBy(readFileSync(file, "utf8"), packages, pkg.name),
          relative(REPO_ROOT, file),
        );
      }

      assert.deepEqual(
        [...undeclared],
        [],
        `${pkg.name} reaches into ${[...undeclared]
          .map(([name, where]) => `${name} (${where})`)
          .join(", ")} without declaring it. ` +
          `Turborepo derives build order from dependencies/devDependencies only, ` +
          `so an undeclared sibling's build is not ordered ahead of this package's.`,
      );
    });
  }

  // Everything a task reads must be something Turborepo hashes. The invariant
  // above is about *ordering* and is satisfied by a declared dependency; this
  // one is about *cache correctness*, and a declared dependency is only one of
  // the two ways to satisfy it.
  //
  // Turborepo hashes a package's own directory, its dependency tasks' hashes,
  // and globalDependencies. A read of a sibling's committed file that is covered
  // by none of those is not a slow build — it is a cache HIT over an input that
  // changed, reported as a pass. This was live for one commit: @satsuma/viz and
  // @satsuma/viz-backend read satsuma-cli/test/fixtures/ in their coverage-parity
  // suites, and editing a fixture left both suites cached and green.
  //
  // Verified before being trusted: with the fixtures absent from
  // globalDependencies, appending a line to
  // tooling/satsuma-cli/test/fixtures/ambiguous-scope.stm left
  // `turbo run test --filter=@satsuma/viz` reporting 6/6 cached.
  for (const pkg of packages.values()) {
    it(`${pkg.name} reads no sibling's committed files that Turborepo does not hash`, () => {
      const globalDependencies = readGlobalDependencies(join(REPO_ROOT, "turbo.json"));
      const declared = declaredDependencies(pkg.manifest);
      const scriptText = Object.values(pkg.manifest.scripts ?? {}).join("\n");

      /** @type {Map<string, string>} unhashed path → where it was first read */
      const unhashed = new Map();
      const record = (paths, where) => {
        for (const path of paths) {
          // A declared dependency covers it: turbo folds that package's task
          // hash — which is derived from its whole directory — into this one's.
          const owner = [...packages.values()].find((p) =>
            path.startsWith(`tooling/${p.dirName}/`),
          );
          if (owner && declared.has(owner.name)) continue;
          if (coveredByGlobalDependencies(path, globalDependencies)) continue;
          if (!unhashed.has(path)) unhashed.set(path, where);
        }
      };

      record(committedSiblingPathsReadBy(scriptText, packages, pkg.name), "its npm scripts");
      for (const file of codeFilesOf(pkg)) {
        record(
          committedSiblingPathsReadBy(readFileSync(file, "utf8"), packages, pkg.name),
          relative(REPO_ROOT, file),
        );
      }

      assert.deepEqual(
        [...unhashed],
        [],
        `${pkg.name} reads ${[...unhashed]
          .map(([path, where]) => `${path} (from ${where})`)
          .join(", ")}, which Turborepo does not hash for this package. ` +
          `Either declare the owning package as a dependency, or add the path to ` +
          `globalDependencies in turbo.json — otherwise a change to it serves a ` +
          `cache hit and this package's suite passes without re-running.`,
      );
    });
  }

  // The chains R4 deleted, kept deleted. `npm --prefix ../sibling run build`
  // and `cd ../sibling && npm test` are how the build order came to be written
  // down in eleven places at once; reintroducing one would put a second,
  // silently divergent copy of the graph back into the repo.
  for (const pkg of packages.values()) {
    it(`${pkg.name} has no script that builds or tests a sibling package directly`, () => {
      const offenders = Object.entries(pkg.manifest.scripts ?? {}).filter(([, body]) =>
        // `--prefix ..` covers `npm --prefix ../satsuma-core run build`;
        // `cd ..` covers `cd ../satsuma-lsp && npm test`.
        /--prefix\s+\.\.|(?:^|&&|;|\|)\s*cd\s+\.\./.test(body),
      );
      assert.deepEqual(
        offenders,
        [],
        `${pkg.name} reaches into a sibling package from a script. ` +
          `Declare the dependency and let \`turbo run <task>\` order it instead ` +
          `(feature 42, R4).`,
      );
    });
  }

  // Carried over from prebuild-wiring.test.ts. A package with no `build`
  // script has no output that can go stale — unless it exports one, in which
  // case the missing build script is itself the bug, and no amount of
  // dependency declaration will fix it. @satsuma/scenario-gen is deliberately
  // such a package (sl-puky: plain ESM with JSDoc types, no build step).
  for (const pkg of packages.values()) {
    if (pkg.manifest.scripts?.build !== undefined) continue;
    it(`${pkg.name} has no build script, and exports no built output`, () => {
      assert.doesNotMatch(
        JSON.stringify(pkg.manifest.exports ?? {}),
        /dist\//,
        `${pkg.name} exports from dist/ but has no build script to produce it (cbdr-xgy5)`,
      );
    });
  }
});
