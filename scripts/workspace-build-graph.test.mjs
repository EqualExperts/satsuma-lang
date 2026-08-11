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
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_ROOT = join(REPO_ROOT, "tooling");

/**
 * The set of files git tracks, as repo-relative POSIX paths (forward slashes),
 * or `null` when this is not a git checkout. Used to keep the code scan
 * independent of build state: `dist/` and the untracked `src/generated/` trees
 * a build leaves behind would otherwise be walked and read, so what the scan
 * sees would depend on whether anyone had just built. `git ls-files` honours
 * `.gitignore` *and* its exceptions, so the committed `satsuma-core/src/generated/`
 * contract is still scanned while `satsuma-cli/src/generated/` (gitignored)
 * is not (mbt-14vo, FP-C).
 */
function readTrackedFiles() {
  try {
    const out = execSync("git ls-files", { cwd: REPO_ROOT, encoding: "utf8" });
    return new Set(out.split("\n").filter(Boolean));
  } catch {
    return null;
  }
}
const TRACKED_FILES = readTrackedFiles();

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
  // Filter out untracked build output (dist/, gitignored src/generated/, etc.)
  // so a stale build under a scanned subtree cannot change what the scan sees.
  // See TRACKED_FILES for why this is `git ls-files` rather than a directory-name
  // denylist (the committed satsuma-core/src/generated/ exception has to survive).
  if (TRACKED_FILES === null) return files;
  return files.filter((f) => TRACKED_FILES.has(toPosixPath(relative(REPO_ROOT, f))));
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
    //    Covers `from "@satsuma/core"`, `require("satsuma-cli/x")`, the
    //    side-effect-only `import "@satsuma/viz"`, and the resolver spellings a
    //    bare `require()` match misses — `require.resolve("pkg/asset")` (global,
    //    or aliased to a local also named `require`) and the direct
    //    `createRequire(import.meta.url)("pkg")` form (mbt-14vo, missed form 2).
    //    A resolver reached into a sibling's built output needs ordering just as
    //    a plain import does. An aliased call on a differently-named binding
    //    (`const r = createRequire(...); r("pkg")`) is not matched: the binding
    //    name is not visible here, and in this repo those aliases resolve
    //    third-party packages, never a sibling.
    const specifier = new RegExp(
      `(?:from|require\\.resolve\\(|require\\(|import\\(|import|createRequire\\([^)]*\\)\\()\\s*["']${escapeForRegExp(
        name,
      )}(?:/[^"']*)?["']`,
    );
    // 2. Relative escape into the sibling, excluding its committed subtrees.
    const intoOutput = new RegExp(`\\.\\./${directory}(?!/(?:${committed})[/"'])(?:["'/]|$)`, "m");
    // 3. A standalone string literal equal to the sibling's directory name,
    //    which is how a path assembled from segments looks:
    //    `join(root, "..", "tree-sitter-satsuma")`. Where the assembled path
    //    lands is not visible here, so the literal counts.
    //
    //    A negative lookbehind excludes the one shape that is *not* a reach:
    //    the sibling's directory name used as a custom-element tag or selector
    //    (`document.createElement("satsuma-viz")`, `page.locator("satsuma-viz")`).
    //    Those are DOM API calls, not path assembly, and the packages that write
    //    the tag are the ones that already import the component (mbt-14vo, FP-B).
    const bareDirectoryName = new RegExp(
      `(?<!createElement\\(|querySelector\\(|querySelectorAll\\(|locator\\(|customElements\\.define\\()["']${directory}["']`,
    );

    if (specifier.test(text) || intoOutput.test(text) || bareDirectoryName.test(text)) {
      reached.add(name);
    }
  }
  return reached;
}

function escapeForRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** Repo-relative POSIX path (forward slashes) for matching against `git ls-files`. */
function toPosixPath(repoRelative) {
  return repoRelative.split(/[\\/]/).join("/");
}

/**
 * Parse JSON with `//` line comments (JSONC), tracking string state so a `//` in
 * a string value — notably a URL like the `$schema` field — is not mistaken
 * for a comment. Shared by the turbo.json and tsconfig.json readers. Block
 * comments are not handled because no file in this repo uses them; if one
 * appears, `JSON.parse` throws rather than silently mis-parsing.
 */
function parseJsonc(source) {
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
  return JSON.parse(stripped);
}

