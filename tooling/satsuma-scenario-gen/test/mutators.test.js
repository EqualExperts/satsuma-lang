/**
 * mutators.test.js — the defect mutators' own tests.
 *
 * A mutator is half of an oracle: a consuming property asserts that the toolchain
 * reports exactly `expected`, so a mutator that quietly under-predicts does not
 * fail — it *weakens*, and the property built on it keeps passing while defending
 * less than it claims to. The two ways that happens are a mutation that broke
 * nothing (so the property proves the toolchain stays silent about nothing) and a
 * prediction that names one consequence of a defect that has three.
 *
 * These are deliberately not property tests, for the same reason `ground-truth.js`
 * gets hand-written cases: a property over a mutator could only compare it against
 * another traversal of the same scenario data, which is the circularity the
 * mutators exist to avoid. What they cannot check here is whether the *toolchain*
 * agrees — that is R2 (`gpt-vq0r`), which drives `validate` and `lint`. So these
 * cases check the contract: the mutation landed, the prediction is shaped as
 * documented, and a mutator that cannot break a workspace says so.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import { listRecordField, scalarField } from "../src/model.js";
import { workspaceScenarioArbitrary } from "../src/workspace-arbitraries.js";
import {
  eachBlock,
  endpoint,
  mapArrow,
  mappingDecl,
  nlTransform,
  scenarioFile,
  scenarioWorkspace,
  schemaDecl,
} from "../src/workspace-model.js";
import { renderWorkspace } from "../src/workspace-render.js";
import {
  scenarioDeclaredFieldPaths,
  scenarioFieldEdges,
  scenarioSchemaEdges,
} from "../src/ground-truth.js";
import {
  DEFECT_MUTATORS,
  DIAGNOSTIC_RULES,
  NULL_MUTATORS,
  breakNlRefTarget,
  closeLineageCycle,
  deleteMappedField,
  duplicateEntityWithinFile,
  expectedForSurface,
  isWorkspaceDefect,
  pointNlRefOutsideSourceList,
  referenceUndefinedEntity,
  reverseDeclarationOrder,
  workspaceHasSchemaCycle,
} from "../src/mutators.js";

// ── Bases ──────────────────────────────────────────────────────────────────

/**
 * One workspace that satisfies every mutator's precondition at once.
 *
 * Each construct is here because a mutator needs it, and a base missing any one of
 * them would make the coverage case below pass while silently skipping a rule:
 *
 * | Construct | The mutation that needs it |
 * |---|---|
 * | two mapped scalar fields | delete a field; retype one for a bare arrow |
 * | a `record` field in a spread-free target | an arrow onto an unenumerated record |
 * | an NL `@ref` | break the ref; point it outside the source list |
 * | `s2`, outside `m0`'s lists | the ref target that resolves but is hidden |
 * | a namespace on both a schema and a mapping | conflicting namespace metadata |
 * | two mappings in series | a lineage cycle; two files' worth of schemas |
 */
function mutationBase() {
  const listedFields = (name) => [
    scalarField("field_0"),
    scalarField("field_1"),
    listRecordField(name, [scalarField("field_0")]),
  ];

  return scenarioWorkspace([
    scenarioFile({
      path: "entry.stm",
      schemas: [
        schemaDecl({ name: "s0", fields: listedFields("lines") }),
        schemaDecl({ name: "s1", namespace: "ns", fields: listedFields("lines") }),
        schemaDecl({ name: "s2", fields: [scalarField("field_0")] }),
      ],
      mappings: [
        mappingDecl({
          name: "m0",
          namespace: "ns",
          sources: ["s0"],
          targets: ["ns::s1"],
          arrows: [
            mapArrow(
              [endpoint("s0", "field_0")],
              endpoint("ns::s1", "field_0"),
              nlTransform("Normalise the value.", [endpoint("s0", "field_1")]),
            ),
            mapArrow([endpoint("s0", "field_1")], endpoint("ns::s1", "field_1")),
            eachBlock(endpoint("s0", "lines"), endpoint("ns::s1", "lines"), [
              mapArrow([endpoint("s0", "lines.field_0")], endpoint("ns::s1", "lines.field_0")),
            ]),
          ],
        }),
        mappingDecl({
          name: "m1",
          sources: ["ns::s1"],
          targets: ["s2"],
          arrows: [mapArrow([endpoint("ns::s1", "field_0")], endpoint("s2", "field_0"))],
        }),
      ],
    }),
  ]);
}

