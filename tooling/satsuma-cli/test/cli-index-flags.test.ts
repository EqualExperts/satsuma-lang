/**
 * cli-index-flags.test.ts — drift guard for reference/cli-index.md (arpd-f3xm).
 *
 * `cli-index.md`'s `### Command reference` fenced block is hand-authored
 * prose that shows example invocations, including flags. Nothing previously
 * checked that those flags still exist on the commands they're shown
 * against — a flag renamed or removed in a command module would leave a
 * stale example in the reference an agent trusts. This test parses every
 * `satsuma <command> --flag` occurrence out of the fence and checks it
 * against each command's real Commander registration, loaded from the built
 * CLI rather than hand-restated, so the check itself cannot drift either.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { COMMAND_MODULES, commandModuleSpecifier } from "../dist/command-loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const DIST_DIR = resolve(__dirname, "../dist");

/** One command name found in cli-index.md, and every long flag shown against it. */
interface DocumentedCommand {
  command: string;
  flags: Set<string>;
}

/**
 * Parses `satsuma <command> ...` lines out of cli-index.md's fenced bash
 * block. A trailing `# comment` is stripped first, so words inside a comment
 * (e.g. "exit 3 below the threshold") are never mistaken for flags. Only
 * tokens matching `--word` are kept as flags; quoted multi-word arguments
 * like `"sfdc to hub_customer"` tokenize into words that don't match and are
 * harmlessly dropped.
 */
function parseDocumentedCommands(markdown: string): DocumentedCommand[] {
  const fence = markdown.match(/```bash\n([\s\S]*?)```/);
  assert.ok(fence, "expected exactly one fenced bash block in cli-index.md");

  const byCommand = new Map<string, Set<string>>();
  for (const rawLine of fence![1].split("\n")) {
    const line = rawLine.split("#")[0].trim();
    const marker = line.indexOf("satsuma ");
    if (marker === -1) continue;

    const [command, ...rest] = line
      .slice(marker + "satsuma ".length)
      .trim()
      .split(/\s+/);
    if (!command) continue;

    const flags = rest.filter((token) => /^--[\w-]+$/.test(token));
    if (flags.length === 0) continue;

    const known = byCommand.get(command) ?? new Set<string>();
    flags.forEach((flag) => known.add(flag));
    byCommand.set(command, known);
  }
  return [...byCommand].map(([command, flags]) => ({ command, flags }));
}

/**
 * Every long-flag string (e.g. `--schema`) each registered command actually
 * accepts, read from its real Commander registration in `dist/` — covers
 * options added via `.option()`, `.requiredOption()`, and `.addOption()`
 * alike, since Commander stores all three the same way on `cmd.options`.
 */
async function realFlagsByCommand(): Promise<Map<string, Set<string>>> {
  const byCommand = new Map<string, Set<string>>();
  for (const modulePath of COMMAND_MODULES) {
    const { register } = (await import(commandModuleSpecifier(DIST_DIR, modulePath))) as {
      register: (program: Command) => void;
    };
    const program = new Command();
    register(program);
    const [cmd] = program.commands;
    const flags = new Set(cmd.options.flatMap((opt) => opt.flags.match(/--[\w-]+/g) ?? []));
    byCommand.set(cmd.name(), flags);
  }
  return byCommand;
}

describe("reference/cli-index.md flags exist on the real CLI (arpd-f3xm)", () => {
  it("every --flag shown against a command in cli-index.md is a real option on that command", async () => {
    const markdown = readFileSync(resolve(REPO_ROOT, "reference", "cli-index.md"), "utf8");
    const documented = parseDocumentedCommands(markdown);
    const real = await realFlagsByCommand();

    const drift: string[] = [];
    for (const { command, flags } of documented) {
      const realFlags = real.get(command);
      if (!realFlags) {
        drift.push(`\`satsuma ${command}\` is documented but is not a registered command`);
        continue;
      }
      for (const flag of flags) {
        if (!realFlags.has(flag)) {
          drift.push(
            `\`satsuma ${command} ${flag}\` is documented but ${command} has no such option`,
          );
        }
      }
    }

    assert.deepEqual(drift, []);
  });
});
