#!/usr/bin/env node
/**
 * Regenerate viz-backend's field-chain parity fixture from the published CLI.
 *
 * Usage (from the repository root):
 *   npm --prefix tooling/satsuma-cli run build
 *   node scripts/regenerate-field-chain-golden.mjs
 *
 * The backend test reads the checked-in JSON and never executes or depends on
 * satsuma-cli. Running this explicit maintainer script is the only bridge: a CLI
 * contract change becomes a reviewable golden diff before the browser adapter
 * is updated to match it.
 */

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(
  repositoryRoot,
  "tooling/satsuma-viz-backend/test/fixtures/field-chain.stm",
);
const goldenPath = path.join(
  repositoryRoot,
  "tooling/satsuma-viz-backend/test/fixtures/field-chain.json",
);
const cliPath = path.join(repositoryRoot, "tooling/satsuma-cli/dist/index.js");

const result = spawnSync(
  process.execPath,
  [cliPath, "field-lineage", "curated.id", fixturePath, "--json"],
  { cwd: repositoryRoot, encoding: "utf8" },
);

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status ?? 1);
}

// Parse before writing so an accidental diagnostic on stdout cannot corrupt
// the fixture while still looking like successful command output.
const fieldChain = JSON.parse(result.stdout);
writeFileSync(goldenPath, `${JSON.stringify(fieldChain, null, 2)}\n`, "utf8");
process.stdout.write(`Updated ${path.relative(repositoryRoot, goldenPath)}\n`);
