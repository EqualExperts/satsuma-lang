/**
 * workspace.ts — Satsuma workspace file resolution
 *
 * Resolves a .stm entry file to the set of files in its import graph.
 * Directory arguments are rejected — the workspace boundary is defined
 * by the entry file and its transitive imports (see ADR-022).
 */

import { stat } from "fs/promises";
import { readFileSync, realpathSync, statSync } from "fs";
import { dirname, resolve } from "path";
import { extractImports } from "@satsuma/core";
import { parseSource } from "./parser.js";

/**
 * Canonicalize a path to its physical identity on disk.
 *
 * `path.resolve` alone is not enough to deduplicate files: on the
 * case-insensitive filesystems that macOS and Windows default to,
 * "lib.stm" and "LIB.stm" resolve to different strings but the same
 * physical file, and a symlink resolves to a different string than its
 * target. `realpathSync.native` collapses both — it follows symlinks and
 * returns the on-disk casing — so keying visited-sets on its result loads
 * each physical file exactly once (sl-8zyr).
 *
 * Falls back to the input path when realpath fails (e.g. the file
 * disappeared between stat and canonicalization).
 */
function canonicalPath(filePath: string): string {
  try {
    return realpathSync.native(filePath);
  } catch {
    return filePath;
  }
}

/**
 * Error message shown when a directory is passed where a .stm file is expected.
 * Guides users toward the file-based workspace model defined by ADR-022.
 */
const DIRECTORY_NOT_SUPPORTED =
  "directory arguments are not supported — provide a .stm file instead. " +
  "The workspace is defined by the entry file and its transitive imports.";

/**
 * Follow import declarations from a single .stm file, collecting all
 * transitively imported file paths. Uses a visited set for cycle safety;
 * paths are canonicalized first so case-aliased or symlinked imports of
 * the same physical file are visited (and returned) only once.
 *
 * Missing import targets are warned on stderr but do not halt discovery.
 */
function followImports(entryFile: string): string[] {
  const visited = new Set<string>();
  const queue = [canonicalPath(entryFile)];
  while (queue.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: queue.length > 0 checked above
    const filePath = queue.pop()!;
    if (visited.has(filePath)) continue;
    visited.add(filePath);

    let tree;
    try {
      const src = readFileSync(filePath, "utf8");
      tree = parseSource(src).tree;
    } catch {
      continue;
    }

    const imports = extractImports(tree.rootNode);
    const dir = dirname(filePath);

    for (const imp of imports) {
      if (!imp.path) continue;
      const resolved = resolve(dir, imp.path);

      try {
        statSync(resolved);
      } catch {
        process.stderr.write(
          `warning: import target "${imp.path}" not found (referenced from ${filePath}:${imp.row + 1})\n`,
        );
        continue;
      }

      // Canonicalize before the visited check so two spellings of the same
      // physical file (case alias, symlink) cannot enqueue it twice.
      const canonical = canonicalPath(resolved);
      if (!visited.has(canonical)) {
        queue.push(canonical);
      }
    }
  }

  return [...visited].sort();
}

/**
 * Resolve the input argument to a list of .stm file paths.
 *
 * Accepts only .stm file paths — directory arguments are rejected with
 * a clear error (ADR-022). When given a file, follows import declarations
 * to discover the full transitive import graph unless followImports is false.
 */
export async function resolveInput(pathArg: string, opts?: { followImports?: boolean }): Promise<string[]> {
  const abs = resolve(pathArg);
  const s = await stat(abs);
  if (s.isDirectory()) {
    throw new Error(DIRECTORY_NOT_SUPPORTED);
  }
  if (opts?.followImports === false) {
    return [abs];
  }
  return followImports(abs);
}
