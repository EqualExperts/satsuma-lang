/**
 * generated-diff-algebra.test.ts — `diff` as an algebra over generated workspaces.
 *
 * `diff` had no generated coverage, and its two failure modes are exactly the
 * ones a property catches cheaply and a reader never catches at all:
 *
 * - **reporting a change where none exists**, which happens the moment any
 *   comparison becomes textual rather than structural — reordering declarations,
 *   moving them between files, or running the formatter must all diff clean; and
 * - **missing one that does**, or reporting it against the wrong entity.
 *
 * The second is the sharper half. A reader looking at a delta has no way to tell
 * that an entity is missing from it, and no way to tell that a mentioned entity
 * did not really change. Every property below therefore asserts *both*
 * directions against ground truth the scenario states —
 * `scenarioChangedDeclarations` — never against `diff`'s own output.
 *
 * ## Two corrections to this ticket's own design, both measured
 *
 * **1. `diff` must NOT be empty across every R1 null mutation.** The PRD says it
 * should be, and for two of the three it is. But `rename-entity-consistently`
 * renames a schema throughout, and a rename *is* a structural change: `diff`
 * reports the old name removed, the new one added, and every mapping and metric
 * that referenced it changed — 50 of 50 samples, and correctly so. The null
 * mutators preserve **meaning for the diagnostic surface** (R2's subject), not
 * entity identity. So the emptiness property names the two identity-preserving
 * mutators, and rename is asserted through containment instead, where it belongs.
 *
 * **2. The reformat step is property-local, not a `NULL_MUTATORS` entry.** R1
 * ships no reformat mutator and cannot: reformatting transforms *source text*,
 * not a scenario, and `scenario-gen` may not depend on `@satsuma/core` to reach
 * a formatter. So this file renders the workspace, formats each file through the
 * CLI's own `format`, and treats that as the reformat null mutation. It is not
 * vacuous — the formatter changes 50 of 54 generated files, aligning field types
 * into columns.
 *
 * ## What the extracted index does and does not carry
 *
 * `diffIndex` compares two `ExtractedWorkspace` values, and an extracted index
 * carries almost no layout: field order, names and types, but no whitespace and
 * no raw source. The one exception is `TransformRecord.body`, the raw pipe-chain
 * text — which is exactly why `diff` compares `canonicalBody` beside it
 * (`sl-dxjh`). That is the only place a textual comparison can hide, and it is
 * where this file's mutation check aims.
 *
 * No generated workspace declares a `transform` block, so the reformat property
 * takes a literal fixture for that shape alongside the generated domain. The
 * domain gap is real and filed as `gpt-l0nz` rather than left unsaid.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import {
  DEFECT_MUTATORS,
  GENERATED_PROPERTY_PARAMETERS,
  isWorkspaceDefect,
  renameEntityConsistently,
  renderWorkspace,
  reverseDeclarationOrder,
  splitAcrossFiles,
  workspaceScenarioArbitrary,
  scenarioChangedDeclarations,
} from "@satsuma/scenario-gen";
import type { ScenarioWorkspace } from "@satsuma/scenario-gen";
import { diffIndex } from "#src/diff-engine.js";
import { format } from "#src/format.js";
import { parseSource } from "#src/parser.js";
import type { Delta } from "#src/types.js";
import { disposeGeneratedWorkspace, loadRenderedFiles } from "./support/generated-workspace.js";
import type { LoadedGeneratedWorkspace } from "./support/generated-workspace.js";

// The WASM parser is initialised by `test/setup.ts`, which the test script
// preloads with `--import`.

// ── Reading a delta ────────────────────────────────────────────────────────

/**
 * Every entity name a delta mentions, in any block type and any direction.
 *
 * The unit a containment property reasons in: `diff` reports per entity, so
 * "which entities does this delta claim changed" is the question with an answer
 * the scenario already knows.
 */
