/**
 * load-config.test.ts — the CLI's filesystem half of workspace configuration.
 *
 * Covers where the config is looked up, when its absence is an error, and how
 * an unusable one aborts the command. Config *semantics* (valid shapes, rule-id
 * validation, suppression precedence) are tested once in
 * `satsuma-core/test/satsuma-config.test.js` and are not re-tested here.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { DEFAULT_SATSUMA_CONFIG, SATSUMA_CONFIG_FILENAME } from "@satsuma/core/config";
import { loadSatsumaConfig } from "#src/load-config.js";
import { CommandError, EXIT_LINT_CANNOT_RUN } from "#src/command-runner.js";
import { run } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../dist/index.js");

/** Rule ids the real engine ships, for validating suppression entries. */
const KNOWN_RULES = ["hidden-source-in-nl", "unresolved-nl-ref", "duplicate-definition"];

/** Create a throwaway workspace directory, optionally containing a config file. */
function workspaceWith(configText?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "satsuma-config-"));
  if (configText !== undefined) {
    writeFileSync(join(dir, SATSUMA_CONFIG_FILENAME), configText, "utf8");
  }
  return dir;
}

// ── Default lookup: absence is normal ──────────────────────────────────────

describe("default config lookup", () => {
  it("returns the defaults silently when the workspace has no config file", () => {
    // Every existing workspace is in this state. If a missing file were an
    // error, adding the config feature would break all of them at once.
    const config = loadSatsumaConfig({ cwd: workspaceWith(), knownRuleIds: KNOWN_RULES });
    assert.deepEqual(config, DEFAULT_SATSUMA_CONFIG);
  });

  it("reads satsuma.config.yaml from the given directory", () => {
    // Pins the default lookup to <cwd>/satsuma.config.yaml — the path documented
    // in the command help and PRD 37 R4.
    const dir = workspaceWith("lint:\n  suppress:\n    - unresolved-nl-ref\n");
    const config = loadSatsumaConfig({ cwd: dir, knownRuleIds: KNOWN_RULES });
    assert.deepEqual(config.lint.suppress, ["unresolved-nl-ref"]);
  });

  it("does not search parent directories for a config", () => {
    // Lookup is deliberately non-recursive: an ancestor config silently
    // changing lint results in a subdirectory would be surprising, and the
    // ticket scopes lookup to ./satsuma.config.yaml.
    const parent = workspaceWith("lint:\n  strict: true\n");
    const child = join(parent, "nested");
    mkdirSync(child);
    const config = loadSatsumaConfig({ cwd: child, knownRuleIds: KNOWN_RULES });
    assert.equal(config.lint.strict, false);
  });
});

// ── Explicit --config: absence is an error ─────────────────────────────────

describe("explicit --config path", () => {
  it("fails when the named file does not exist", () => {
    // The user named a specific file. Falling back to defaults would run lint
    // with different rules than they asked for and report success.
    const missing = join(workspaceWith(), "nope.yaml");
    assert.throws(
      () => loadSatsumaConfig({ explicitPath: missing, knownRuleIds: KNOWN_RULES }),
      (err: unknown) =>
        err instanceof CommandError &&
        err.code === EXIT_LINT_CANNOT_RUN &&
        err.message.includes(missing),
    );
  });

  it("reads the named file instead of the default path", () => {
    // The override must win even when a default-named config sits alongside it.
    const dir = workspaceWith("lint:\n  suppress:\n    - unresolved-nl-ref\n");
    const override = join(dir, "ci.yaml");
    writeFileSync(override, "lint:\n  suppress:\n    - duplicate-definition\n", "utf8");

    const config = loadSatsumaConfig({
      explicitPath: override,
      cwd: dir,
      knownRuleIds: KNOWN_RULES,
    });
    assert.deepEqual(config.lint.suppress, ["duplicate-definition"]);
  });
});

// ── Unusable configs abort with lint's "could not run" code ────────────────

describe("unusable config", () => {
  it("aborts with exit code 3 rather than linting with defaults", () => {
    // 3 means "lint could not run", distinct from 2 ("the workspace has lint
    // errors"). CI must be able to tell a broken setup from a failing gate.
    const dir = workspaceWith("lint:\n  suppress: [unclosed\n");
    assert.throws(
      () => loadSatsumaConfig({ cwd: dir, knownRuleIds: KNOWN_RULES }),
      (err: unknown) => err instanceof CommandError && err.code === EXIT_LINT_CANNOT_RUN,
    );
  });

  it("names the offending file and every problem in it", () => {
    // One run should be enough to fix the file, and the author needs to know
    // which file to open — the path may have come from --config.
    const dir = workspaceWith('lint:\n  strict: "no"\n  suppress:\n    - nope\n');
    assert.throws(
      () => loadSatsumaConfig({ cwd: dir, knownRuleIds: KNOWN_RULES }),
      (err: unknown) => {
        assert.ok(err instanceof CommandError);
        assert.match(err.message, new RegExp(SATSUMA_CONFIG_FILENAME));
        assert.match(err.message, /lint\.strict/);
        assert.match(err.message, /nope/);
        return true;
      },
    );
  });
});