/**
 * A two-hop chain that declares its **middle** schema first.
 *
 * Declaration order is load-bearing here and nowhere else: a mutator picks the
 * first target its traversal reaches, so declaring the mid-chain schema first is
 * what makes the deletion land on a field that is a target *and* a source — the
 * cascade the predicted-set-is-complete rule exists for.
 */
function midChainFirstBase() {
  const fields = () => [scalarField("field_0"), scalarField("field_1")];
  return scenarioWorkspace([
    scenarioFile({
      path: "entry.stm",
      schemas: ["middle", "head", "tail"].map((name) => schemaDecl({ name, fields: fields() })),
      mappings: [
        mappingDecl({
          name: "fill_middle",
          sources: ["head"],
          targets: ["middle"],
          arrows: [mapArrow([endpoint("head", "field_0")], endpoint("middle", "field_0"))],
        }),
        mappingDecl({
          name: "drain_middle",
          sources: ["middle"],
          targets: ["tail"],
          arrows: [mapArrow([endpoint("middle", "field_0")], endpoint("tail", "field_0"))],
        }),
      ],
    }),
  ]);
}

/** A workspace with a schema and nothing else — no mapping, no arrow, no `@ref`. */
function barrenBase() {
  return scenarioWorkspace([
    scenarioFile({
      path: "entry.stm",
      schemas: [schemaDecl({ name: "lonely", fields: [scalarField("field_0")] })],
    }),
  ]);
}

