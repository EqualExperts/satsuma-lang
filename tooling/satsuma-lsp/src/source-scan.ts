/**
 * source-scan.ts — recursive filesystem scan for Satsuma source files.
 *
 * Owns the directory walk the server runs at startup to seed the workspace
 * index. Which extensions count as Satsuma source is owned by @satsuma/core
 * (sl-v215) — this module only owns the traversal rules: which directories
 * are skipped and the recursion itself. Parsing and indexing stay in server.ts.
 */

import * as fs from "fs";
import * as path from "path";
import { isSatsumaFilePath } from "@satsuma/core";

/**
 * Directory names excluded from the scan: hidden directories (VCS metadata,
 * editor state) and installed dependencies are never Satsuma workspace source.
 */
function isSkippedDirectory(name: string): boolean {
  return name.startsWith(".") || name === "node_modules";
}

/**
 * Recursively collect absolute paths of all Satsuma source files (.stm and
 * .satsuma) under `dir`, skipping hidden directories and node_modules.
 * Unreadable directories are silently skipped — a permission error in one
 * subtree must not abort workspace indexing.
 */
export function findSatsumaSourceFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (isSkippedDirectory(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findSatsumaSourceFiles(full));
      } else if (isSatsumaFilePath(entry.name)) {
        results.push(full);
      }
    }
  } catch {
    // Unreadable directory — skip
  }
  return results;
}
