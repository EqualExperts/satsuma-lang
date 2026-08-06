/**
 * lint-command.test.ts — the `satsuma lint` command's own contract.
 *
 * Covers what only the command owns: its exit-code table (PRD 37 R5), strict-mode
 * precedence between the flag and the config, and that the structural rules
 * detected in `@satsuma/core` are registered and surface in `--json` with the
 * right severity.
 *
 * Rule *semantics* are tested once in core — `lint-type-mismatch.test.js` and
 * `lint-lineage-cycle.test.js`. Nothing here re-asserts which arrows mismatch or
 * which graphs are cyclic; these cases only prove the wiring.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../dist/index.js");

/** lint's own exit-code table (PRD 37 R5), named so the assertions read as prose. */
const EXIT_CLEAN = 0;
const EXIT_STRICT_WARNINGS = 1;
const EXIT_ERROR_FINDINGS = 2;
const EXIT_CANNOT_RUN = 3;

/** Write `pipeline.stm` into a throwaway directory and return the directory. */
function workspace(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "satsuma-lint-cmd-"));
  writeFileSync(join(dir, "pipeline.stm"), source, "utf8");
  return dir;
}

/** Lint the workspace's entry file with the given extra arguments. */
function lint(dir: string, ...args: string[]) {
  return run(CLI, "lint", join(dir, "pipeline.stm"), ...args);
}

/** A workspace with no findings of any kind. */
const CLEAN = `
schema src {
  id  STRING
}

schema dst {
  id  STRING
}

mapping copy {
  source { src }
  target { dst }
  id -> id
}
`;

/** A workspace whose only finding is a warning — a bare arrow between two types. */
const WARNING_ONLY = `
schema src {
  id  STRING
}

schema dst {
  id  INT
}

mapping copy {
  source { src }
  target { dst }
  id -> id
}
`;

/** A workspace with an error-severity finding: the same schema declared twice. */
const ERROR_FINDING = `
schema src {
  id  STRING
}

schema src {
  id  STRING
}
`;

/** Two mappings pointing at each other — the `lineage-cycle` case. */
const LINEAGE_CYCLE = `
schema a {
  id  STRING
}

schema b {
  id  STRING
}

mapping a_to_b {
  source { a }
  target { b }
  id -> id
}

mapping b_to_a {
  source { b }
  target { a }
  id -> id
}
`;

// ── Exit-code table ─────────────────────────────────────────────────────────

describe("lint exit codes", () => {
  it("exits 0 on a workspace with no findings", async () => {
    // The baseline the other rows are read against.
    const { code } = await lint(workspace(CLEAN));
    assert.equal(code, EXIT_CLEAN);
  });

  it("exits 0 when there are warnings but strict mode is off", async () => {
    // Warnings stay advisory by default (PRD 37 R5), so adding a rule — or a
    // config file — can never break an existing CI job.
    const { code, stdout } = await lint(workspace(WARNING_ONLY));
    assert.match(stdout, /warning/);
    assert.equal(code, EXIT_CLEAN);
  });

  it("exits 1 when warnings are present and --strict is active", async () => {
    // The escalation CI users asked for: same findings, failing exit code.
    const { code } = await lint(workspace(WARNING_ONLY), "--strict");
    assert.equal(code, EXIT_STRICT_WARNINGS);
  });

  it("exits 2 for an error-severity finding, with or without --strict", async () => {
    // Errors outrank warnings: a workspace with lint errors reports 2 either way,
    // because fixing the errors is the first thing to do regardless.
    const dir = workspace(ERROR_FINDING);
    assert.equal((await lint(dir)).code, EXIT_ERROR_FINDINGS);
    assert.equal((await lint(dir, "--strict")).code, EXIT_ERROR_FINDINGS);
  });

  it("exits 3 when the workspace cannot be read at all", async () => {
    // This is the row that makes the table useful: 2 now means "the workspace has
    // lint errors", so "lint never ran" needs its own code. A CI job must be able
    // to tell a failing gate from a broken checkout.
    const { code } = await run(CLI, "lint", "/nonexistent/pipeline.stm");
    assert.equal(code, EXIT_CANNOT_RUN);
  });

  it("exits 3 for an unusable config even when --strict is set", async () => {
    // "Could not run" beats every finding-based code: with a broken config the
    // findings are not trustworthy, so reporting a gate result would be a lie.
    const dir = workspace(WARNING_ONLY);
    const configPath = join(dir, "broken.yaml");
    writeFileSync(configPath, "lint:\n  strict: maybe\n", "utf8");

    const { code } = await lint(dir, "--strict", "--config", configPath);
    assert.equal(code, EXIT_CANNOT_RUN);
  });

  it("reports the same code with --quiet as it does with output", async () => {
    // --quiet exists for CI, which reads only the code; if the two paths could
    // disagree the flag would be a trap.
    const dir = workspace(WARNING_ONLY);
    const quiet = await lint(dir, "--strict", "--quiet");

    assert.equal(quiet.stdout, "");
    assert.equal(quiet.code, EXIT_STRICT_WARNINGS);
  });
});

