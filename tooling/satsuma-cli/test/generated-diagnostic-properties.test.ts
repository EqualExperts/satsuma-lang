/**
 * generated-diagnostic-properties.test.ts — `validate` and `lint`, over
 * workspaces broken one defect at a time.
 *
 * Every other generated workspace in this repository is valid by construction, so
 * until now the whole diagnostic surface was proved only by fixtures a person
 * wrote (Feature 46 PRD, gap 1). Fixtures are written asking *"does it catch
 * this?"*, and almost never *"does it stay quiet on that?"* — which is why
 * spurious diagnostics on legal-but-unusual input reach users more often than
 * missed ones do. Both directions are asserted here.
 *
 * The negative half of the generator is `@satsuma/scenario-gen`'s `mutators.js`:
 * a mutator takes a workspace that validates clean, breaks exactly one thing, and
 * states every diagnostic that break causes. Nothing in this file re-derives an
 * expected diagnostic from production code — the prediction is the mutator's, and
 * this file only compares.
 *
 * ## What is asserted, and in which direction
 *
 * - **Set equality, both ways.** The diagnostics a mutated workspace produces
 *   must match the mutation's prediction exactly: an unmatched prediction is a
 *   *missed* diagnostic, an unmatched observation is a *spurious* one.
 * - **Positions land inside the mutated construct** — never on an exact line.
 *   PRD decision 4: an exact line would couple these properties to layout choices
 *   `scenario-gen`'s renderer deliberately owns, and the probe that shaped this
 *   file confirmed the hint is routinely three lines off the reported position.
 * - **A meaning-preserving change adds nothing.** Reordering declarations,
 *   splitting them across files, and renaming an entity consistently must each
 *   leave the workspace clean.
 * - **`--select` and `--ignore` partition the findings**, so the two flags cannot
 *   drift into filtering different things.
 *
 * This file changes no diagnostic semantics, no rule severity and no output. A
 * property that fails against current behaviour is a bug ticket (Feature 46 PRD).
 *
 * ## Three things the comparison has to get right
 *
 * **1. Compare multisets, not sets.** One mutation can predict two diagnostics
 * that agree on `(rule, file, entity)` and differ only in which arrow raised them
 * — deleting a mid-chain field is reported once as a target and once as a source.
 * Collapsing the prediction into a set would silently stop checking the cascade
 * the mutator contract exists to state.
 *
 * **2. `entity` is only observable through the message.** Neither
 * `SemanticDiagnostic` nor `LintDiagnostic` carries an entity field, so "which
 * construct is this diagnostic about" is a substring test. Substring tests are not
 * one-to-one — `field_0` is contained in a message that names `s0.field_0` — so
 * pairing predictions with observations greedily can fail on a workspace where a
 * correct pairing exists. {@link maximumMatching} pairs them exactly instead.
 *
 * **3. The baseline must be asserted, not assumed.** Every property below asserts
 * the *pre-mutation* workspace is clean on the surface under test before applying
 * the mutation, and treats an inapplicable mutation as a skipped sample rather
 * than a pass. A vacuous mutation that looked like a mutation is the one failure
 * mode this whole design guards against, and it would otherwise read as a
 * property that passes.
 *
 * ## The one generated domain that is not clean to begin with
 *
 * `cyclicWorkspaceArbitrary` declares a real lineage cycle, so it carries a
 * `lineage-cycle` finding before any mutation. It is semantically valid, so only
 * the lint surface is affected; {@link workspaceHasSchemaCycle} excludes it there
 * and the validate properties keep the domain.
 */

import assert from "node:assert/strict";
import { basename } from "node:path";
import { describe, it } from "node:test";
import fc from "fast-check";
import {
  DEFECT_MUTATORS,
  DIAGNOSTIC_RULES,
  GENERATED_PROPERTY_PARAMETERS,
  NULL_MUTATORS,
  expectedForSurface,
  isWorkspaceDefect,
  workspaceHasSchemaCycle,
  workspaceScenarioArbitrary,
} from "@satsuma/scenario-gen";
import type { ScenarioWorkspace } from "@satsuma/scenario-gen";
import { collectSemanticWarnings } from "#src/semantic-warnings.js";
import { RULES, runLint } from "#src/lint-engine.js";
import { register as registerLint } from "#src/commands/lint.js";
import type { LintDiagnostic } from "#src/types.js";
import { runCliCommand } from "./support/run-cli-command.js";
import {
  disposeGeneratedWorkspace,
  loadGeneratedWorkspace,
} from "./support/generated-workspace.js";
import type { LoadedGeneratedWorkspace } from "./support/generated-workspace.js";