function namesInDelta(delta: Delta): string[] {
  const blocks = [delta.schemas, delta.mappings, delta.metrics, delta.fragments, delta.transforms];
  const names = blocks.flatMap((block) => [
    ...block.added,
    ...block.removed,
    ...block.changed.map((entry) => entry.name),
  ]);
  return [...new Set(names)].sort();
}

/**
 * Is this delta empty?
 *
 * Standalone note blocks are counted separately from the block types, because
 * `NoteDelta` carries note *texts* rather than entity names and so contributes
 * nothing to {@link namesInDelta}. A delta that only moved a note is still a
 * reported change.
 */
function isEmptyDelta(delta: Delta): boolean {
  return (
    namesInDelta(delta).length === 0 &&
    delta.notes.added.length === 0 &&
    delta.notes.removed.length === 0
  );
}

/** A delta rendered for an assertion message — the whole thing, since it is small. */
function describeDelta(delta: Delta): string {
  return JSON.stringify(delta, null, 2);
}

// ── Loading a pair ─────────────────────────────────────────────────────────

/**
 * Load two workspaces, diff them both ways, and dispose of both.
 *
 * Both directions every time because antisymmetry is asserted alongside every
 * other property rather than in a pass of its own: the pair is already loaded,
 * and a `diff` that reported different *entities* depending on argument order
 * would be wrong in a way no single-direction property can see.
 */
async function diffBothWays(
  before: Array<{ path: string; source: string }>,
  after: Array<{ path: string; source: string }>,
): Promise<{ forward: Delta; backward: Delta; sources: string }> {
  let left: LoadedGeneratedWorkspace | null = null;
  let right: LoadedGeneratedWorkspace | null = null;
  try {
    left = await loadRenderedFiles(before);
    right = await loadRenderedFiles(after);
    return {
      forward: diffIndex(left.index, right.index),
      backward: diffIndex(right.index, left.index),
      sources: `── before\n${left.sources}\n── after\n${right.sources}`,
    };
  } finally {
    if (left) disposeGeneratedWorkspace(left);
    if (right) disposeGeneratedWorkspace(right);
  }
}

/**
 * Assert the two directions agree about *which* entities changed.
 *
 * They are not required to be identical — `added` and `removed` swap, and a
 * change's `from`/`to` swap with them. What must not differ is the entity set,
 * because that is the part a reader acts on.
 */
function assertAntisymmetric(forward: Delta, backward: Delta, context: string): void {
  assert.deepEqual(
    namesInDelta(forward),
    namesInDelta(backward),
    `${context}: diff names different entities depending on which side is 'before'.\n` +
      `forward:\n${describeDelta(forward)}\nbackward:\n${describeDelta(backward)}`,
  );
  assert.equal(
    isEmptyDelta(forward),
    isEmptyDelta(backward),
    `${context}: diff is empty in one direction only`,
  );
}

// ── Property 1: a workspace does not differ from itself ────────────────────