/**
 * Names of sibling packages a package's `tsconfig.json` reaches into through a
 * `compilerOptions.paths` mapping, *without* that sibling being declared.
 *
 * A `paths` key that names a sibling (`"@satsuma/viz-model": [...]`) makes the
 * sibling resolvable at typecheck time, so its build must be ordered ahead of
 * this package's `test:typecheck` — and `test:typecheck` orders siblings only
 * through `^build`, which consults the manifest. The mapping's target decides
 * whether it is built or committed output, but a sibling resolved by name at
 * typecheck is a build-graph edge either way; declaring it is always safe, so the
 * detector flags the name unconditionally. No tsconfig in the repo maps to a
 * sibling today (the only `paths` keys are a self-alias in satsuma-cli and a
 * third-party `web-tree-sitter` alias in satsuma-lsp), so this currently catches
 * nothing — it is hardening against the form the code scan cannot see, because a
 * tsconfig is JSON, not a CODE_EXTENSIONS file (mbt-14vo, missed form 1).
 *
 * @param {{name: string, dir: string}} pkg
 * @param {Map<string, any>} packages
 * @returns {Set<string>} sibling package names resolved by `paths` undeclared
 */
function siblingsReachedByTsconfig(pkg, packages) {
  const tsconfigPath = join(pkg.dir, "tsconfig.json");
  if (!existsSync(tsconfigPath)) return new Set();
  try {
    const paths = parseJsonc(readFileSync(tsconfigPath, "utf8"))?.compilerOptions?.paths ?? {};
    return siblingsReachedByPaths(paths, packages, pkg.name);
  } catch {
    // An unparseable tsconfig is out of scope for this graph guard; the
    // typecheck task itself would fail far more loudly than this test.
    return new Set();
  }
}

/**
 * Pure core of {@link siblingsReachedByTsconfig}: the sibling package names a
 * `compilerOptions.paths` mapping resolves. Extracted so the detector can be
 * mutation-tested against a constructed mapping without writing files.
 *
 * @param {Record<string, unknown>} paths  tsconfig `compilerOptions.paths`
 * @param {Map<string, any>} packages
 * @param {string} selfName
 * @returns {Set<string>}
 */