// The WASM parser is initialised by `test/setup.ts`, which the test script
// preloads with `--import`.

// ── The two diagnostic surfaces ────────────────────────────────────────────

/** A command whose registry a mutator can predict against. */
type DiagnosticSurface = "validate" | "lint";

const VALIDATE: DiagnosticSurface = "validate";
const LINT: DiagnosticSurface = "lint";

/**
 * Every diagnostic one surface reports for a loaded workspace.
 *
 * `validate` is read through `collectSemanticWarnings` rather than through the
 * command, because the command's `--json` payload carries no `rule` field and the
 * prediction is named by rule id. `lint` is read through the engine for the same
 * reason the rest of the CLI's rule tests do: `runLint` *is* the registry, and the
 * command adds only config loading and formatting on top. The one property that
 * genuinely concerns the command's flags drives the command itself — see
 * "`--select` and `--ignore`" below.
 */
function observedDiagnostics(
  loaded: LoadedGeneratedWorkspace,
  surface: DiagnosticSurface,
): LintDiagnostic[] {
  return surface === VALIDATE ? collectSemanticWarnings(loaded.index) : runLint(loaded.index);
}

/** A loaded workspace's diagnostics, rendered for an assertion message. */
function describeDiagnostics(diagnostics: LintDiagnostic[]): string {
  if (diagnostics.length === 0) return "(none)";
  return diagnostics
    .map((d) => `    ${d.rule} at ${basename(d.file)}:${d.line} — ${d.message}`)
    .join("\n");
}

// ── Pairing predictions with observations ──────────────────────────────────

/**
 * Does this observation satisfy this prediction, ignoring position?
 *
 * The three observable coordinates of a prediction: its rule id, its file (which
 * the mutator states workspace-relative, so basenames are compared), and its
 * entity — which only exists in the message, because no diagnostic type carries
 * one.
 */
function satisfiesPrediction(
  prediction: { rule: string; file: string; entity: string },
  observation: LintDiagnostic,
): boolean {
  return (
    prediction.rule === observation.rule &&
    prediction.file === basename(observation.file) &&
    observation.message.includes(prediction.entity)
  );
}

/**
 * Pair as many predictions with observations as possible, and report the rest.
 *
 * A maximum bipartite matching (Kuhn's algorithm) rather than a greedy pass,
 * because {@link satisfiesPrediction} is not one-to-one: a message naming
 * `s0.field_0` also contains the entity `field_0`, so a greedy walk can consume
 * the only observation another prediction could have used and report a missed
 * *and* a spurious diagnostic where a valid pairing exists. The sets here are a
 * handful of entries each, so an exact algorithm costs nothing.
 *
 * Returns the indices left unpaired on each side: unpaired predictions are missed
 * diagnostics, unpaired observations are spurious ones.
 */
function maximumMatching(
  predictionCount: number,
  observationCount: number,
  pairs: (prediction: number, observation: number) => boolean,
): { pairedWith: number[]; missed: number[]; spurious: number[] } {
  // `pairedWith[o]` is the prediction paired with observation `o`, or -1.
  const pairedWith = new Array<number>(observationCount).fill(-1);

  /** Augmenting-path search: can this prediction claim an observation? */
  const claim = (prediction: number, visited: boolean[]): boolean => {
    for (let observation = 0; observation < observationCount; observation += 1) {
      if (visited[observation] || !pairs(prediction, observation)) continue;
      visited[observation] = true;
      const heldBy = pairedWith[observation];
      if (heldBy === -1 || claim(heldBy, visited)) {
        pairedWith[observation] = prediction;
        return true;
      }
    }
    return false;
  };

  const matched = new Set<number>();
  for (let prediction = 0; prediction < predictionCount; prediction += 1) {
    if (claim(prediction, new Array<boolean>(observationCount).fill(false))) {
      matched.add(prediction);
    }
  }

  return {
    pairedWith,
    missed: [...Array(predictionCount).keys()].filter((p) => !matched.has(p)),
    spurious: [...Array(observationCount).keys()].filter((o) => pairedWith[o] === -1),
  };
}

// ── Positions, as containment in a construct ───────────────────────────────