/** Two mappings that already close a loop: `a → b → a`. */
function cyclicBase() {
  const hop = (name, from, to) =>
    mappingDecl({
      name,
      sources: [from],
      targets: [to],
      arrows: [mapArrow([endpoint(from, "field_0")], endpoint(to, "field_0"))],
    });
  return scenarioWorkspace([
    scenarioFile({
      path: "entry.stm",
      schemas: ["a", "b"].map((name) => schemaDecl({ name, fields: [scalarField("field_0")] })),
      mappings: [hop("there", "a", "b"), hop("back", "b", "a")],
    }),
  ]);
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** The whole workspace as one string, so "did the source change" is one comparison. */
function rendered(workspace) {
  return renderWorkspace(workspace)
    .map((file) => `── ${file.path}\n${file.source}`)
    .join("\n");
}

/** Sorted `from -> to (classification)` keys — the declared field edge set. */
function fieldEdgeKeys(workspace) {
  return scenarioFieldEdges(workspace)
    .map((edge) => `${edge.from} -> ${edge.to} (${edge.classification})`)
    .sort();
}

/** Sorted `from -> to [role]` keys — the declared schema edge set. */
function schemaEdgeKeys(workspace) {
  return scenarioSchemaEdges(workspace)
    .map((edge) => `${edge.from} -> ${edge.to} [${edge.role}]`)
    .sort();
}

/**
 * Every rule id the three production registries declare, **transcribed as literal
 * strings from those registries** rather than read back from `DIAGNOSTIC_RULES`.
 *
 * The independence is the whole point. `DIAGNOSTIC_RULES` is itself a hand-copy of
 * three registries this package may not import (it must never depend on
 * `@satsuma/core` — that edge would be a build cycle), so a coverage case that
 * compared the mutators' predictions against those same constants would compare a
 * value with itself: mistype one id in `mutators.js` and every prediction, and the
 * set they are checked against, moves together and the case still passes. Spelling
 * the ids out again here is the only check in this package that a wrong id fails.
 * Pinning the CLI's registry against its documented rule list is `gpt-o0fk`.
 */
const REGISTERED_RULES = Object.freeze({
  /** `satsuma-core/src/validate.ts`, one literal per check section. */
  validate: [
    "duplicate-definition",
    "undefined-ref",
    "field-not-in-schema",
    "unresolved-nl-ref",
    "nl-ref-not-in-source",
    "constraint-in-type-args",
    "namespace-metadata-conflict",
  ],
  /**
   * `satsuma-core/src/import-reachability.ts`, reported by `validate.ts` under the
   * caller's policy id — which the CLI leaves at this default.
   */
  importScope: ["import-scope"],
  /**
   * `satsuma-cli/src/lint-engine.ts` `RULES`. The last two are registered through
   * core's `TYPE_MISMATCH_RULE_ID` and `LINEAGE_CYCLE_RULE_ID` constants rather
   * than as literal strings, which is why an audit of that registry by eye misses
   * them (Feature 46 PRD, decision 3).
   */
  lint: [
    "hidden-source-in-nl",
    "unresolved-nl-ref",
    "duplicate-definition",
    "unenumerated-record-target",
    "type-mismatch-direct-arrow",
    "lineage-cycle",
  ],
});

// ── Defect mutators ────────────────────────────────────────────────────────

describe("defect mutators", () => {
  it("changes the rendered source and predicts at least one diagnostic", () => {
    // The vacuity guard, for every mutator at once. A mutation that left the
    // source alone would make a consuming property assert that the toolchain
    // reports diagnostics for a workspace that is still valid — which it would
    // then report as a *missed* diagnostic, blaming the toolchain for the
    // generator's mistake.
    const base = mutationBase();
    for (const { kind, mutate } of DEFECT_MUTATORS) {
      const result = mutate(base);
      assert.equal(result.applicable, true, `${kind} declined a workspace built to satisfy it`);
      assert.notEqual(
        rendered(result.workspace),
        rendered(base),
        `${kind} left the rendered source unchanged`,
      );
      assert.ok(result.expected.length > 0, `${kind} predicted no diagnostic`);
      assert.equal(result.mutation.kind, kind);
      assert.equal(typeof result.mutation.target, "string");
    }
  });

  it("predicts diagnostics naming a real rule, a file in the workspace, and an entity", () => {
    // The shape a consumer indexes on. `file` must be a *workspace-relative* path
    // (a consumer compares basenames against a loaded diagnostic's absolute path),
    // and `entity` must be non-empty because it is the only handle on "which
    // construct" — diagnostics carry no entity field, only a message.
    const base = mutationBase();
    const ruleIds = new Set(Object.values(DIAGNOSTIC_RULES));
    for (const { kind, mutate } of DEFECT_MUTATORS) {
      const result = mutate(base);
      const paths = result.workspace.files.map((file) => file.path);
      for (const diagnostic of result.expected) {
        assert.ok(
          ruleIds.has(diagnostic.rule),
          `${kind} predicted unknown rule ${diagnostic.rule}`,
        );
        assert.ok(paths.includes(diagnostic.file), `${kind} named a file outside the workspace`);
        assert.ok(diagnostic.entity.length > 0, `${kind} predicted an empty entity`);
        assert.ok(
          diagnostic.surfaces.length > 0 &&
            diagnostic.surfaces.every((surface) => ["validate", "lint"].includes(surface)),
          `${kind} predicted a surface no command answers to`,
        );
        assert.ok(
          diagnostic.line === null || Number.isInteger(diagnostic.line),
          `${kind} predicted a line that is neither a hint nor absent`,
        );
      }
    }
  });

  it("predicts one diagnostic per arrow naming a deleted field, not just the first", () => {
    // The completeness rule, on the shape that makes it matter: a mid-chain field
    // is one mapping's target and the next mapping's source, so deleting it breaks
    // two arrows. A mutator predicting one would let a consumer's set comparison
    // pass while the toolchain missed the other.
    const defect = deleteMappedField(midChainFirstBase());
    assert.equal(defect.mutation.target, "middle.field_0");
    assert.deepEqual(
      defect.expected.map((diagnostic) => `${diagnostic.rule} ${diagnostic.entity}`),
      [
        `${DIAGNOSTIC_RULES.fieldNotInSchema} field_0`,
        `${DIAGNOSTIC_RULES.fieldNotInSchema} field_0`,
      ],
    );
    assert.deepEqual(
      defect.expected.map((diagnostic) => diagnostic.line),
      // Two different arrows, so two different mappings and two different hints.
      [...new Set(defect.expected.map((diagnostic) => diagnostic.line))],
    );
  });

  it("predicts both rule ids when the two registries name one break differently", () => {
    // `validate` calls an NL ref to a schema outside the mapping's lists
    // `nl-ref-not-in-source`; the lint registry calls the same break
    // `hidden-source-in-nl`. A prediction naming one of them would look like a
    // spurious diagnostic to whichever command reports the other.
    const defect = pointNlRefOutsideSourceList(mutationBase());
    assert.deepEqual(
      defect.expected.map((diagnostic) => [diagnostic.rule, diagnostic.surfaces]),
      [
        [DIAGNOSTIC_RULES.nlRefNotInSource, ["validate"]],
        [DIAGNOSTIC_RULES.hiddenSourceInNl, ["lint"]],
      ],
    );
    // The ref must still resolve, or the break would be `unresolved-nl-ref`.
    assert.equal(defect.mutation.target, "s2.field_0");
  });

  it("attributes a rule both registries declare to both commands", () => {
    // `duplicate-definition` is in `validate.ts` and in the lint registry, so a
    // property driving one command must see it and a property driving the other
    // must see it too — which is what `expectedForSurface` partitions.
    const defect = duplicateEntityWithinFile(mutationBase());
    assert.deepEqual(defect.expected[0].surfaces, ["validate", "lint"]);
    assert.equal(expectedForSurface(defect, "validate").length, 1);
    assert.equal(expectedForSurface(defect, "lint").length, 1);
  });

  it("declines, with a reason, rather than returning a workspace it did not break", () => {
    // The precondition rule. A mutator with nothing to break must say so: a
    // vacuous defect would be indistinguishable from a missed diagnostic, which
    // is the specific failure this contract is designed against.
    for (const mutate of [deleteMappedField, breakNlRefTarget, referenceUndefinedEntity]) {
      const result = mutate(barrenBase());
      assert.equal(result.applicable, false);
      assert.equal(result.mutation.target, null);
      assert.ok(result.reason.length > 0, "a declined mutation must explain itself");
      assert.ok(!("workspace" in result), "a declined mutation must not offer a workspace");
    }
  });

  it("declines to add a lineage cycle to a workspace that already declares one", () => {
    // `cyclicWorkspaceArbitrary` produces valid workspaces that already carry a
    // `lineage-cycle` finding. Mutating one would predict a finding that existed
    // before the mutation, so the consumer would be comparing against a baseline
    // that was never clean.
    const result = closeLineageCycle(cyclicBase());
    assert.equal(result.applicable, false);
    assert.match(result.reason, /already declares a lineage cycle/);
  });

  it("leaves the caller's workspace untouched", () => {
    // Every mutator deep-copies before editing. A property applies several
    // mutators to one generated workspace, and an in-place edit would make the
    // second mutation land on the first one's damage — two defects, one
    // prediction.
    const base = mutationBase();
    const before = structuredClone(base);
    for (const { mutate } of DEFECT_MUTATORS) mutate(base);
    assert.deepEqual(base, before);
  });
});

// ── Null mutators ──────────────────────────────────────────────────────────

describe("null mutators", () => {
  it("changes the rendered source but not the declared edge or entity sets", () => {
    // The whole claim of a null mutator: the text moved, the meaning did not. Both
    // halves are asserted, because a transformation that changed nothing would
    // satisfy the second half for free — and a property that passes for free
    // defends nothing. The rename is compared *modulo the rename*, which is the
    // same invariant R4's rename round-trip is built on.
    const base = mutationBase();
    for (const { kind, mutate } of NULL_MUTATORS) {
      const result = mutate(base);
      assert.equal(result.applicable, true, `${kind} declined a workspace it should transform`);
      assert.deepEqual(result.expected, [], `${kind} predicted a diagnostic; it must predict none`);
      assert.notEqual(
        rendered(result.workspace),
        rendered(base),
        `${kind} left the rendered source unchanged`,
      );

      const substitute = (keys) =>
        kind === "rename-entity-consistently" ? keys.map(renameS0).sort() : keys;
      assert.deepEqual(
        fieldEdgeKeys(result.workspace),
        substitute(fieldEdgeKeys(base)),
        `${kind} changed the declared field edge set`,
      );
      assert.deepEqual(
        schemaEdgeKeys(result.workspace),
        substitute(schemaEdgeKeys(base)),
        `${kind} changed the declared schema edge set`,
      );
      assert.deepEqual(
        scenarioDeclaredFieldPaths(result.workspace),
        substitute(scenarioDeclaredFieldPaths(base)),
        `${kind} changed the declared field paths`,
      );
    }
  });

  it("declines a reordering the renderer cannot express as a change", () => {
    // Reversing declaration order is invisible when each file holds one schema and
    // one mapping — the renderer groups by namespace, so there is nothing to
    // reorder. Reporting that is the point: a null mutation over identical source
    // would prove the diagnostics are stable across doing nothing.
    const result = reverseDeclarationOrder(barrenBase());
    assert.equal(result.applicable, false);
    assert.match(result.reason, /rendered source identical/);
  });
});

/** `::s0…` → `::s0_renamed…`, the substitution `renameEntityConsistently` makes. */
function renameS0(key) {
  return key.replaceAll("::s0.", "::s0_renamed.").replaceAll("::s0 ", "::s0_renamed ");
}

// ── Reach across the three registries ──────────────────────────────────────

describe("rule coverage", () => {
  it("predicts every rule the three production registries declare", () => {
    // The acceptance criterion for this ticket, as an assertion rather than a
    // claim in a report: if a rule is registered and no mutation reaches it, the
    // negative surface still has a hole. Equality in both directions, so a
    // prediction naming a rule no registry declares fails too.
    const reached = new Set(
      [...DEFECT_MUTATORS]
        .map(({ mutate }) => mutate(mutationBase()))
        .filter((result) => result.applicable)
        .flatMap((result) => result.expected.map((diagnostic) => diagnostic.rule)),
    );
    const registered = new Set([
      ...REGISTERED_RULES.validate,
      ...REGISTERED_RULES.importScope,
      ...REGISTERED_RULES.lint,
    ]);
    assert.deepEqual([...reached].sort(), [...registered].sort());
  });

  it("attributes each rule to the command whose registry declares it", () => {
    // A mis-attributed surface is invisible in the coverage case above and fatal
    // in a consuming property: predicting a lint-only rule for a `validate` run
    // reads as a missed diagnostic, and the reverse reads as a spurious one.
    const predictions = DEFECT_MUTATORS.map(({ mutate }) => mutate(mutationBase()))
      .filter((result) => result.applicable)
      .flatMap((result) => result.expected);
    for (const diagnostic of predictions) {
      const inValidate =
        REGISTERED_RULES.validate.includes(diagnostic.rule) ||
        REGISTERED_RULES.importScope.includes(diagnostic.rule);
      assert.equal(
        diagnostic.surfaces.includes("validate"),
        inValidate,
        `${diagnostic.rule} is mis-attributed to validate`,
      );
      assert.equal(
        diagnostic.surfaces.includes("lint"),
        REGISTERED_RULES.lint.includes(diagnostic.rule),
        `${diagnostic.rule} is mis-attributed to lint`,
      );
    }
  });
});

// ── Reach over the domain a consumer actually generates ────────────────────

/**
 * Samples drawn for the reach case below. Large enough that the rarest shape any
 * mutator needs — a mapping with a spread-free record target, roughly one sample in
 * thirteen — is drawn many times over, so the case fails on a mutator going dead
 * rather than on sampling luck.
 */
const REACH_SAMPLE_COUNT = 200;

/** Fixed so this case is deterministic: a flaky reach check would just get muted. */
const REACH_SEED = 42;

describe("reach over the generated domain", () => {
  it("applies every mutator to at least one workspace the shared domain produces", () => {
    // The cases above all run against `mutationBase()`, a workspace written here to
    // satisfy every precondition at once — so they prove the mutators work on input
    // this file constructs, and say nothing about the input a consumer has. R2 and
    // R5 draw from `workspaceScenarioArbitrary` and must skip a mutator whose
    // precondition fails, so a mutator that is *never* applicable over that domain
    // costs the consuming property a whole rule without failing anything: the skip
    // looks like the precondition rule working as designed. This case is the guard.
    // It is not about the rates — only that no mutator is dead on arrival.
    const samples = fc.sample(workspaceScenarioArbitrary, {
      numRuns: REACH_SAMPLE_COUNT,
      seed: REACH_SEED,
    });

    for (const { kind, mutate } of [...DEFECT_MUTATORS, ...NULL_MUTATORS]) {
      const results = samples.map((workspace) => mutate(workspace));
      const reasons = new Set(results.filter((r) => !r.applicable).map((r) => r.reason));
      assert.ok(
        results.some(isWorkspaceDefect),
        `${kind} is applicable to no generated workspace, so every consuming property ` +
          `skips it silently. Declined ${results.length}/${results.length} because: ` +
          `${[...reasons].join(" | ")}`,
      );
    }
  });
});

// ── The cycle predicate consumers filter with ──────────────────────────────

describe("workspaceHasSchemaCycle", () => {
  it("separates a closed loop from a chain", () => {
    // Exported for consumers, not just for the cycle mutator: a property that
    // compares a mutated workspace's lint findings against a clean baseline has to
    // exclude the one generated domain whose baseline is not clean.
    assert.equal(workspaceHasSchemaCycle(cyclicBase()), true);
    assert.equal(workspaceHasSchemaCycle(midChainFirstBase()), false);
  });
});
