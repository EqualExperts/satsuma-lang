/**
 * source-files.ts — the single definition of what counts as a Satsuma source file.
 *
 * The VS Code extension registers both `.stm` and `.satsuma` (f2v-hp48), but
 * each consumer historically hard-coded its own `.endsWith(".stm")` check, so
 * `.satsuma` files got syntax highlighting yet were invisible to the workspace
 * index, file watchers, and entry-file resolution (sl-v215). Every consumer
 * (CLI, LSP, VS Code extension) must use these exports instead of spelling
 * extensions inline. This module owns only the extension policy — file
 * discovery and parsing live with each consumer.
 */

/**
 * Recognised Satsuma source-file extensions. `.stm` is the canonical
 * extension used throughout docs and examples; `.satsuma` is the explicit
 * long-form alternative registered alongside it by the VS Code extension.
 */
export const SATSUMA_FILE_EXTENSIONS = [".stm", ".satsuma"] as const;

/**
 * Glob matching all Satsuma source files, for file watchers and workspace
 * searches (VS Code `findFiles`/`createFileSystemWatcher` brace syntax).
 */
export const SATSUMA_FILE_GLOB = "**/*.{stm,satsuma}";

/**
 * True when a filesystem path, bare file name, or URI string names a Satsuma
 * source file. Matching is by extension suffix only — the file need not exist.
 */
export function isSatsumaFilePath(pathOrUri: string): boolean {
  return SATSUMA_FILE_EXTENSIONS.some((ext) => pathOrUri.endsWith(ext));
}
