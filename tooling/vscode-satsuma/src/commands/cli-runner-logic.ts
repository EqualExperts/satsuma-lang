/**
 * cli-runner-logic.ts — pure error-normalization rules for CLI invocations.
 *
 * Owns the mapping from execFile's error shapes to the exit code and stderr
 * text the extension surfaces to users. Kept free of vscode imports so the
 * rules are unit-testable outside the extension host (same pattern as
 * entry-file-logic.ts). cli-runner.ts owns the actual process spawning.
 */

/** The subset of execFile's callback error this module inspects. */
export interface SpawnError {
  /** Numeric exit code for non-zero process exits; a string errno (e.g.
   *  "ENOENT") when the process could not be spawned at all. Node's
   *  ExecFileException also permits null. */
  code?: number | string | null;
  message?: string;
}

/**
 * Normalize execFile's error into a numeric exit code. error.code is a number
 * for non-zero process exits but a string (e.g. "ENOENT") for spawn failures —
 * Number("ENOENT") produced "exit code NaN" in user-facing messages (sl-wlta).
 */
export function exitCodeFrom(error: SpawnError | null): number {
  if (!error) return 0;
  return typeof error.code === "number" ? error.code : 1;
}

/**
 * A user-actionable message for spawn failures, which never produce stderr of
 * their own; returns null for success and ordinary non-zero exits. ENOENT —
 * the satsuma CLI missing from PATH — is the most common new-user failure and
 * gets a specific install hint; callers surface this text directly in their
 * warning toasts.
 */
export function spawnFailureMessage(
  error: SpawnError | null,
  cliPath: string,
): string | null {
  if (!error || typeof error.code !== "string") return null;
  if (error.code === "ENOENT") {
    return `Satsuma CLI not found at "${cliPath}". Install it (npm install -g satsuma-cli) or point the satsuma.cliPath setting at the executable.`;
  }
  return `Failed to run the Satsuma CLI (${error.code}): ${error.message ?? "unknown error"}`;
}
