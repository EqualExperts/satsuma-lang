/**
 * command-loader — resolves CLI command modules to importable specifiers.
 *
 * Each command lives in its own module under src/commands/ and is loaded at
 * startup with a dynamic `import()`. This module owns the single rule for
 * turning an on-disk module path into a specifier that Node's ESM loader will
 * accept on every platform.
 *
 * It does NOT own command registration or dispatch — that stays in index.ts.
 */

import { join } from "node:path";
import { pathToFileURL } from "node:url";

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
export function commandModuleSpecifier(
  entryDir: string,
  relativeModulePath: string,
): string {
  return pathToFileURL(join(entryDir, relativeModulePath)).href;
}
