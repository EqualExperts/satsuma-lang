#!/usr/bin/env node
/**
 * satsuma — Satsuma CLI entry point
 *
 * Dispatches to command modules under src/commands/.
 * Each command module exports a function that registers itself on the
 * commander Program object passed to it.
 */

import type { Command } from "commander";
import { program } from "commander";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { initParser } from "./parser.js";
import { commandModuleSpecifier } from "./command-loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Initialise the WASM parser before registering any commands.
await initParser(join(__dirname, "tree-sitter-satsuma.wasm"));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "../package.json"), "utf8"),
) as { version: string };

program
  .name("satsuma")
  .description(
    "Satsuma CLI — deterministic structural extraction for Satsuma workspaces.\n" +
    "Extracts structural facts and delivers NL content verbatim. Does not interpret natural language.\n\n" +
    "Run `satsuma <command> --help` for detailed usage, flags, and JSON output shape for each command.",
  )
  .version(pkg.version)
  .showHelpAfterError(true);

// Last-resort safety net for promise rejections that escape the runner.
// Every command handler is wrapped in `runCommand` (see command-runner.ts),
// which catches both CommandError and unknown errors and exits with the
// right code. This handler exists only for the narrow window *before*
// dispatch — e.g. if a dynamic command import below throws, or a future
// top-level await rejects. Inside that window we have no runner to lean
// on, so we mirror its formatting and exit code here.
process.on("unhandledRejection", (err: unknown) => {
  console.error(`Unhandled error: ${(err as { message?: string })?.message ?? String(err)}`);
  process.exit(2);
});

// Register commands — each module calls program.command(...)
const commands = [
  // Phase 1+: loaded as they are implemented
  "commands/summary.js",
  "commands/schema.js",
  "commands/metric.js",
  "commands/mapping.js",
  "commands/find.js",
  "commands/lineage.js",
  "commands/where-used.js",
  "commands/warnings.js",
  "commands/context.js",
  "commands/arrows.js",
  "commands/fields.js",
  "commands/nl.js",
  "commands/meta.js",
  "commands/match-fields.js",
  "commands/validate.js",
  "commands/diff.js",
  "commands/nl-refs.js",
  "commands/graph.js",
  "commands/lint.js",
  "commands/agent-reference.js",
  "commands/fmt.js",
  "commands/field-lineage.js",
];

for (const cmd of commands) {
  // Import via a file:// URL, not a raw path: Node's ESM loader rejects bare
  // absolute paths like "C:\…\summary.js" on Windows (gh-265). See command-loader.
  const mod = await import(commandModuleSpecifier(__dirname, cmd)) as { register: (program: Command) => void };
  mod.register(program);
}

program.parse(process.argv);
