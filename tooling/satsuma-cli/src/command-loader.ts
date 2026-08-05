/**
 * command-loader — resolves CLI command modules to importable specifiers.
 *
 * Each command lives in its own module under src/commands/ and is loaded at
 * startup with a dynamic `import()`. This module owns the single rule for
 * turning an on-disk module path into a specifier that Node's ESM loader will
 * accept on every platform, and the list of which modules those are — so
 * anything that needs to enumerate every registered command (index.ts at
 * startup; the MCP-schema-comparison measurement in
 * scripts/measure-agent-reference-tokens.mjs) reads the same list rather than
 * maintaining its own copy that can drift out of sync.
 *
 * It does NOT own command registration or dispatch — that stays in index.ts.
 */

import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Every command module, relative to the CLI entry point's directory, in
 * registration order. Adding a command means adding it here — nowhere else
 * enumerates the command set.
 */
export const COMMAND_MODULES = [
  "commands/summary.js",
  "commands/schema.js",
  "commands/metric.js",
  "commands/mapping.js",
  "commands/find.js",
  "commands/lineage.js",
  "commands/where-used.js",
  "commands/warnings.js",
  "commands/context.js",
  "commands/arrows.js",
  "commands/fields.js",
  "commands/coverage.js",
  "commands/nl.js",
  "commands/meta.js",
  "commands/match-fields.js",
  "commands/validate.js",
  "commands/diff.js",
  "commands/nl-refs.js",
  "commands/graph.js",
  "commands/lint.js",
  "commands/agent-reference.js",
  "commands/fmt.js",
  "commands/field-lineage.js",
];

/**
 * Build the `import()` specifier for a command module, given the entry point's
 * directory and the module's path relative to it.
 *
 * The specifier is always a `file://` URL. This matters on Windows: Node's ESM
 * loader rejects a bare absolute path like `C:\…\commands\summary.js` with
 * ERR_UNSUPPORTED_ESM_URL_SCHEME, because it reads the drive letter `C:` as a
 * URL scheme. Absolute `import()` specifiers must be `file://` URLs there.
 * POSIX absolute paths happen to be tolerated, which is why the bug only ever
 * surfaced on Windows (gh-265). `pathToFileURL` produces a valid URL on both,
 * so no platform branching is needed.
 *
 * @param entryDir            Directory of the CLI entry point (its __dirname).
 * @param relativeModulePath  Module path relative to entryDir, e.g.
 *                            "commands/summary.js".
 * @returns A `file://` URL string suitable for `import()`.
 */
export function commandModuleSpecifier(entryDir: string, relativeModulePath: string): string {
  return pathToFileURL(join(entryDir, relativeModulePath)).href;
}