/** A top-level declaration of one file: its 1-based row span and header line. */
interface DeclarationSpan {
  /** CST node type — `schema_block`, `mapping_block`, `namespace_block`, … */
  kind: string;
  /** 1-based row of the declaration's first line, matching a diagnostic's `line`. */
  start: number;
  /** 1-based row of the declaration's last line, inclusive. */
  end: number;
  /** The text of the first line, which identifies the construct to a reader. */
  header: string;
}

/**
 * The top-level declaration spans of one loaded file.
 *
 * Read from the CST rather than the extracted index because no extracted record
 * carries an *end* row — `SchemaRecord.row` and its siblings are start rows only —
 * and containment needs both. Reading them from the parse tree also keeps this
 * independent of how `scenario-gen`'s renderer lays a declaration out, which is
 * the coupling PRD decision 4 rules out.
 */
function declarationSpans(loaded: LoadedGeneratedWorkspace, file: string): DeclarationSpan[] {
  const parsed = loaded.parsed.find((candidate) => candidate.filePath === file);
  if (parsed === undefined) return [];
  const lines = parsed.src.split("\n");
  return parsed.tree.rootNode.namedChildren.map((node) => ({
    kind: node.type,
    start: node.startPosition.row + 1,
    end: node.endPosition.row + 1,
    header: lines[node.startPosition.row] ?? "",
  }));
}

/**
 * Rules whose anchor is a property of the rule's own search, not of the mutation.
 *
 * `lineage-cycle` reports one finding per strongly connected component, "against
 * the mapping declaring the first hop of a representative path through it"
 * (`closeLineageCycle`'s own doc-comment). Which mapping that is depends on the
 * order the rule's traversal happens to reach the component, so no mutation can
 * name it — predicting it here would make this file a second implementation of
 * the rule's path search, which PRD decision 1 rules out. For these rules
 * containment is asserted only to the *kind* of construct and the file, both of
 * which the mutation genuinely does determine.
 */
const ANCHOR_NOT_PREDICTABLE_BY_MUTATION: ReadonlySet<string> = new Set([
  DIAGNOSTIC_RULES.lineageCycle,
]);

/**
 * Does an observed position land inside the construct the mutation broke?
 *
 * The prediction's `line` is a *hint* — the first line of the construct the
 * diagnostic should sit inside — and is never compared for equality. The
 * assertion is that the hint and the observed position fall inside the same
 * top-level declaration, with two deliberate relaxations:
 *
 * - **An identical header counts as the same construct.** The two duplicate
 *   mutators add a second declaration with the same header, and the rule reports
 *   against the copy while the hint locates the original. Both are "the construct
 *   the mutation duplicated", and neither is more correct than the other.
 * - **{@link ANCHOR_NOT_PREDICTABLE_BY_MUTATION} rules compare kind and file
 *   only**, for the reason given on that constant.
 */
function landsInsideMutatedConstruct(
  spans: DeclarationSpan[],
  rule: string,
  hintLine: number | null,
  observedLine: number,
): boolean {
  const containing = (line: number) => spans.find((span) => line >= span.start && line <= span.end);
  const observedSpan = containing(observedLine);
  if (observedSpan === undefined) return false;
  // A null hint means the mutator could not locate its own construct, which is a
  // degraded failure message rather than a wrong assertion. The observation still
  // has to sit inside *some* declaration.
  if (hintLine === null) return true;
  const hintSpan = containing(hintLine);
  if (hintSpan === undefined) return true;
  if (ANCHOR_NOT_PREDICTABLE_BY_MUTATION.has(rule)) return observedSpan.kind === hintSpan.kind;
  return observedSpan.start === hintSpan.start || observedSpan.header === hintSpan.header;
}

// ── Driving one mutation ───────────────────────────────────────────────────

/** A mutated workspace loaded beside its clean original, with both dispositions. */
interface MutationRun {
  /** Diagnostics the *unmutated* workspace produced — the asserted-clean baseline. */
  baseline: LintDiagnostic[];
  /** Diagnostics the mutated workspace produced, which the prediction must match. */
  observed: LintDiagnostic[];
  /** The mutated workspace, loaded — for declaration spans and failure messages. */
  loaded: LoadedGeneratedWorkspace;
}

/**
 * Load a workspace and its mutation, read both surfaces' diagnostics, and hand
 * back everything a property asserts over. The caller disposes via
 * {@link MutationRun.loaded}; the baseline's own temporary directory is removed
 * here, since nothing downstream reads it.
 */
