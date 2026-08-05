/**
 * satsuma agent-reference — Print the AI Agent Reference document.
 *
 * Outputs the Satsuma agent reference (grammar, cheat sheet, CLI guide,
 * workflow patterns) for pasting into an agent's system prompt or
 * instructions file. Content is baked in at build time from the canonical
 * `reference/*.md` sections (see reference/manifest.mjs at the repo root) —
 * this command never reads Markdown at runtime.
 *
 * Feature 45 added task-appropriate slicing on top of the original
 * print-everything command, so an agent that only writes or only reads
 * Satsuma need not pay for the half of the document it doesn't need:
 *
 *   satsuma agent-reference                    # unchanged: the whole document
 *   satsuma agent-reference --section grammar   # one named section
 *   satsuma agent-reference --profile write     # the slice a writing task needs
 *   satsuma agent-reference --profile read      # the slice a reading task needs
 *   satsuma agent-reference --list              # what sections exist, and which profile(s) need them
 *
 * Back-compatibility is a hard constraint: bare `satsuma agent-reference`
 * must keep printing byte-identical output to before this feature, because
 * it is a documented command that other tooling pipes today. See
 * scripts/agent-reference-compose.test.mjs at the repo root for the test
 * that enforces this against the canonical sections, and this package's own
 * agent-reference.test.ts for the CLI-level equivalent.
 */

import type { Command } from "commander";
import {
  AGENT_REFERENCE_TOKENIZER,
  agentReferenceSections,
  type AgentReferenceSection,
} from "../generated/agent-reference.js";
import { runCommand, CommandError, EXIT_PARSE_ERROR } from "../command-runner.js";
import { notFound } from "../errors.js";

/** Every profile any baked section declares membership in, e.g. ["write", "read"]. */
const knownProfiles = [...new Set(agentReferenceSections.flatMap((section) => section.profiles))];

type AgentReferenceOptions = {
  section?: string;
  profile?: string;
  list?: boolean;
};

export function register(program: Command): void {
  program
    .command("agent-reference")
    .description(
      "Print the AI Agent Reference — grammar, cheat sheet, CLI guide, and workflow patterns",
    )
    .option("--section <id>", "print one named section (see --list for ids)")
    .option(
      "--profile <profile>",
      `print the slice a task profile needs (${knownProfiles.join("|")})`,
    )
    .option("--list", "list section ids and which profile(s) need each one")
    .addHelpText(
      "after",
      `
Examples:
  satsuma agent-reference                     # the whole document, unchanged since before --section/--profile existed
  satsuma agent-reference --section grammar   # one section, e.g. for a harness that lazy-loads
  satsuma agent-reference --profile write     # grammar + conventions + mistakes + examples + generate-workflow
  satsuma agent-reference --profile read      # conventions + CLI command index/composition + read-workflow
  satsuma agent-reference --list              # every section id and its profile(s)`,
    )
    .action(
      runCommand((opts: AgentReferenceOptions) => {
        const flagsGiven = (["section", "profile", "list"] as const).filter(
          (flag) => opts[flag] !== undefined,
        );
        if (flagsGiven.length > 1) {
          throw new CommandError(
            `--${flagsGiven.join(" and --")} are mutually exclusive — pass at most one.`,
            EXIT_PARSE_ERROR,
          );
        }

        if (opts.list) {
          process.stdout.write(formatSectionList());
          return;
        }
        if (opts.section) {
          process.stdout.write(findSection(opts.section).content);
          return;
        }
        if (opts.profile) {
          process.stdout.write(composeProfile(opts.profile));
          return;
        }

        // Bare invocation — every section, in canonical document order, with
        // no separator inserted. Each section's own leading/trailing
        // whitespace and `---` dividers (sliced verbatim from the original
        // file) already do that job; see reference/compose.mjs's composeFull
        // for the repo-root equivalent this mirrors.
        process.stdout.write(agentReferenceSections.map((section) => section.content).join(""));
      }),
    );
}

/** Finds a baked section by id, or throws a `notFound` CommandError with suggestions. */
function findSection(id: string): AgentReferenceSection {
  const section = agentReferenceSections.find((candidate) => candidate.id === id);
  if (!section) {
    notFound(
      "Section",
      id,
      agentReferenceSections.map((candidate) => candidate.id),
    );
  }
  return section;
}

/** Composes the sections a given task profile needs, in canonical order. */
function composeProfile(profile: string): string {
  if (!knownProfiles.includes(profile)) {
    notFound("Profile", profile, knownProfiles);
  }
  return agentReferenceSections
    .filter((section) => section.profiles.includes(profile))
    .map((section) => section.content)
    .join("");
}

/**
 * Renders `--list`'s one-line-per-section summary: id, profiles, and a
 * measured (not estimated) token count under {@link AGENT_REFERENCE_TOKENIZER}
 * — see reference/token-cost.mjs for where that count comes from, and
 * scripts/measure-agent-reference-tokens.mjs for the fuller per-envelope
 * report this figure is one row of.
 */
function formatSectionList(): string {
  const idWidth = Math.max(...agentReferenceSections.map((section) => section.id.length));
  const tokenWidth = Math.max(
    ...agentReferenceSections.map((section) => String(section.tokenCost).length),
  );
  return (
    agentReferenceSections
      .map(
        (section) =>
          `${section.id.padEnd(idWidth)}  ` +
          `tokens=${String(section.tokenCost).padStart(tokenWidth)} (${AGENT_REFERENCE_TOKENIZER})  ` +
          `profiles=${section.profiles.join(",")}`,
      )
      .join("\n") + "\n"
  );
}
