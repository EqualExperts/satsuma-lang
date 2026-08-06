/**
 * docs.test.ts — Keeps the CLI reference (SATSUMA-CLI.md) in sync with what the
 * binary actually does.
 *
 * Regression coverage for sl-w1dr: the CLI grew to 22 commands while
 * SATSUMA-CLI.md documented 21 (nl-refs was missing) and other docs still
 * claimed 16. Living docs no longer hardcode a command count; this test is
 * the check that every shipped command is documented, so a newly registered
 * command fails CI until its reference entry exists.
 *
 * The second suite guards the one JSON shape the docs call a *stable contract*
 * (`coverage`, consumed by the viz overlay). A contract nobody checks is a
 * comment, so the keys the command emits must appear in the documented shape.
 *
 * The third suite applies the same guard to the lint rule registry (gpt-o0fk).
 * `RULES` in `src/lint-engine.ts` mixes literal ids with ids imported from core
 * as constants (`TYPE_MISMATCH_RULE_ID`, `LINEAGE_CYCLE_RULE_ID`), so the
 * registered set cannot be read off the file by eye or by grep — an audit that
 * searched for literal `id: "..."` strings found four of the six and wrongly
 * concluded the other two were never registered. The set comparison below is
 * what makes the registry auditable without reading it line by line.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run as runCli } from "./helpers.js";
import { RULES } from "../src/lint-engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../dist/index.js");
const CLI_REFERENCE = resolve(__dirname, "../../../SATSUMA-CLI.md");

// Commander adds an implicit `help` subcommand; it is CLI plumbing, not part
// of the documented command surface.
const IMPLICIT_COMMANDS = new Set(["help"]);

/** Parse registered command names from the `Commands:` section of --help. */
function commandNamesFromHelp(helpText: string): string[] {
  const commandsSection = helpText.slice(helpText.indexOf("Commands:"));
  const names = [...commandsSection.matchAll(/^ {2}([a-z][a-z-]*)/gm)]
    .map((m) => m[1]!)
    .filter((name) => !IMPLICIT_COMMANDS.has(name));
  return [...new Set(names)];
}

describe("SATSUMA-CLI.md command coverage", () => {
  it("documents every command the CLI registers", async () => {
    const { stdout, code } = await runCli(CLI, "--help");
    assert.equal(code, 0);

    const names = commandNamesFromHelp(stdout);
    // Sanity floor: if help parsing ever breaks, fail loudly here rather
    // than silently asserting nothing below.
    assert.ok(
      names.length >= 20,
      `expected to parse a full command list from --help, got ${names.length}`,
    );

    const reference = readFileSync(CLI_REFERENCE, "utf8");
    const undocumented = names.filter((name) => !reference.includes(`\`${name}`));
    assert.deepEqual(
      undocumented,
      [],
      `commands missing from SATSUMA-CLI.md: ${undocumented.join(", ")}`,
    );
  });
});

describe("SATSUMA-CLI.md coverage JSON contract", () => {
  const COVERAGE_FIXTURE = resolve(__dirname, "fixtures/coverage-workspace.stm");

  /** Every distinct object key appearing anywhere in a JSON value. */
  function allKeys(value: unknown, found = new Set<string>()): Set<string> {
    if (Array.isArray(value)) {
      for (const item of value) allKeys(item, found);
    } else if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        found.add(key);
        allKeys(child, found);
      }
    }
    return found;
  }

  it("documents every key the coverage JSON emits", async () => {
    // SATSUMA-CLI.md presents this shape as a stable contract that feature 36's
    // overlay renders from. If the command grows a key the reference does not
    // mention, the contract has silently changed — which is exactly the drift
    // calling it "stable" is meant to prevent.
    const { stdout, code } = await runCli(
      CLI,
      "coverage",
      COVERAGE_FIXTURE,
      "--fail-under",
      "50",
      "--json",
    );
    assert.equal(code, 0);

    const keys = [...allKeys(JSON.parse(stdout))];
    // Sanity floor: a parsing slip here must fail loudly, not assert nothing.
    assert.ok(
      keys.length >= 10,
      `expected a populated coverage payload, got keys: ${keys.join(", ")}`,
    );

    const reference = readFileSync(CLI_REFERENCE, "utf8");
    const contract = reference.slice(reference.indexOf("#### JSON contract"));
    const undocumented = keys.filter((key) => !contract.includes(`"${key}"`));
    assert.deepEqual(
      undocumented,
      [],
      `coverage --json keys missing from the documented contract: ${undocumented.join(", ")}`,
    );
  });
});