// ── Warnings ──────────────────────────────────────────────────────────────

describe("config warnings", () => {
  it("reports unrecognised settings through the caller's warning sink", () => {
    // The loader must not write to the console itself: --json runs need stdout
    // clean, so the caller decides where notes go.
    const dir = workspaceWith("lnit:\n  strict: true\n");
    const warnings: string[] = [];
    loadSatsumaConfig({ cwd: dir, knownRuleIds: KNOWN_RULES, onWarning: (m) => warnings.push(m) });

    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /lnit/);
    assert.match(warnings[0]!, new RegExp(SATSUMA_CONFIG_FILENAME));
  });
});

// ── End-to-end through the lint command ───────────────────────────────────

describe("satsuma lint --config", () => {
  /** A workspace whose only lint finding is an unresolved NL ref (a warning). */
  function workspaceWithFinding(): string {
    const dir = mkdtempSync(join(tmpdir(), "satsuma-lint-config-"));
    writeFileSync(
      join(dir, "pipeline.stm"),
      [
        "schema src {",
        "  id  STRING",
        "}",
        "",
        "schema dst {",
        "  id  STRING",
        "}",
        "",
        "mapping `copy id` {",
        "  source { `src` }",
        "  target { `dst` }",
        "",
        // @missing_field resolves to nothing, which is exactly what
        // unresolved-nl-ref reports (warning severity, so exit stays 0).
        '  id -> id { "Copy the value of @missing_field." }',
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    return dir;
  }

  it("suppresses a rule named in lint.suppress", async () => {
    // The end-to-end proof that config suppression reaches the engine, not just
    // the typed config object.
    const dir = workspaceWithFinding();
    const configPath = join(dir, "ci.yaml");
    writeFileSync(configPath, "lint:\n  suppress:\n    - unresolved-nl-ref\n", "utf8");

    const withoutConfig = await run(CLI, "lint", join(dir, "pipeline.stm"), "--json");
    assert.match(withoutConfig.stdout, /unresolved-nl-ref/);

    const withConfig = await run(
      CLI,
      "lint",
      join(dir, "pipeline.stm"),
      "--json",
      "--config",
      configPath,
    );
    assert.doesNotMatch(withConfig.stdout, /unresolved-nl-ref/);
  });

  it("runs a config-suppressed rule when --select names it", async () => {
    // Locks the one exception to "flags and config union": naming a rule is an
    // unambiguous instruction to run it.
    const dir = workspaceWithFinding();
    const configPath = join(dir, "ci.yaml");
    writeFileSync(configPath, "lint:\n  suppress:\n    - unresolved-nl-ref\n", "utf8");

    const result = await run(
      CLI,
      "lint",
      join(dir, "pipeline.stm"),
      "--json",
      "--config",
      configPath,
      "--select",
      "unresolved-nl-ref",
    );
    assert.match(result.stdout, /unresolved-nl-ref/);
  });

  it("exits 3 with an actionable message when the config is malformed", async () => {
    // The user-visible contract for a broken config: a non-zero code that is
    // not the "workspace has lint errors" code, and a message naming the file.
    const dir = workspaceWithFinding();
    const configPath = join(dir, "broken.yaml");
    writeFileSync(configPath, "lint:\n  suppress: [unclosed\n", "utf8");

    const result = await run(CLI, "lint", join(dir, "pipeline.stm"), "--config", configPath);
    assert.equal(result.code, EXIT_LINT_CANNOT_RUN);
    assert.match(result.stderr, /broken\.yaml/);
  });

  it("exits 3 when --ignore names a rule that does not exist", async () => {
    // Before this, a misspelled --ignore value was accepted in silence and the
    // rule kept running. A typo must not look like a working suppression.
    const dir = workspaceWithFinding();
    const result = await run(
      CLI,
      "lint",
      join(dir, "pipeline.stm"),
      "--ignore",
      "unresolvd-nl-ref",
    );
    assert.equal(result.code, EXIT_LINT_CANNOT_RUN);
    assert.match(result.stderr, /unresolvd-nl-ref/);
    assert.match(result.stderr, /unresolved-nl-ref/);
  });

  it("warns that lint.strict is parsed but not yet enforced", async () => {
    // strict: true with no enforcement would read as an active gate. Until
    // sl-1u6r ships, the CLI must say so out loud.
    const dir = workspaceWithFinding();
    const configPath = join(dir, "strict.yaml");
    writeFileSync(configPath, "lint:\n  strict: true\n", "utf8");

    const result = await run(CLI, "lint", join(dir, "pipeline.stm"), "--config", configPath);
    assert.match(result.stderr, /lint\.strict is not enforced yet/);
    assert.equal(result.code, 0);
  });
});