describe("diff of a workspace against itself", () => {
  // Why this case exists: reflexivity is the cheapest statement of "structural,
  // not textual", and the one that fails first if any comparison starts keying on
  // a path, a row or a raw slice of source. Two loads of the same rendered files
  // land in *different* temporary directories, so every absolute path differs —
  // which is the point, and is what `sl-ndtz` was about.
  it("is empty even though the two copies sit at different paths", async () => {
    await fc.assert(
      fc.asyncProperty(workspaceScenarioArbitrary, async (workspace: ScenarioWorkspace) => {
        const rendered = renderWorkspace(workspace);
        const { forward, backward, sources } = await diffBothWays(rendered, rendered);

        assert.ok(
          isEmptyDelta(forward),
          `a workspace differs from an identical copy of itself:\n` +
            `${describeDelta(forward)}\n${sources}`,
        );
        assertAntisymmetric(forward, backward, "identical copies");
        return true;
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });
});

// ── Property 2: reformatting is not a change ───────────────────────────────

/** Run every file of a rendered workspace through the CLI's own formatter. */
function reformat(
  files: Array<{ path: string; source: string }>,
): Array<{ path: string; source: string }> {
  return files.map((file) => ({
    path: file.path,
    source: format(parseSource(file.source).tree, file.source),
  }));
}

describe("reformatting a workspace is not a change", () => {
  // Why this case exists: the formatter rewrites layout and nothing else — R7
  // (`gpt-h0dc`) proved it preserves the extracted semantic index — so a `diff`
  // that reported a reformat would be reporting its own textuality. This is the
  // reformat null mutation the PRD asks for, built here rather than in
  // `scenario-gen`, which may not depend on core and so cannot reach a formatter.
  it("reports nothing after every file is formatted", async () => {
    let reformatted = 0;

    await fc.assert(
      fc.asyncProperty(workspaceScenarioArbitrary, async (workspace: ScenarioWorkspace) => {
        const rendered = renderWorkspace(workspace);
        const formatted = reformat(rendered);
        if (formatted.some((file, index) => file.source !== rendered[index].source)) {
          reformatted += 1;
        }

        const { forward, backward, sources } = await diffBothWays(rendered, formatted);
        assert.ok(
          isEmptyDelta(forward),
          `formatting changed what diff reports:\n${describeDelta(forward)}\n${sources}`,
        );
        assertAntisymmetric(forward, backward, "a reformatted workspace");
        return true;
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );

    // Without this the property would pass on a domain the formatter left alone,
    // which is a green case asserting nothing. Measured: the formatter changes
    // 50 of 54 generated files, aligning field types into columns.
    assert.ok(
      reformatted > 0,
      "the formatter changed no generated file, so this case compared a workspace with itself",
    );
  });

  // Why this case exists: `TransformRecord.body` is the only layout-bearing
  // string in an extracted index, so a `transform` block with a multi-line pipe
  // chain is the only input that can tell a structural comparison from a textual
  // one. No generated workspace declares one — `scenario-gen` has no transform
  // block in its model at all (`gpt-l0nz`) — so this is a literal fixture, and
  // `loadRenderedFiles` exists for exactly this case. It is also what the
  // mutation check for this ticket fires on.
  it("reports nothing when a multi-line pipe chain is collapsed onto one line", async () => {
    const sprawling = `transform clean_string {
  trim
     | uppercase
       | md5
}

schema s0 {
  field_0 STRING
}
`;
    const formatted = reformat([{ path: "entry.stm", source: sprawling }]);
    assert.notEqual(
      formatted[0].source,
      sprawling,
      "the fixture is already canonical, so this case compares a file with itself",
    );

    const { forward, backward, sources } = await diffBothWays(
      [{ path: "entry.stm", source: sprawling }],
      formatted,
    );
    assert.ok(
      isEmptyDelta(forward),
      `diff reported a pipe chain's layout as a change (sl-dxjh):\n` +
        `${describeDelta(forward)}\n${sources}`,
    );
    assertAntisymmetric(forward, backward, "a reformatted pipe chain");
  });
});

// ── Property 3: reorganising declarations is not a change ──────────────────

/**
 * The null mutations that preserve entity *identity*, and so must diff clean.
 *
 * `renameEntityConsistently` is deliberately absent: see this file's header. It
 * preserves meaning for the diagnostic surface, which is R2's subject, and
 * changes structure, which is this one's — so it is asserted under containment
 * below rather than here.
 */
const IDENTITY_PRESERVING_MUTATORS = [
  { kind: "reverse-declaration-order", mutate: reverseDeclarationOrder },
  { kind: "split-across-files", mutate: splitAcrossFiles },
];

describe("reorganising a workspace is not a change", () => {
  for (const { kind, mutate } of IDENTITY_PRESERVING_MUTATORS) {
    // Why this case exists: declaration order and file placement are not
    // structure. A `diff` keyed on either would report a change every time an
    // author tidied their files, which is the noise that makes a diff tool
    // stop being read.
    it(`reports nothing after ${kind}`, async () => {
      await fc.assert(
        fc.asyncProperty(workspaceScenarioArbitrary, async (workspace: ScenarioWorkspace) => {
          const result = mutate(workspace);
          if (!isWorkspaceDefect(result)) return true; // Nothing to reorganise: skip, not pass.

          const { forward, backward, sources } = await diffBothWays(
            renderWorkspace(workspace),
            renderWorkspace(result.workspace),
          );
          assert.ok(
            isEmptyDelta(forward),
            `${kind} preserves every declaration, so diff must report nothing:\n` +
              `${describeDelta(forward)}\n${sources}`,
          );
          assertAntisymmetric(forward, backward, kind);
          return true;
        }),
        GENERATED_PROPERTY_PARAMETERS,
      );
    });
  }
});

// ── Property 4: after one mutation, that change and nothing else ───────────

/**
 * Mutation kinds whose change the extracted index does not model.
 *
 * Each is a real edit to the source that leaves the *structure* identical, so an
 * empty delta is the right answer and the non-emptiness half below cannot be
 * asserted for them. Measured over the shared domain, and each has a reason:
 *
 * - the two duplicate mutators add a second, identical declaration, which every
 *   extractor in the toolchain merges — 50 of 50 samples diff clean;
 * - `withhold-spread-import` removes an `import` statement, and `Delta` has no
 *   block type for imports at all;
 * - `conflict-namespace-note` changes namespace-level metadata, which `Delta`
 *   likewise does not model.
 *
 * Listing them is what keeps the other eight mutators honest: if
 * `delete-mapped-field` ever went silent, it is not on this list and the property
 * fails.
 */
const MUTATIONS_INVISIBLE_TO_DIFF: ReadonlySet<string> = new Set([
  "duplicate-entity-within-file",
  "duplicate-entity-across-files",
  "withhold-spread-import",
  "conflict-namespace-note",
]);

/** Every mutator whose delta this property checks — the defects, plus rename. */
const STRUCTURE_CHANGING_MUTATORS = [
  ...DEFECT_MUTATORS,
  { kind: "rename-entity-consistently", mutate: renameEntityConsistently },
];

describe("after one mutation, diff reports that change and nothing else", () => {
  for (const { kind, mutate } of STRUCTURE_CHANGING_MUTATORS) {
    // Why this case exists: the "and nothing else" half. A delta naming an
    // entity the mutation never touched is a false positive a reader cannot
    // detect — they see a name and believe it. The expected set comes from the
    // two *scenarios*, so nothing here is derived from what diff did.
    it(`confines the ${kind} delta to the declarations the mutation changed`, async () => {
      await fc.assert(
        fc.asyncProperty(workspaceScenarioArbitrary, async (workspace: ScenarioWorkspace) => {
          const result = mutate(workspace);
          if (!isWorkspaceDefect(result)) return true;

          const changed = scenarioChangedDeclarations(workspace, result.workspace);
          const { forward, backward, sources } = await diffBothWays(
            renderWorkspace(workspace),
            renderWorkspace(result.workspace),
          );

          const invented = namesInDelta(forward).filter((name) => !changed.includes(name));
          assert.deepEqual(
            invented,
            [],
            `${kind} on ${result.mutation.target} changed only [${changed.join(", ")}], ` +
              `but diff also reported [${invented.join(", ")}]:\n` +
              `${describeDelta(forward)}\n${sources}`,
          );

          if (!MUTATIONS_INVISIBLE_TO_DIFF.has(kind)) {
            assert.ok(
              !isEmptyDelta(forward),
              `${kind} on ${result.mutation.target} changed the workspace's structure ` +
                `and diff reported nothing:\n${sources}`,
            );
          }

          assertAntisymmetric(forward, backward, `${kind} on ${result.mutation.target}`);
          return true;
        }),
        GENERATED_PROPERTY_PARAMETERS,
      );
    });
  }
});