describe("SATSUMA-CLI.md lint rule table", () => {
  // The reference's rule table opens with this header row. Anchoring on it (rather
  // than on a heading) keeps the parser pinned to the one table whose first column
  // is a rule id — SATSUMA-CLI.md holds several other backticked-first-column
  // tables that would otherwise match.
  const RULE_TABLE_HEADER = "| Rule ";

  /** Rule ids printed by `lint --rules`, one per `  <id>  <description>` line. */
  function ruleIdsFromRulesOutput(stdout: string): string[] {
    return stdout
      .split("\n")
      .map((line) => /^ {2}(\S+)\s/.exec(line)?.[1])
      .filter((id): id is string => id !== undefined);
  }

  /**
   * Rule ids documented in the reference's rule table — the backticked first cell
   * of every row after the header and its `| --- |` separator.
   */
  function ruleIdsFromReferenceTable(reference: string): string[] {
    const table = reference.slice(reference.indexOf(RULE_TABLE_HEADER));
    const rows = table.split("\n").slice(1);
    const ids: string[] = [];
    for (const row of rows) {
      if (!row.startsWith("|")) break; // end of the table
      const id = /^\|\s*`([^`]+)`/.exec(row)?.[1];
      if (id) ids.push(id);
    }
    return ids;
  }

  it("prints exactly the rule ids the engine registers when asked for --rules", async () => {
    // `--rules` is the discoverability surface and the id list that validates
    // --select/--ignore/lint.suppress. If it ever printed a filtered or
    // hand-maintained list, a real rule would be undiscoverable and its own id
    // would read as a typo. This also proves the line parser below sees the whole
    // list, so the docs comparison cannot pass by parsing nothing.
    const { stdout, code } = await runCli(CLI, "lint", "--rules");
    assert.equal(code, 0);

    // Sanity floor: an empty registry would make `[] === []` a pass, so the
    // comparison below would assert nothing at all.
    assert.ok(RULES.length > 0, "the lint registry is empty");

    // `RULES` is imported from `src/`, while the command under test runs from
    // `dist/` — deliberately, because comparing `dist` against itself could not
    // catch a rule added to the registry and never built. The corollary is that a
    // src-only edit with no rebuild fails here, so the message names that cause:
    // per AGENTS.md, a bare per-package `npm test` no longer builds anything.
    assert.deepEqual(
      ruleIdsFromRulesOutput(stdout).sort(),
      RULES.map((rule) => rule.id).sort(),
      "`lint --rules` no longer prints the set of rules the engine registers — " +
        "or `dist/` predates the registry change and needs `npm run build`",
    );
  });

  it("documents every registered rule, and documents no rule the engine does not register", async () => {
    // Both directions, because each is a distinct real failure: a rule added to
    // RULES with no table row ships undocumented, and a table row with no rule
    // behind it tells an author to --select an id that exits 3. The ids come from
    // the table rather than a hardcoded list, so adding a rule needs no edit here.
    //
    // Only ids are compared. The table's Severity and Fixable columns state
    // properties the registry does not carry — both are decided per diagnostic
    // inside each rule's check function — so there is nothing in the engine to
    // pin them against from here.
    const { stdout } = await runCli(CLI, "lint", "--rules");
    const registered = ruleIdsFromRulesOutput(stdout);
    const documented = ruleIdsFromReferenceTable(readFileSync(CLI_REFERENCE, "utf8"));

    // Sanity floors, one per parser, as the two suites above also carry: two
    // empty lists compare equal in both directions, so a parser that silently
    // matched nothing would turn this case into a test of nothing. Asserting
    // each side is populated keeps the case non-vacuous on its own, rather than
    // relying on the case above to notice.
    assert.ok(registered.length > 0, `parsed no rule ids from \`lint --rules\`:\n${stdout}`);
    assert.ok(
      documented.length > 0,
      "parsed no rule ids from SATSUMA-CLI.md's rule table — has the table moved or been restyled?",
    );

    const undocumented = registered.filter((id) => !documented.includes(id));
    assert.deepEqual(
      undocumented,
      [],
      `lint rules missing from SATSUMA-CLI.md's rule table: ${undocumented.join(", ")}`,
    );

    const unregistered = documented.filter((id) => !registered.includes(id));
    assert.deepEqual(
      unregistered,
      [],
      `SATSUMA-CLI.md documents lint rules the engine does not register: ${unregistered.join(", ")}`,
    );
  });
});
