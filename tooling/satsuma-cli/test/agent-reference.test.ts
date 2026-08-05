/**
 * agent-reference.test.ts — Focused CLI coverage for `satsuma agent-reference`.
 *
 * Exercises the real command's --section/--profile/--list slicing (Feature
 * 45) and the back-compat guarantee that bare invocation is unchanged.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run as runCli } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../dist/index.js");
const REPO_ROOT = resolve(__dirname, "../../..");

const run = (...args: string[]) => runCli(CLI, ...args);

describe("satsuma agent-reference", () => {
  it("prints byte-identical output to AI-AGENT-REFERENCE.md with no flags", async () => {
    // The hard back-compat constraint from Feature 45's PRD: anything piping
    // bare `agent-reference` today (SATSUMA-CLI.md's own documented usage,
    // site/cli.njk) must keep working unchanged even though the content now
    // composes from reference/*.md instead of one baked file.
    const { stdout, code } = await run("agent-reference");
    const current = readFileSync(resolve(REPO_ROOT, "AI-AGENT-REFERENCE.md"), "utf8");

    assert.equal(code, 0);
    assert.equal(stdout, current);
  });

  it("--list reports every canonical section and the profile(s) that need it", async () => {
    // This is the discovery surface an agent (or a human) uses before reaching
    // for --section — it must name every section that --section can resolve.
    const { stdout, code } = await run("agent-reference", "--list");

    assert.equal(code, 0);
    for (const id of [
      "grammar",
      "conventions",
      "mistakes",
      "examples",
      "cli-index",
      "cli-composition",
      "workflow-generate",
      "workflow-read",
    ]) {
      assert.match(
        stdout,
        new RegExp(`^${id}\\s+tokens=\\s*\\d+ \\(o200k_base\\)\\s+profiles=`, "m"),
      );
    }
    // conventions is the one section both profiles need — a superset, not a
    // minimal cut, per the PRD's risk mitigation for missing-content gaps.
    assert.match(stdout, /^conventions\s+tokens=\s*\d+ \(o200k_base\)\s+profiles=write,read/m);
  });

  it("--list's token counts are a real tokenizer measurement of each section's own content, not a byte-count estimate", async () => {
    // The PRD's whole complaint about the pre-Feature-45 document was that
    // every ≈-token figure was bytes/4. This proves --list's numbers are
    // measured from the same content --section prints, under the tokenizer
    // reference/token-cost.mjs uses — not a guess that could silently drift
    // from what a --section call actually costs.
    const { getEncoding } = await import("js-tiktoken");
    const encoding = getEncoding("o200k_base");

    const { stdout: listing } = await run("agent-reference", "--list");
    const { stdout: grammarSection } = await run("agent-reference", "--section", "grammar");

    const grammarListing = listing.match(/^grammar\s+tokens=\s*(\d+) \(o200k_base\)/m);
    assert.ok(grammarListing, "expected a tokens=<n> (o200k_base) entry for the grammar section");
    assert.equal(Number(grammarListing![1]), encoding.encode(grammarSection).length);
  });

  it("every id --list reports resolves via --section (arpd-f3xm)", async () => {
    // --list is the discovery surface; --section is how you act on it. If
    // the two ever disagreed — --list naming an id --section rejects, or
    // vice versa — an agent would follow --list's advice into a dead end.
    const { stdout: listing } = await run("agent-reference", "--list");
    const ids = [...listing.matchAll(/^(\S+)\s+tokens=/gm)].map((match) => match[1]);

    assert.ok(ids.length > 0, "expected --list to report at least one section id");
    for (const id of ids) {
      const { stdout, code } = await run("agent-reference", "--section", id);
      assert.equal(code, 0, `--section ${id} (listed by --list) should succeed`);
      assert.ok(stdout.length > 0, `--section ${id} should print non-empty content`);
    }
  });

  it("--section prints exactly one named section, not the whole document", async () => {
    const { stdout, code } = await run("agent-reference", "--section", "grammar");

    assert.equal(code, 0);
    assert.match(stdout, /### Grammar \(compact EBNF\)/);
    assert.doesNotMatch(stdout, /## Satsuma CLI — Agent Tooling/);
  });

  it("--section reports a not-found error with the available ids for a typo'd name", async () => {
    const { stderr, code } = await run("agent-reference", "--section", "gramar");

    assert.equal(code, 1);
    assert.match(stderr, /Section 'gramar' not found. Did you mean 'grammar'\?/);
  });

  it("--profile write includes the grammar and workflow-generate sections but not the CLI command index", async () => {
    // Task-need analysis: a codegen task needs the EBNF and the generate
    // workflow, and should not pay for the CLI section it doesn't use.
    const { stdout, code } = await run("agent-reference", "--profile", "write");

    assert.equal(code, 0);
    assert.match(stdout, /### Grammar \(compact EBNF\)/);
    assert.match(stdout, /### When generating Satsuma from a description or spreadsheet:/);
    assert.doesNotMatch(stdout, /### Command reference/);
  });

  it("--profile read includes the CLI command index but not the EBNF grammar", async () => {
    // Task-need analysis: a lineage/coverage/audit task needs the command
    // surface, not the grammar it will never author.
    const { stdout, code } = await run("agent-reference", "--profile", "read");

    assert.equal(code, 0);
    assert.match(stdout, /### Command reference/);
    assert.doesNotMatch(stdout, /### Grammar \(compact EBNF\)/);
  });

  it("--profile rejects an unknown profile name with the available ones", async () => {
    const { stderr, code } = await run("agent-reference", "--profile", "review");

    assert.equal(code, 1);
    assert.match(stderr, /Profile 'review' not found\./);
    assert.match(stderr, /Available: write, read/);
  });

  it("rejects combining --section and --profile rather than silently picking one", async () => {
    const { stderr, code } = await run(
      "agent-reference",
      "--section",
      "grammar",
      "--profile",
      "write",
    );

    assert.equal(code, 2);
    assert.match(stderr, /--section and --profile are mutually exclusive/);
  });
});