async function runMutation(
  original: ScenarioWorkspace,
  mutated: ScenarioWorkspace,
  surface: DiagnosticSurface,
): Promise<MutationRun> {
  const base = await loadGeneratedWorkspace(original);
  const baseline = observedDiagnostics(base, surface);
  disposeGeneratedWorkspace(base);

  const loaded = await loadGeneratedWorkspace(mutated);
  return { baseline, observed: observedDiagnostics(loaded, surface), loaded };
}

/**
 * Is this workspace a fair baseline for this surface?
 *
 * The mutator contract is stated as *what the mutation adds to a clean baseline*,
 * so a domain that is already dirty would have its pre-existing findings read as
 * the mutation's. Only `cyclicWorkspaceArbitrary` is dirty, and only under lint.
 */
function hasCleanBaseline(workspace: ScenarioWorkspace, surface: DiagnosticSurface): boolean {
  return surface === VALIDATE || !workspaceHasSchemaCycle(workspace);
}

/** Every surface a mutator predicts for, so a property runs once per surface. */
const SURFACES: DiagnosticSurface[] = [VALIDATE, LINT];

// ── Property 1: the diagnostic set a defect predicts, in both directions ───

describe("a mutated workspace produces exactly the diagnostics its defect predicts", () => {
  for (const { kind, mutate } of DEFECT_MUTATORS) {
    for (const surface of SURFACES) {
      // Why this case exists: the defect's whole consequence set is what the
      // toolchain must report — no fewer, or a real break reaches a user
      // unreported; no more, or the surface invents a finding on input that only
      // has the one defect. Looping the registry rather than naming mutators one
      // by one means a new mutator extends this property without editing it.
      it(`${surface} reports every ${kind} consequence and invents none`, async () => {
        await fc.assert(
          fc.asyncProperty(workspaceScenarioArbitrary, async (workspace: ScenarioWorkspace) => {
            if (!hasCleanBaseline(workspace, surface)) return true;
            const defect = mutate(workspace);
            if (!isWorkspaceDefect(defect)) return true; // Precondition unmet: skip, do not pass.

            const run = await runMutation(workspace, defect.workspace, surface);
            try {
              assert.deepEqual(
                run.baseline,
                [],
                `the unmutated workspace is not clean under ${surface}, so the ` +
                  `mutation's prediction cannot be separated from what was already ` +
                  `there:\n${describeDiagnostics(run.baseline)}`,
              );

              const predictions = expectedForSurface(defect, surface);
              const { missed, spurious } = maximumMatching(
                predictions.length,
                run.observed.length,
                (p, o) => satisfiesPrediction(predictions[p], run.observed[o]),
              );

              assert.deepEqual(
                { missed: missed.map((p) => predictions[p]), spurious: spurious.length },
                { missed: [], spurious: 0 },
                `${kind} on ${defect.mutation.target} predicted ` +
                  `${predictions.length} ${surface} diagnostic(s):\n` +
                  predictions
                    .map((p) => `    ${p.rule} in ${p.file} naming ${p.entity}`)
                    .join("\n") +
                  `\n  and ${surface} reported:\n${describeDiagnostics(run.observed)}` +
                  `\n  missed: ${missed.map((p) => `${predictions[p].rule}/${predictions[p].entity}`).join(", ") || "none"}` +
                  `\n  spurious: ${spurious.map((o) => run.observed[o].rule).join(", ") || "none"}` +
                  `\n  source:\n${run.loaded.sources}`,
              );
            } finally {
              disposeGeneratedWorkspace(run.loaded);
            }
            return true;
          }),
          GENERATED_PROPERTY_PARAMETERS,
        );
      });
    }
  }
});

// ── Property 2: where those diagnostics are reported ───────────────────────