function siblingsReachedByPaths(paths, packages, selfName) {
  const reached = new Set();
  for (const key of Object.keys(paths)) {
    // A `paths` key is a module specifier. A scoped package name is
    // `@scope/name` (optionally `/subpath`), so the leading two segments form
    // the package name; an unscoped name is the first segment alone. Splitting on
    // every `/` would reduce `@satsuma/core` to `@satsuma` and miss every
    // scoped sibling.
    const segments = key.split("/");
    const resolved = key.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
    if (packages.has(resolved) && resolved !== selfName) reached.add(resolved);
  }
  return reached;
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
 * heavily to explain the task graph — so it goes through `parseJsonc` rather
 * than `JSON.parse`.
 */
function readGlobalDependencies(turboJsonPath) {
  return parseJsonc(readFileSync(turboJsonPath, "utf8")).globalDependencies ?? [];
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

/**
 * The sibling-build escape a script body contains, or `null` if none.
 *
 * The R4 chains came in two spellings — `npm --prefix ../sibling run build` and
 * `cd ../sibling && npm test`. Both are caught by requiring a sibling *name*
 * after the `../` (so a reach to the repo root, `--prefix ../..` or `cd ../..`,
 * is not misreported as a sibling escape — mbt-14vo, FP-A). Two more npm
 * spellings that build a sibling without `--prefix` are also caught: the
 * workspace flag in either position (`npm -w ../sibling run build`,
 * `npm run build --workspace=../sibling`) and a subshell `((cd ../sibling &&
 * ...))` (mbt-14vo, missed form 3).
 */
function siblingBuildEscapeIn(scriptBody) {
  // `--prefix ../<name>` or `--workspace[= ]../<name>` or `-w ../<name>`: a
  // path flag whose target is a sibling (one level up, then a name — not
  // `..` again, which is the repo root).
  const prefix = /(?:--prefix|-w|--workspace)=?\s*\.\.\/(?!\.\.)(?:[A-Za-z0-9_.-]+)/;
  // `cd ../<name>`: same sibling-vs-root distinction. Anchored to a command
  // boundary so a `cd` inside prose is not matched.
  const cdSibling = /(?:^|&&|;|\|\||\||\()\s*cd\s+\.\.\/(?!\.\.)(?:[A-Za-z0-9_.-]+)/;
  return prefix.exec(scriptBody)?.[0] ?? cdSibling.exec(scriptBody)?.[0] ?? null;
}

/**
 * The first manifest entry point that references built output (`dist/`) while
 * the package has no `build` script, or `null`. A package with no build script
 * has no output that can go stale — unless one of its entry points points at one,
 * in which case the missing build script is itself the bug. The check covers
 * `exports`, `main`, and `bin`: a package can declare its entry via any of the
 * three, and the original invariant inspected only `exports` (mbt-14vo, missed
 * form 4).
 */
function builtEntryWithoutBuildScript(manifest) {
  if (manifest.scripts?.build !== undefined) return null;
  const candidates = [
    ["exports", JSON.stringify(manifest.exports ?? {})],
    ["main", typeof manifest.main === "string" ? manifest.main : ""],
    // `bin` may be a string or a map of name → path; stringify both shapes.
    ["bin", JSON.stringify(manifest.bin ?? "")],
  ];
  for (const [field, serialized] of candidates) {
    if (/dist\//.test(serialized)) return field;
  }
  return null;
}

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
      record(siblingsReachedByTsconfig(pkg, packages), "its tsconfig.json paths");
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
  // silently divergent copy of the graph back into the repo. The guard also
  // catches the `npm -w`/`--workspace` spellings and a subshell `(cd ../sibling
  // && ...)`, and a reach to the repo root (`../..`) is deliberately *not* an
  // offence — see `siblingBuildEscapeIn`.
  for (const pkg of packages.values()) {
    it(`${pkg.name} has no script that builds or tests a sibling package directly`, () => {
      const offenders = Object.entries(pkg.manifest.scripts ?? {})
        .filter(([, body]) => siblingBuildEscapeIn(body) !== null)
        .map(([name, body]) => [name, siblingBuildEscapeIn(body)]);
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
  // script has no output that can go stale — unless an entry point points at one,
  // in which case the missing build script is itself the bug, and no amount of
  // dependency declaration will fix it. @satsuma/scenario-gen is deliberately
  // such a package (sl-puky: plain ESM with JSDoc types, no build step). The
  // check covers `exports`, `main`, and `bin` — a package can declare its entry
  // via any of the three (mbt-14vo, missed form 4).
  for (const pkg of packages.values()) {
    if (pkg.manifest.scripts?.build !== undefined) continue;
    it(`${pkg.name} has no build script, and declares no built entry point`, () => {
      const offender = builtEntryWithoutBuildScript(pkg.manifest);
      assert.equal(
        offender,
        null,
        `${pkg.name} declares \`${offender}\` from dist/ but has no build script to produce it (cbdr-xgy5)`,
      );
    });
  }
});

// ── Detection-form unit tests (mbt-14vo) ─────────────────────────────────────
// Each new or refined detector is exercised against a constructed instance of
// the form it claims to catch, so the hardening cannot be silently undone by a
// future refactor that drops the branch. These do not touch the repo: they call
// the pure detectors directly with hand-built inputs.
describe("workspace-build-graph detection forms (mbt-14vo hardening)", () => {
  // A two-package workspace used by the text-based detectors: `@satsuma/core`
  // (dir satsuma-core) is a sibling the consumer might reach into.
  const twoPackages = new Map([
    [
      "@satsuma/core",
      { name: "@satsuma/core", dirName: "satsuma-core", dir: "tooling/satsuma-core" },
    ],
    ["@satsuma/viz", { name: "@satsuma/viz", dirName: "satsuma-viz", dir: "tooling/satsuma-viz" }],
  ]);

  // Missed form 2: resolver spellings a bare `require()` match misses.
  it("siblingsReachedBy catches require.resolve and createRequire into a sibling", () => {
    const cases = [
      `const p = require.resolve("@satsuma/core/asset");`,
      `const p = require.resolve("@satsuma/core");`,
      `const r = createRequire(import.meta.url); const m = createRequire(import.meta.url)("@satsuma/core");`,
    ];
    for (const text of cases) {
      assert.deepEqual(
        [...siblingsReachedBy(text, twoPackages, "@satsuma/viz")],
        ["@satsuma/core"],
        `expected resolver form to be detected: ${text}`,
      );
    }
  });

  // Missed form 2, residual gap: a resolver reached through an *alias named
  // something other than `require`* is not matched — the binding name is not
  // visible to a text scan. Pinned as the documented boundary of the detector.
  it("siblingsReachedBy does not match a resolver aliased to a non-require name", () => {
    const text = `const r = createRequire(import.meta.url); const m = r("@satsuma/core");`;
    assert.deepEqual(
      [...siblingsReachedBy(text, twoPackages, "@satsuma/viz")],
      [],
      "an aliased resolver call is a known residual gap, not a detected reach",
    );
  });

  // FP-B: the sibling's directory name used as a custom-element tag or selector
  // is a DOM API call, not path assembly, and must not be reported as a reach.
  it("siblingsReachedBy ignores a sibling dir-name used as a custom-element tag", () => {
    const cases = [
      `const el = document.createElement("satsuma-viz");`,
      `document.querySelector("satsuma-viz");`,
      `page.locator("satsuma-viz").isVisible();`,
      `customElements.define("satsuma-viz", SzViz);`,
    ];
    for (const text of cases) {
      assert.deepEqual(
        [...siblingsReachedBy(text, twoPackages, "@satsuma/core")],
        [],
        `DOM usage of the tag should not read as a build-graph reach: ${text}`,
      );
    }
  });

  // FP-B counterpart: the same dir-name as a path-assembly segment *is* a reach.
  it("siblingsReachedBy still catches a sibling dir-name used as a path segment", () => {
    const text = `const dir = join(root, "..", "satsuma-core");`;
    assert.deepEqual(
      [...siblingsReachedBy(text, twoPackages, "@satsuma/viz")],
      ["@satsuma/core"],
      "an assembled path into the sibling must still be detected",
    );
  });

  // Missed form 1: a tsconfig `paths` key that names a sibling makes it resolvable
  // at typecheck time, so the build graph must order it — declare it.
  it("siblingsReachedByPaths flags a sibling named in tsconfig compilerOptions.paths", () => {
    const paths = {
      "@satsuma/core": ["../satsuma-core/src"],
      "@satsuma/viz-model/*": ["../viz-model/*"],
    };
    assert.deepEqual(
      [...siblingsReachedByPaths(paths, twoPackages, "@satsuma/viz")],
      ["@satsuma/core"],
      "a paths key naming a sibling is a build-graph edge the code scan cannot see",
    );
  });

  // Missed form 3 / FP-A: the sibling-script guard catches the R4 spellings and
  // the npm workspace spellings, but not a reach to the repo root.
  it("siblingBuildEscapeIn catches sibling builds and ignores repo-root reaches", () => {
    const offenders = [
      `npm --prefix ../satsuma-core run build`,
      `cd ../satsuma-lsp && npm test`,
      `npm -w ../satsuma-core run build`,
      `npm run build --workspace=../satsuma-core`,
      `(cd ../satsuma-core && npm test)`,
    ];
    for (const body of offenders) {
      assert.ok(
        siblingBuildEscapeIn(body) !== null,
        `expected sibling-build escape to be caught: ${body}`,
      );
    }
    const roots = [
      `npm --prefix ../.. run build`,
      `cd ../.. && npm test`,
      `npm run build --workspace=../..`,
    ];
    for (const body of roots) {
      assert.equal(
        siblingBuildEscapeIn(body),
        null,
        `a reach to the repo root is not a sibling escape: ${body}`,
      );
    }
  });

  // Missed form 4: a package with no build script must not declare a built entry
  // via exports, main, OR bin.
  it("builtEntryWithoutBuildScript flags dist in exports, main, or bin", () => {
    assert.equal(
      builtEntryWithoutBuildScript({ scripts: {}, main: "./dist/index.js" }),
      "main",
      "main pointing at dist/ with no build script is the bug",
    );
    assert.equal(
      builtEntryWithoutBuildScript({ scripts: {}, bin: { satsuma: "./dist/cli.js" } }),
      "bin",
      "bin pointing at dist/ with no build script is the bug",
    );
    assert.equal(
      builtEntryWithoutBuildScript({ scripts: {}, exports: { ".": "./dist/index.js" } }),
      "exports",
      "exports pointing at dist/ with no build script is the bug",
    );
    assert.equal(
      builtEntryWithoutBuildScript({ scripts: {}, main: "./src/index.js" }),
      null,
      "an entry pointing at source is fine without a build script",
    );
    assert.equal(
      builtEntryWithoutBuildScript({ scripts: { build: "tsc" }, main: "./dist/index.js" }),
      null,
      "a built entry is fine when a build script exists",
    );
  });

  // FP-C: the code scan reads only git-tracked files, so a build that drops
  // untracked output into a scanned subtree cannot change what the scan sees.
  it("the code scan ignores untracked build output and honours the committed exception", () => {
    assert.ok(TRACKED_FILES !== null, "this guard requires a git checkout");
    // satsuma-cli/src/generated/ is gitignored build output; a build leaves
    // agent-reference.ts there, and the scan must never read it.
    assert.ok(
      !TRACKED_FILES.has("tooling/satsuma-cli/src/generated/agent-reference.ts"),
      "gitignored build output must not be scanned",
    );
    // The committed exception: satsuma-core/src/generated/cst-types.ts IS
    // tracked, so the scan still sees the contract a build cannot reproduce.
    assert.ok(
      TRACKED_FILES.has("tooling/satsuma-core/src/generated/cst-types.ts"),
      "the committed generated contract must still be scanned",
    );
  });
});
