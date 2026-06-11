/**
 * docs.test.ts — Keeps the CLI reference (SATSUMA-CLI.md) in sync with the
 * commands the binary actually registers.
 *
 * Regression coverage for sl-w1dr: the CLI grew to 22 commands while
 * SATSUMA-CLI.md documented 21 (nl-refs was missing) and other docs still
 * claimed 16. Living docs no longer hardcode a command count; this test is
 * the check that every shipped command is documented, so a newly registered
 * command fails CI until its reference entry exists.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run as runCli } from "./helpers.js";

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
    assert.ok(names.length >= 20, `expected to parse a full command list from --help, got ${names.length}`);

    const reference = readFileSync(CLI_REFERENCE, "utf8");
    const undocumented = names.filter((name) => !reference.includes(`\`${name}`));
    assert.deepEqual(
      undocumented,
      [],
      `commands missing from SATSUMA-CLI.md: ${undocumented.join(", ")}`,
    );
  });
});