describe("a diagnostic is reported inside the construct the mutation broke", () => {
  for (const { kind, mutate } of DEFECT_MUTATORS) {
    for (const surface of SURFACES) {
      // Why this case exists: a diagnostic with the right rule and the wrong
      // position sends a reader to a construct that is not broken, and every
      // editor surface — the LSP's squiggle, `--json` consumers, the problem
      // panel — inherits that position verbatim. Property 1 would pass on it.
      it(`${surface} reports ${kind} inside the mutated declaration`, async () => {
        await fc.assert(
          fc.asyncProperty(workspaceScenarioArbitrary, async (workspace: ScenarioWorkspace) => {
            if (!hasCleanBaseline(workspace, surface)) return true;
            const defect = mutate(workspace);
            if (!isWorkspaceDefect(defect)) return true;

            const run = await runMutation(workspace, defect.workspace, surface);
            try {
              const predictions = expectedForSurface(defect, surface);
              const spansByFile = new Map<string, DeclarationSpan[]>();
              const spansFor = (file: string) => {
                if (!spansByFile.has(file))
                  spansByFile.set(file, declarationSpans(run.loaded, file));
                return spansByFile.get(file) as DeclarationSpan[];
              };

              // Position is folded into the pairing rather than checked pair by
              // pair: two predictions of the same rule and entity in different
              // mappings are interchangeable under `satisfiesPrediction`, so the
              // wrong pairing would report a position failure where a correct
              // pairing exists.
              const { missed } = maximumMatching(
                predictions.length,
                run.observed.length,
                (p, o) =>
                  satisfiesPrediction(predictions[p], run.observed[o]) &&
                  landsInsideMutatedConstruct(
                    spansFor(run.observed[o].file),
                    predictions[p].rule,
                    predictions[p].line,
                    run.observed[o].line,
                  ),
              );

              assert.deepEqual(
                missed.map((p) => predictions[p]),
                [],
                `${kind} on ${defect.mutation.target}: no ${surface} diagnostic ` +
                  `matching the prediction was reported inside the construct the ` +
                  `mutation broke. Reported:\n${describeDiagnostics(run.observed)}` +
                  `\n  source:\n${run.loaded.sources}`,
              );
            } finally {
              disposeGeneratedWorkspace(run.loaded);
            }
            return true;
          }),
          GENERATED_PROPERTY_PARAMETERS,
        );
      });
    }
  }
});

// ── Property 3: a meaning-preserving change adds nothing ───────────────────

describe("a transformation that preserves meaning produces no diagnostic", () => {
  for (const { kind, mutate } of NULL_MUTATORS) {
    for (const surface of SURFACES) {
      // Why this case exists: this is the direction fixtures under-sample. A rule
      // that keyed a duplicate on a name alone rather than on a declaration would
      // stay quiet on every fixture and fire on a workspace whose author merely
      // reorganised their files — which is what `sl-rw3e` was.
      it(`${surface} stays quiet after ${kind}`, async () => {
        await fc.assert(
          fc.asyncProperty(workspaceScenarioArbitrary, async (workspace: ScenarioWorkspace) => {
            if (!hasCleanBaseline(workspace, surface)) return true;
            const nulled = mutate(workspace);
            if (!isWorkspaceDefect(nulled)) return true;

            const run = await runMutation(workspace, nulled.workspace, surface);
            try {
              assert.deepEqual(run.baseline, [], "the unmutated workspace is not clean");
              assert.deepEqual(
                run.observed.map((d) => `${d.rule} at ${basename(d.file)}:${d.line}`),
                [],
                `${kind} preserves meaning, so ${surface} must report nothing. It ` +
                  `reported:\n${describeDiagnostics(run.observed)}\n  source:\n${run.loaded.sources}`,
              );
            } finally {
              disposeGeneratedWorkspace(run.loaded);
            }
            return true;
          }),
          GENERATED_PROPERTY_PARAMETERS,
        );
      });
    }
  }
});

// ── Property 4: `--select` and `--ignore` partition the findings ───────────

/** The `--json` payload shape `lint` prints, narrowed to what this file reads. */
interface LintJsonPayload {
  findings: Array<{ rule: string; file: string; line: number; message: string }>;
}

/** Run the real `lint` command over a loaded workspace and parse its JSON. */
async function lintFindings(
  loaded: LoadedGeneratedWorkspace,
  flags: string[],
): Promise<LintJsonPayload["findings"]> {
  const result = await runCliCommand(registerLint, [loaded.entryPath, "--json", ...flags]);
  assert.notEqual(
    result.stdout,
    "",
    `lint ${flags.join(" ")} printed nothing on stdout; stderr was:\n${result.stderr}`,
  );
  return (JSON.parse(result.stdout) as LintJsonPayload).findings;
}

/** One finding, as the identity `--select` and `--ignore` must preserve exactly. */
function findingKey(finding: {
  rule: string;
  file: string;
  line: number;
  message: string;
}): string {
  return `${finding.rule}@${basename(finding.file)}:${finding.line} ${finding.message}`;
}

