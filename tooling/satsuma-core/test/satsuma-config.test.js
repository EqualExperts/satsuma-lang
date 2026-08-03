/**
 * satsuma-config.test.js — parsing and validation of `satsuma.config.yaml`.
 *
 * These tests own the config *semantics*: what a well-formed config means,
 * what makes one unusable, and the suppression-precedence rule shared by every
 * consumer. Filesystem concerns (default path, `--config` override, missing
 * file) belong to each consumer and are tested there — the CLI's
 * `load-config.test.ts` covers the CLI's half.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SATSUMA_CONFIG,
  SATSUMA_CONFIG_FILENAME,
  parseSatsumaConfig,
  resolveSuppressedRuleIds,
  unknownRuleIds,
} from "@satsuma/core/config";

// Rule ids used throughout. Real ids from the CLI's registry, so a rename that
// breaks the CLI's `--ignore` validation shows up as a failure here too.
const KNOWN_RULES = ["hidden-source-in-nl", "unresolved-nl-ref", "duplicate-definition"];

// ── The config file's identity ──────────────────────────────────────────────

describe("config file naming", () => {
  it("names the config file so it cannot be mistaken for a Satsuma source file", () => {
    // Doc review 2026-07-31 rejected `.satsumacfg` precisely because `.satsuma`
    // is a source extension. If someone renames this constant back to a
    // dotfile-style name, that decision is being reversed silently.
    assert.equal(SATSUMA_CONFIG_FILENAME, "satsuma.config.yaml");
  });
});

// ── Defaults: a workspace with no config behaves as if fully permissive ─────

describe("default configuration", () => {
  it("suppresses nothing, aliases nothing, and leaves strict mode off", () => {
    // These defaults are what a workspace without a config file gets. Any
    // change here silently alters behaviour for every existing workspace.
    assert.deepEqual(DEFAULT_SATSUMA_CONFIG.lint.suppress, []);
    assert.deepEqual(DEFAULT_SATSUMA_CONFIG.lint.typeAliases, []);
    assert.equal(DEFAULT_SATSUMA_CONFIG.lint.strict, false);
  });

  it("treats an empty document as the default config rather than an error", () => {
    // A file someone created but has not filled in yet is not a broken file.
    const result = parseSatsumaConfig("", { knownRuleIds: KNOWN_RULES });
    assert.equal(result.ok, true);
    assert.deepEqual(result.config, DEFAULT_SATSUMA_CONFIG);
  });

  it("fills in the sections the author omitted", () => {
    // Partial configs are the common case: setting `strict` must not blank out
    // the suppress/typeAliases defaults.
    const result = parseSatsumaConfig("lint:\n  strict: true\n", { knownRuleIds: KNOWN_RULES });
    assert.equal(result.ok, true);
    assert.equal(result.config.lint.strict, true);
    assert.deepEqual(result.config.lint.suppress, []);
    assert.deepEqual(result.config.lint.typeAliases, []);
  });
});

// ── lint.suppress ──────────────────────────────────────────────────────────

describe("lint.suppress", () => {
  it("parses a list of rule ids to suppress workspace-wide", () => {
    const result = parseSatsumaConfig("lint:\n  suppress:\n    - unresolved-nl-ref\n", {
      knownRuleIds: KNOWN_RULES,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.config.lint.suppress, ["unresolved-nl-ref"]);
  });

  it("rejects an unknown rule id so a typo cannot silently disable nothing", () => {
    // The failure mode this prevents: `supress: [unresolvd-nl-ref]` looks like
    // it works, changes nothing, and the author believes the rule is off.
    const result = parseSatsumaConfig("lint:\n  suppress:\n    - unresolvd-nl-ref\n", {
      knownRuleIds: KNOWN_RULES,
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /unresolvd-nl-ref/);
  });

  it("names the valid rule ids when reporting an unknown one", () => {
    // An error that says only "unknown rule" forces the author to go hunting.
    const result = parseSatsumaConfig("lint:\n  suppress:\n    - nope\n", {
      knownRuleIds: KNOWN_RULES,
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /hidden-source-in-nl/);
  });

  it("accepts any rule id when the caller supplies no registry to check against", () => {
    // The LSP may parse a config before its rule set is known. Validation is
    // opt-in so an unvalidated parse cannot reject a config the CLI accepts.
    const result = parseSatsumaConfig("lint:\n  suppress:\n    - anything-at-all\n");
    assert.equal(result.ok, true);
    assert.deepEqual(result.config.lint.suppress, ["anything-at-all"]);
  });

  it("rejects a bare string where a list of rule ids is required", () => {
    // YAML makes `suppress: unresolved-nl-ref` easy to write; silently
    // iterating its characters would suppress nothing and report nothing.
    const result = parseSatsumaConfig("lint:\n  suppress: unresolved-nl-ref\n", {
      knownRuleIds: KNOWN_RULES,
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /lint\.suppress/);
  });
});

// ── lint.typeAliases ───────────────────────────────────────────────────────

describe("lint.typeAliases", () => {
  it("parses alias groups as groups, preserving which types are equivalent to which", () => {
    // Flattening the groups into one set would make STRING equivalent to INT
    // as soon as a workspace declares both groups.
    const yaml = [
      "lint:",
      "  typeAliases:",
      "    - [STRING, TEXT, VARCHAR]",
      "    - [INT, INTEGER]",
    ].join("\n");
    const result = parseSatsumaConfig(yaml, { knownRuleIds: KNOWN_RULES });
    assert.equal(result.ok, true);
    assert.deepEqual(result.config.lint.typeAliases, [
      ["STRING", "TEXT", "VARCHAR"],
      ["INT", "INTEGER"],
    ]);
  });

  it("rejects a group with fewer than two members as a no-op the author did not intend", () => {
    // A one-member group declares nothing equivalent to anything. Accepting it
    // silently would hide an unfinished edit.
    const result = parseSatsumaConfig("lint:\n  typeAliases:\n    - [STRING]\n", {
      knownRuleIds: KNOWN_RULES,
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /at least two/i);
  });

  it("rejects a non-string alias member rather than coercing it", () => {
    // `- [1, INT]` — YAML types the 1 as a number; coercing it would make the
    // config's meaning depend on quoting.
    const result = parseSatsumaConfig("lint:\n  typeAliases:\n    - [1, INT]\n", {
      knownRuleIds: KNOWN_RULES,
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /lint\.typeAliases/);
  });
});

// ── lint.strict ────────────────────────────────────────────────────────────

describe("lint.strict", () => {
  it("rejects a non-boolean strict flag rather than treating it as truthy", () => {
    // `strict: "no"` is a non-empty string. Truthiness would turn an explicit
    // "off" into "on" — the opposite of what the author wrote.
    const result = parseSatsumaConfig('lint:\n  strict: "no"\n', { knownRuleIds: KNOWN_RULES });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /lint\.strict/);
  });
});

// ── Malformed and unrecognised input ───────────────────────────────────────

describe("malformed configuration", () => {
  it("reports a YAML syntax error with its location instead of throwing", () => {
    // Consumers map errors to their own exit code, so the parser must return
    // them rather than throw a YAMLParseError through the call stack.
    const result = parseSatsumaConfig("lint:\n  suppress: [unclosed\n");
    assert.equal(result.ok, false);
    assert.ok(result.errors.length > 0);
  });

  it("rejects a document whose root is not a mapping", () => {
    // A list or scalar at the root means the author has the shape wrong; every
    // key lookup below would silently miss.
    const result = parseSatsumaConfig("- lint\n");
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /mapping/i);
  });

  it("warns about an unknown top-level key without rejecting the config", () => {
    // Forward compatibility: a config written for a newer CLI should still run,
    // but a misspelled section must not pass unnoticed.
    const result = parseSatsumaConfig("lnit:\n  strict: true\n", { knownRuleIds: KNOWN_RULES });
    assert.equal(result.ok, true);
    assert.match(result.warnings.join("\n"), /lnit/);
  });

  it("warns about an unknown key inside the lint section", () => {
    // Same reasoning one level down: `lint.supress` is the likeliest typo of
    // all and must not be silently ignored.
    const result = parseSatsumaConfig("lint:\n  supress:\n    - unresolved-nl-ref\n", {
      knownRuleIds: KNOWN_RULES,
    });
    assert.equal(result.ok, true);
    assert.match(result.warnings.join("\n"), /supress/);
  });
});

// ── Rule-id validation shared with the CLI's --ignore/--select flags ───────

describe("unknownRuleIds", () => {
  it("returns the ids not present in the registry, preserving the author's spelling", () => {
    // The caller echoes these back in its message, so the original spelling is
    // what the author needs to see.
    assert.deepEqual(unknownRuleIds(["unresolved-nl-ref", "Nope"], KNOWN_RULES), ["Nope"]);
  });

  it("treats rule ids as case-sensitive", () => {
    // Rule ids are lowercase-kebab identifiers, not prose. Accepting
    // `Unresolved-NL-Ref` would make the config's vocabulary ambiguous.
    assert.deepEqual(unknownRuleIds(["UNRESOLVED-NL-REF"], KNOWN_RULES), ["UNRESOLVED-NL-REF"]);
  });
});

// ── Suppression precedence (PRD 37 R4) ─────────────────────────────────────

describe("resolveSuppressedRuleIds", () => {
  it("suppresses the union of --ignore and lint.suppress", () => {
    // The stated rule: config suppression is the persistent form of --ignore,
    // so both apply together rather than one replacing the other.
    const suppressed = resolveSuppressedRuleIds({
      ignore: ["hidden-source-in-nl"],
      configSuppress: ["unresolved-nl-ref"],
    });
    assert.deepEqual([...suppressed].sort(), ["hidden-source-in-nl", "unresolved-nl-ref"]);
  });

  it("runs a config-suppressed rule when --select names it explicitly", () => {
    // Naming a rule on the command line is an unambiguous instruction to run
    // it; the persistent config must not override a direct request.
    const suppressed = resolveSuppressedRuleIds({
      select: ["unresolved-nl-ref"],
      configSuppress: ["unresolved-nl-ref"],
    });
    assert.deepEqual([...suppressed], []);
  });

  it("keeps --ignore winning over --select when both name the same rule", () => {
    // Pre-existing flag behaviour (runLint applies select then ignore). Config
    // precedence must not quietly change how two flags interact.
    const suppressed = resolveSuppressedRuleIds({
      select: ["unresolved-nl-ref"],
      ignore: ["unresolved-nl-ref"],
      configSuppress: [],
    });
    assert.deepEqual([...suppressed], ["unresolved-nl-ref"]);
  });

  it("still suppresses config-suppressed rules that --select does not name", () => {
    // --select rescues only the rules it names, not every suppressed rule.
    const suppressed = resolveSuppressedRuleIds({
      select: ["hidden-source-in-nl"],
      configSuppress: ["unresolved-nl-ref"],
    });
    assert.deepEqual([...suppressed], ["unresolved-nl-ref"]);
  });
});
