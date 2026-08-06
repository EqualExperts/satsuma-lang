/**
 * generated-format-properties.test.js — Formatter properties over generated Satsuma.
 *
 * These checks extend the canonical examples corpus with bounded semantic
 * scenarios from `@satsuma/scenario-gen`. Inputs are rendered from declarations
 * and mappings, not arbitrary grammar text, and must parse without recovery
 * before the formatter is allowed to run.
 *
 * ## Two kinds of claim, and why both are here
 *
 * - **Shape** — idempotence, CST-structure preservation, a recovery-free reparse.
 *   These say the formatter's *output* is well-formed and stable.
 * - **Meaning** — the extracted semantic index survives formatting unchanged
 *   (`extract(parse(src))` deep-equals `extract(parse(format(src)))`).
 *
 * How the two relate is worth stating plainly, because the obvious assumption —
 * that the semantic claim catches damage the CST claim misses — is **wrong for the
 * formatter as it stands**, and a reader who believes otherwise will trust the
 * wrong test. `cstStructure` compares the named tree *including named leaf text*,
 * and every extractor is a pure function of exactly that. So identical CST
 * structure implies an identical semantic index: over the same generated domain,
 * breaking `formatMapArrow` to drop the trailing source of `a, b -> t` fails both
 * properties, not just the semantic one.
 *
 * The semantic property is kept anyway, for three reasons that are about contract
 * rather than about extra detection:
 *
 * 1. It states the claim **consumers actually depend on** — `format` composed with
 *    every extractor — instead of leaving it inferred from an argument about
 *    extractor purity that is true today and written down nowhere.
 * 2. It is the claim that **survives relaxation**. `cstStructure`'s inclusion of
 *    leaf text is a serializer choice, not a contract; the day the formatter gains
 *    a legal normalisation that changes named structure, the CST property must be
 *    weakened and this one must not be.
 * 3. It is **layout-blind by construction** (see `semantic-index.js`), so a
 *    shape-only defect such as a changed indent width fails the corpus golden
 *    tests in `format.test.js` and leaves this property green — verified, because a
 *    property that fired on both would not be testing meaning.
 *
 * ## Both domains, both claims
 *
 * Every property runs over two generated domains, because the older
 * single-mapping domain reaches neither multi-source arrows nor containers,
 * namespaces, imports, NL `@ref`s, computed arrows or metric metadata — the
 * constructs most of the formatter's code exists to lay out.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { collectParseErrors, format, getParser, initParser } from "@satsuma/core";
import { cstStructure } from "./support/cst-structure.js";
import {
  GENERATED_PROPERTY_PARAMETERS,
  semanticScenarioArbitrary,
  workspaceScenarioArbitrary,
} from "@satsuma/scenario-gen";
import { semanticIndexOf } from "./support/semantic-index.js";
import {
  parseGeneratedScenario,
  parseGeneratedWorkspaceFiles,
} from "./support/scenario-pipeline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(__dirname, "../../tree-sitter-satsuma/tree-sitter-satsuma.wasm");

before(async () => {
  await initParser(WASM_PATH);
});

// ── Driving one file through the formatter ─────────────────────────────────────

/** Format one strictly parsed source file and reparse the formatter output. */
function formatParsed(source, tree) {
  const formatted = format(tree, source);
  const formattedTree = getParser().parse(formatted);
  assert.ok(
    formattedTree,
    `formatter output returned no parse tree:\nSOURCE\n${source}\nFORMATTED\n${formatted}`,
  );
  return {
    formatted,
    formattedTree,
    formattedErrors: collectParseErrors(formattedTree),
  };
}

/**
 * The two generated domains, each reduced to a list of `(label, source, tree)`
 * files a property can loop over.
 *
 * A single-file scenario yields one entry with an empty label; a workspace yields
 * one per file, labelled with its path so a counterexample says which file failed.
 * Expressing both as the same shape is what lets every property below state its
 * claim once and run it over both.
 */
const GENERATED_FILE_DOMAINS = [
  {
    name: "single-mapping scenarios",
    arbitrary: semanticScenarioArbitrary,
    files: (scenario) => {
      const { source, tree } = parseGeneratedScenario(scenario);
      return [{ label: "", source, tree }];
    },
  },
  {
    name: "workspace files",
    arbitrary: workspaceScenarioArbitrary,
    files: (workspace) =>
      parseGeneratedWorkspaceFiles(workspace).map(({ path, source, tree }) => ({
        label: ` in '${path}'`,
        source,
        tree,
      })),
  },
];

/** Run `check(file)` over every file of every sample drawn from one domain. */
function forEachGeneratedFile(domain, check) {
  fc.assert(
    fc.property(domain.arbitrary, (sample) => {
      for (const file of domain.files(sample)) check(file);
    }),
    GENERATED_PROPERTY_PARAMETERS,
  );
}