// ── Strict-mode precedence ──────────────────────────────────────────────────

describe("strict mode precedence", () => {
  /** A workspace holding a warning plus a config file setting `lint.strict`. */
  function workspaceWithStrict(strict: boolean): string {
    const dir = workspace(WARNING_ONLY);
    writeFileSync(join(dir, "strict.yaml"), `lint:\n  strict: ${strict}\n`, "utf8");
    return dir;
  }

  it("honours lint.strict from the config file", async () => {
    // The persistent form of the flag: a workspace can commit its own gate
    // without every CI invocation having to remember to pass --strict.
    const dir = workspaceWithStrict(true);
    const { code } = await lint(dir, "--config", join(dir, "strict.yaml"));
    assert.equal(code, EXIT_STRICT_WARNINGS);
  });

  it("lets --strict override a config that turns strict off", async () => {
    // Flags win over config (PRD 37 R4's single precedence rule), so a one-off
    // strict run needs no config edit.
    const dir = workspaceWithStrict(false);
    const { code } = await lint(dir, "--config", join(dir, "strict.yaml"), "--strict");
    assert.equal(code, EXIT_STRICT_WARNINGS);
  });

  it("lets --no-strict override a config that turns strict on", async () => {
    // The same rule in the other direction: one job may want an advisory run
    // against a workspace whose committed config gates on warnings.
    const dir = workspaceWithStrict(true);
    const { code } = await lint(dir, "--config", join(dir, "strict.yaml"), "--no-strict");
    assert.equal(code, EXIT_CLEAN);
  });

  it("does not fail strictly on a rule that is suppressed", async () => {
    // A suppressed rule produces no findings at all, so it can never trigger a
    // strict failure. Were it otherwise, suppression and strictness together
    // would be unusable.
    const dir = workspace(WARNING_ONLY);
    const { code } = await lint(dir, "--strict", "--ignore", "type-mismatch-direct-arrow");
    assert.equal(code, EXIT_CLEAN);
  });
});

// ── Registration of the core-detected rules ─────────────────────────────────

describe("structural rules registration", () => {
  // Registration itself is no longer asserted here. `docs.test.ts`'s lint-registry
  // suite (gpt-o0fk) pins the printed list against both the engine's `RULES` and
  // `SATSUMA-CLI.md`'s rule table as *set equality in both directions*, which
  // subsumes the two `assert.match` calls this block used to make — and unlike
  // them, it also fails when a rule is registered and left undocumented. Keeping a
  // weaker duplicate of a stronger check is what AGENTS.md's "no redundant tests"
  // rule is about. `type-mismatch-direct-arrow` and `lineage-cycle` stay pinned via
  // their rows in that table, which is what makes the two constant-registered rules
  // (core's `TYPE_MISMATCH_RULE_ID` and `LINEAGE_CYCLE_RULE_ID`) auditable at all.

  it("aligns every --rules description at the same column, including the longest id", async () => {
    // The id column width is derived from the registry, so registering a rule
    // with a longer id than any existing one must not push its description out
    // of line (sl-n4rb: a hard-coded padEnd(24) broke the two 26-char ids).
    const { stdout } = await run(CLI, "lint", "--rules");
    const descriptionColumns = new Set(
      stdout
        .split("\n")
        .filter((line) => line.trim().length > 0)
        // The description starts after the id and the run of padding spaces.
        .map((line) => line.length - line.replace(/^\s+\S+\s+/, "").length),
    );

    assert.equal(descriptionColumns.size, 1, `descriptions not aligned:\n${stdout}`);
  });

  it("reports a type mismatch as an unfixable warning in --json", async () => {
    // Pins the JSON contract machine consumers read: id, severity, position, and
    // fixable: false — the fix is an author judgement, so --fix must not offer one.
    const { stdout, code } = await lint(workspace(WARNING_ONLY), "--json");
    const finding = JSON.parse(stdout).findings.find(
      (f: { rule: string }) => f.rule === "type-mismatch-direct-arrow",
    );

    assert.equal(finding.severity, "warning");
    assert.equal(finding.fixable, false);
    assert.equal(finding.column, 1);
    assert.ok(finding.line > 0);
    assert.equal(code, EXIT_CLEAN);
  });

  it("reports a lineage cycle as an unfixable warning in --json", async () => {
    // Same contract for the second rule, which shares the wrapper that sets
    // severity and fixability.
    const { stdout } = await lint(workspace(LINEAGE_CYCLE), "--json");
    const findings = JSON.parse(stdout).findings.filter(
      (f: { rule: string }) => f.rule === "lineage-cycle",
    );

    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "warning");
    assert.equal(findings[0].fixable, false);
  });

  it("runs only the named rule under --select", async () => {
    // Proves the new ids participate in selection like every other rule, rather
    // than being appended outside the filter.
    const { stdout } = await lint(workspace(LINEAGE_CYCLE), "--json", "--select", "lineage-cycle");
    const rules = new Set(
      JSON.parse(stdout).findings.map((f: { rule: string }) => f.rule) as string[],
    );

    assert.deepEqual([...rules], ["lineage-cycle"]);
  });
});
