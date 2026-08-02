/**
 * errors.ts — Shared error helpers used by CLI command handlers
 *
 * This module owns three things, all of them user-facing failure shapes
 * that more than one command needs:
 *
 *   • {@link loadFiles} — parses a list of `.stm` paths, warns on partial
 *     parse errors (so commands can still operate on broken workspaces),
 *     and aborts the command if *any* file is unreadable.
 *   • {@link findSuggestion} — case-insensitive "did you mean?" suggestion
 *     used by every "not found" message in the CLI.
 *   • {@link notFound} — convenience helper that builds a multi-line
 *     "not found / did you mean / available list" message and throws.
 *
 * It does *not* own exit codes or process.exit. Both have moved to
 * `command-runner.ts`, which is now the single dispatcher that calls
 * `process.exit`. The exit-code constants are re-exported here so older
 * imports keep compiling — see sl-3291.
 */

import type { ParsedFile } from "./types.js";
import { CommandError, EXIT_NOT_FOUND, EXIT_PARSE_ERROR } from "./command-runner.js";

// Re-export the exit codes so callers that previously imported them from
// errors.ts keep working. New code should import them directly from
// command-runner.ts.
export { EXIT_NOT_FOUND, EXIT_PARSE_ERROR };

/**
 * Parse a list of resolved `.stm` paths.
 *
 * Files with parse errors are kept (a per-file warning is printed to
 * stderr) so commands can still inspect a partially-broken workspace —
 * this matches the long-standing per-command behaviour and is what every
 * downstream tool here expects.
 *
 * If *any* file fails to be read at all, this throws a {@link CommandError}
 * with code {@link EXIT_PARSE_ERROR}. The per-file errors have already been
 * printed to stderr by the time the throw happens, so the thrown error
 * carries an empty message — the runner will skip printing and just
 * propagate the exit code.
 */
export function loadFiles(
  files: string[],
  parseFileFn: (filePath: string) => ParsedFile,
): ParsedFile[] {
  const parsed: ParsedFile[] = [];
  let hasReadError = false;

  for (const f of files) {
    try {
      const result = parseFileFn(f);
      if (result.errorCount > 0) {
        console.error(`Warning: ${result.errorCount} parse error(s) in ${f}`);
      }
      parsed.push(result);
    } catch (err: unknown) {
      console.error(`Error: could not read or parse ${f}: ${(err as Error).message}`);
      hasReadError = true;
    }
  }

  if (hasReadError) {
    // Per-file errors have already been written to stderr above; an
    // empty-message CommandError just signals the exit code without
    // double-printing.
    throw new CommandError("", EXIT_PARSE_ERROR);
  }
  return parsed;
}

/**
 * Suggest a close match from a list of available names. Returns the
 * suggestion string, or null if nothing reasonable is available.
 *
 * The matching rule is intentionally simple — case-insensitive exact
 * match first, falling back to a 3-character prefix match. This is
 * good enough for the "did you mean schemaname?" case the CLI uses
 * it for; full edit-distance ranking would just produce more noise.
 */
export function findSuggestion(name: string, available: string[]): string | null {
  // Case-insensitive exact match
  const exact = available.find((k) => k.toLowerCase() === name.toLowerCase());
  if (exact) return exact;

  // Prefix match
  const prefix = available.find((k) => k.toLowerCase().startsWith(name.toLowerCase().slice(0, 3)));
  return prefix ?? null;
}

/**
 * Build a multi-line "not found" message and throw a {@link CommandError}
 * with code {@link EXIT_NOT_FOUND}. Returns `never` so callers can use it
 * as a terminal expression in narrowing branches.
 *
 * The message includes a "did you mean?" line when {@link findSuggestion}
 * returns a useful match, and an "Available: a, b, c" line when there are
 * 10 or fewer alternatives (otherwise it just shows the count, to avoid
 * dumping hundreds of names into the user's terminal).
 */
export function notFound(kind: string, name: string, available: string[]): never {
  const suggestion = findSuggestion(name, available);
  const lines: string[] = [];

  if (suggestion && suggestion !== name) {
    lines.push(`${kind} '${name}' not found. Did you mean '${suggestion}'?`);
  } else {
    lines.push(`${kind} '${name}' not found.`);
  }

  const MAX_INLINE_AVAILABLE = 10; // beyond this we show a count instead
  if (available.length > 0 && available.length <= MAX_INLINE_AVAILABLE) {
    lines.push(`Available: ${available.join(", ")}`);
  } else if (available.length > MAX_INLINE_AVAILABLE) {
    lines.push(`(${available.length} ${kind.toLowerCase()}s in workspace)`);
  }

  throw new CommandError(lines.join("\n"), EXIT_NOT_FOUND);
}