// ── Shape claims ──────────────────────────────────────────────────────────────

/** Formatting twice must be byte-identical to formatting once. */
function assertIdempotent({ label, source, tree }) {
  const { formatted, formattedTree, formattedErrors } = formatParsed(source, tree);
  assert.deepEqual(
    formattedErrors,
    [],
    `first formatter pass introduced recovery${label}:\nSOURCE\n${source}\nFORMATTED\n${formatted}`,
  );
  const formattedTwice = format(formattedTree, formatted);
  assert.equal(
    formattedTwice,
    formatted,
    `formatter is not idempotent${label}:\nSOURCE\n${source}\nFIRST\n${formatted}\nSECOND\n${formattedTwice}`,
  );
}

/** Named grammar structure and named leaf text must survive formatting. */
function assertCstStructurePreserved({ label, source, tree }) {
  const { formatted, formattedTree, formattedErrors } = formatParsed(source, tree);
  assert.deepEqual(
    formattedErrors,
    [],
    `structural comparison requires a clean reparse${label}:\nSOURCE\n${source}\nFORMATTED\n${formatted}`,
  );
  assert.equal(
    cstStructure(formattedTree.rootNode),
    cstStructure(tree.rootNode),
    `formatter changed generated CST structure${label}:\nSOURCE\n${source}\nFORMATTED\n${formatted}`,
  );
}

/** Formatter output must reparse with no ERROR or MISSING recovery node. */
function assertNoRecoveryNodes({ label, source, tree }) {
  const { formatted, formattedErrors } = formatParsed(source, tree);
  assert.deepEqual(
    formattedErrors,
    [],
    `formatter introduced recovery nodes${label}:\nSOURCE\n${source}\nFORMATTED\n${formatted}`,
  );
}

// ── The meaning claim ─────────────────────────────────────────────────────────

/**
 * Formatting must change nothing the toolchain extracts — at the first pass and
 * at every pass after it.
 *
 * The second half is the semantic partner of textual idempotence: idempotence says
 * the *bytes* settle after one pass, this says the *meaning* is the same at every
 * pass. A formatter whose first pass lost an arrow source and whose second pass was
 * byte-stable would satisfy the textual claim and fail this one.
 */
function assertSemanticsPreserved({ label, source, tree }) {
  const { formatted, formattedTree, formattedErrors } = formatParsed(source, tree);
  assert.deepEqual(
    formattedErrors,
    [],
    `semantic comparison requires a clean reparse${label}:\nSOURCE\n${source}\nFORMATTED\n${formatted}`,
  );

  const meaning = semanticIndexOf(tree.rootNode);
  assert.deepEqual(
    semanticIndexOf(formattedTree.rootNode),
    meaning,
    `formatting changed what the toolchain extracts${label}:\nSOURCE\n${source}\nFORMATTED\n${formatted}`,
  );

  const twice = formatParsed(formatted, formattedTree);
  assert.deepEqual(
    semanticIndexOf(twice.formattedTree.rootNode),
    meaning,
    `a second formatter pass changed what the toolchain extracts${label}:` +
      `\nSOURCE\n${source}\nFIRST\n${formatted}\nSECOND\n${twice.formatted}`,
  );
}

// ── The suites ────────────────────────────────────────────────────────────────

for (const domain of GENERATED_FILE_DOMAINS) {
  describe(`generated formatter properties over ${domain.name}`, () => {
    it("is idempotent over generated recovery-free Satsuma", () => {
      // Formatter idempotence: once canonical layout is produced, a second pass
      // must be byte-identical, so a repository-wide `satsuma fmt` converges.
      forEachGeneratedFile(domain, assertIdempotent);
    });

    it("preserves generated CST structure", () => {
      // Structural equivalence: formatting may change layout and anonymous
      // punctuation placement, never named grammar structure or semantic leaves.
      forEachGeneratedFile(domain, assertCstStructurePreserved);
    });

    it("reparses generated formatter output without recovery nodes", () => {
      // Error-free reparse: a formatter must never turn a valid generated file
      // into one that tree-sitter repairs with ERROR or MISSING nodes.
      forEachGeneratedFile(domain, assertNoRecoveryNodes);
    });

    it("extracts the same semantic index before and after formatting", () => {
      // Meaning preservation across the whole pipeline the formatter can damage.
      // The defect class this defends against is a formatter that rewrites a
      // construct rather than re-laying it out — dropping the trailing source of
      // `a, b -> t`, re-associating a pipe chain, or losing a container's
      // relative-path qualification. Each one changes what every downstream
      // consumer reads while leaving a well-formed file behind.
      forEachGeneratedFile(domain, assertSemanticsPreserved);
    });
  });
}