/**
 * How many workspaces {@link LINT_PREDICTING_MUTATORS} tries a mutator against.
 *
 * Only wide enough to separate "predicts lint findings" from "never does": the
 * least applicable mutator in the domain still lands on roughly one workspace in
 * twelve, so forty samples is comfortably above the threshold while costing
 * nothing — no workspace is loaded, only mutated in memory.
 */
const MUTATOR_LINT_PROBE_SAMPLES = 40;

/**
 * The floor of non-vacuous runs the partition property must reach.
 *
 * A quarter of the run budget, measured against roughly half of runs landing a
 * finding. It exists to fail loudly if that rate collapses, not to pin it.
 */
const MINIMUM_PARTITIONED_RUNS = Math.floor(GENERATED_PROPERTY_PARAMETERS.numRuns / 4);

/**
 * The defect mutators that predict at least one *lint* finding.
 *
 * A workspace with no findings has nothing to partition, so drawing uniformly
 * from every mutator would spend most runs skipping — which is a property that
 * looks green while asserting almost nothing. Derived from the predictions rather
 * than listed by hand, so a new mutator joins the domain by predicting a lint
 * rule and not by anyone remembering to add it here.
 */
const LINT_PREDICTING_MUTATORS = DEFECT_MUTATORS.filter(({ mutate }) =>
  fc
    .sample(workspaceScenarioArbitrary, { numRuns: MUTATOR_LINT_PROBE_SAMPLES, seed: 1 })
    .some((workspace: ScenarioWorkspace) => {
      const defect = mutate(workspace);
      return isWorkspaceDefect(defect) && expectedForSurface(defect, LINT).length > 0;
    }),
);

describe("lint --select and --ignore partition the unfiltered findings", () => {
  // Why this case exists: the two flags are separate filters over the same
  // registry, so nothing structural stops one from resolving a rule id the other
  // does not — a rule registered through a constant rather than a literal id
  // (`type-mismatch-direct-arrow`, `lineage-cycle`) is exactly the shape that
  // drifts. Selecting a rule must yield that rule's findings from the unfiltered
  // run, and ignoring it must yield everything else, with no finding invented,
  // dropped or moved by the act of filtering.
  it("selecting a rule yields its findings and ignoring it yields the rest", async () => {
    // A run that found nothing to partition proves nothing, so they are counted
    // and a floor is asserted below. Without it, a change that stopped the
    // mutators from producing lint findings would leave this case green.
    let partitioned = 0;

    await fc.assert(
      fc.asyncProperty(
        workspaceScenarioArbitrary,
        fc.constantFrom(...LINT_PREDICTING_MUTATORS),
        async (workspace: ScenarioWorkspace, mutator: (typeof DEFECT_MUTATORS)[number]) => {
          const defect = mutator.mutate(workspace);
          if (!isWorkspaceDefect(defect)) return true;

          const loaded = await loadGeneratedWorkspace(defect.workspace);
          try {
            const all = await lintFindings(loaded, []);
            if (all.length === 0) return true;
            partitioned += 1;

            for (const rule of RULES.map((registered) => registered.id)) {
              const selected = await lintFindings(loaded, ["--select", rule]);
              const ignored = await lintFindings(loaded, ["--ignore", rule]);

              assert.deepEqual(
                selected.map(findingKey).sort(),
                all
                  .filter((f) => f.rule === rule)
                  .map(findingKey)
                  .sort(),
                `--select ${rule} must yield exactly that rule's share of the ` +
                  `unfiltered run over a ${mutator.kind} workspace`,
              );
              assert.deepEqual(
                ignored.map(findingKey).sort(),
                all
                  .filter((f) => f.rule !== rule)
                  .map(findingKey)
                  .sort(),
                `--ignore ${rule} must yield exactly the complement of ` +
                  `--select ${rule} over a ${mutator.kind} workspace`,
              );
            }
          } finally {
            disposeGeneratedWorkspace(loaded);
          }
          return true;
        },
      ),
      GENERATED_PROPERTY_PARAMETERS,
    );

    assert.ok(
      partitioned >= MINIMUM_PARTITIONED_RUNS,
      `only ${partitioned} of ${GENERATED_PROPERTY_PARAMETERS.numRuns} runs produced a ` +
        `finding to partition, so this case asserts almost nothing. Either the ` +
        `mutators stopped predicting lint findings or ${LINT} stopped reporting them.`,
    );
  });
});
