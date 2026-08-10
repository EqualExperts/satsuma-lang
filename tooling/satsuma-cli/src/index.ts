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
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { initParser } from "./parser.js";
import { COMMAND_MODULES, commandModuleSpecifier } from "./command-loader.js";
import { BUILD_VERSION } from "./generated/build-version.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Initialise the WASM parser before registering any commands.
await initParser(join(__dirname, "tree-sitter-satsuma.wasm"));

program
  .name("satsuma")
  .description(
    "Satsuma CLI — deterministic structural extraction for Satsuma workspaces.\n" +
      "Extracts structural facts and delivers NL content verbatim. Does not interpret natural language.\n\n" +
      "Run `satsuma <command> --help` for detailed usage, flags, and JSON output shape for each command.",
  )
  .version(BUILD_VERSION)
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

// Register commands — each module calls program.command(...). The module
// list itself lives in command-loader.ts's COMMAND_MODULES, so anything else
// that needs to enumerate every command (e.g. the token-cost comparison in
// scripts/measure-agent-reference-tokens.mjs) reads the same source.
for (const cmd of COMMAND_MODULES) {
  // Import via a file:// URL, not a raw path: Node's ESM loader rejects bare
  // absolute paths like "C:\…\summary.js" on Windows (gh-265). See command-loader.
  const mod = (await import(commandModuleSpecifier(__dirname, cmd))) as {
    register: (program: Command) => void;
  };
  mod.register(program);
}

program.parse(process.argv);
