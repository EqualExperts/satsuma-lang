/**
 * load-config.ts — find and read the workspace's `satsuma.config.yaml`.
 *
 * Owns the CLI's *filesystem* half of workspace configuration: where the file
 * lives, whether its absence is an error, and how a bad config aborts the
 * command. The config's shape, validation, and precedence semantics live in
 * `@satsuma/core/config` so the LSP applies the identical rules when it mirrors
 * lint diagnostics — core imports no Node built-ins, which is why reading the
 * file cannot live there.
 *
 * The asymmetry between the two lookup paths is deliberate:
 *
 *   • **No `--config` flag** — a missing `./satsuma.config.yaml` is normal.
 *     Most workspaces have no config and must keep working untouched.
 *   • **`--config <path>` given** — a missing file is an error. The user named
 *     a specific file; silently linting with defaults would report a
 *     suppressed rule or skip a strict gate they explicitly configured.
 */

import { readFileSync } from "fs";
import { join } from "path";
import {
  DEFAULT_SATSUMA_CONFIG,
  SATSUMA_CONFIG_FILENAME,
  parseSatsumaConfig,
  type SatsumaConfig,
} from "@satsuma/core/config";
import { CommandError, EXIT_LINT_CANNOT_RUN } from "./command-runner.js";

/** Options for {@link loadSatsumaConfig}. */
export interface LoadSatsumaConfigOptions {
  /** Value of `--config <path>`, if the user passed it. */
  explicitPath?: string | undefined;

  /**
   * Directory the default config path is resolved against. Defaults to the
   * process working directory; tests and embedders pass their own.
   */
  cwd?: string;

  /**
   * Rule ids that exist, so a typo in `lint.suppress` is rejected rather than
   * silently suppressing nothing.
   */
  knownRuleIds?: readonly string[];

  /**
   * Sink for non-fatal notes such as unrecognised settings. Callers route these
   * to stderr; omitting it discards them, which is what `--quiet` and `--json`
   * runs want.
   */
  onWarning?: (message: string) => void;
}

/**
 * Load the workspace config, or the defaults when there is none to load.
 *
 * @throws CommandError with {@link EXIT_LINT_CANNOT_RUN} when a config exists
 *         (or was explicitly named) but cannot be used — malformed YAML, a
 *         wrong-shaped setting, an unknown rule id, or an unreadable file. The
 *         message names the file and every problem found in it.
 */
export function loadSatsumaConfig(options: LoadSatsumaConfigOptions = {}): SatsumaConfig {
  const { explicitPath, cwd = process.cwd(), knownRuleIds, onWarning } = options;

  const path = explicitPath ?? join(cwd, SATSUMA_CONFIG_FILENAME);

  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err: unknown) {
    if (!explicitPath && isFileNotFound(err)) return DEFAULT_SATSUMA_CONFIG;

    const reason = (err as { message?: string })?.message ?? String(err);
    throw new CommandError(`Error: cannot read config ${path}: ${reason}`, EXIT_LINT_CANNOT_RUN);
  }

  const result = parseSatsumaConfig(text, knownRuleIds ? { knownRuleIds } : {});

  if (!result.ok) {
    const detail = result.errors.map((e) => `  ${e}`).join("\n");
    throw new CommandError(`Error: invalid config ${path}\n${detail}`, EXIT_LINT_CANNOT_RUN);
  }

  if (onWarning) {
    for (const warning of result.warnings) onWarning(`${path}: ${warning}`);
  }

  return result.config;
}

/** True for the "no such file or directory" error `readFileSync` raises. */
function isFileNotFound(err: unknown): boolean {
  return (err as { code?: string })?.code === "ENOENT";
}
