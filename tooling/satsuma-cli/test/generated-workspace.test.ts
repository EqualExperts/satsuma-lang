/**
 * generated-workspace.test.ts — the two gates every generated workspace passes.
 *
 * Before any lineage or graph property may assert *what* the toolchain reports
 * about a generated workspace, the workspace has to be one the toolchain accepts:
 *
 * 1. it parses with no ERROR or MISSING recovery node, and
 * 2. it produces no semantic diagnostic.
 *
 * Without both, a failing property is ambiguous — it could be a real defect or a
 * generator that emitted Satsuma nobody would write. These gates make the second
 * possibility a failure of *this* file, reported against the generator, with the
 * rendered sources in the message.
 *
 * A third check is a generator self-check rather than a toolchain assertion: every
 * file must be reachable by following imports from the entry. A file nothing
 * imports is never loaded, so every edge it declares would look to a property like
 * an edge the toolchain dropped.
 *
 * Named-construct coverage lives in one fixed case, the kitchen-sink workspace —
 * PRD acceptance test 5. The families are exercised by the property below.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import {
  GENERATED_PROPERTY_PARAMETERS,
  kitchenSinkWorkspace,
  renderWorkspace,
  workspaceScenarioArbitrary,
} from "@satsuma/scenario-gen";
import type { ScenarioWorkspace } from "@satsuma/scenario-gen";
import {
  disposeGeneratedWorkspace,
  loadGeneratedWorkspace,
  semanticProblems,
} from "./support/generated-workspace.js";

// The WASM parser is initialised by `test/setup.ts`, which the test script
// preloads with `--import`; no per-suite `initParser` is needed.

/**
 * Load a workspace, run `check` against it, and always remove its directory.
 *
 * fast-check runs a property a hundred times; a leaked temporary directory per
 * run would fill `tmpdir` long before the suite finished.
 */
async function withGeneratedWorkspace(
  workspace: ScenarioWorkspace,
  check: (loaded: Awaited<ReturnType<typeof loadGeneratedWorkspace>>) => void,
): Promise<void> {
  const loaded = await loadGeneratedWorkspace(workspace);
  try {
    check(loaded);
  } finally {
    disposeGeneratedWorkspace(loaded);
  }
}

describe("generated workspaces are input the toolchain accepts (sl-dqyu)", () => {
  it("parses every generated workspace without a recovery node", async () => {
    // Gate 1. A generated workspace that only *nearly* parses would let every
    // downstream property assert over a partially recovered tree, where a missing
    // edge is the parser's doing rather than the graph builder's.
    await fc.assert(
      fc.asyncProperty(workspaceScenarioArbitrary, async (workspace: ScenarioWorkspace) => {
        await withGeneratedWorkspace(workspace, (loaded) => {
          assert.equal(
            loaded.parseErrorCount,
            0,
            `generated workspace must parse recovery-free:\n${loaded.sources}`,
          );
        });
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("produces no semantic diagnostic for any generated workspace", async () => {
    // Gate 2. Unresolved refs, out-of-scope cross-file references and duplicate
    // definitions are all things the generator could emit by accident, and all
    // things that would make a lineage answer meaningless rather than wrong.
    await fc.assert(
      fc.asyncProperty(workspaceScenarioArbitrary, async (workspace: ScenarioWorkspace) => {
        await withGeneratedWorkspace(workspace, (loaded) => {
          assert.deepEqual(
            semanticProblems(loaded),
            [],
            `generated workspace must validate clean:\n${loaded.sources}`,
          );
        });
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("makes every generated file reachable by following imports from the entry", async () => {
    // Generator self-check. Satsuma scopes symbols explicitly (spec §5.3), so a
    // file nothing imports is simply not part of the workspace. Silently dropping
    // one would understate the expected edge set, and the resulting property
    // failures would read as toolchain omissions.
    await fc.assert(
      fc.asyncProperty(workspaceScenarioArbitrary, async (workspace: ScenarioWorkspace) => {
        await withGeneratedWorkspace(workspace, (loaded) => {
          assert.equal(
            loaded.fileCount,
            workspace.files.length,
            `entry file must reach every generated file by import:\n${loaded.sources}`,
          );
        });
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });
});

describe("the kitchen-sink workspace exercises every lineage axis (sl-dqyu)", () => {
  it("renders a namespace, an each container, an NL @ref, a computed arrow, a spread and a metric", () => {
    // PRD acceptance test 5, stated as the constructs that must appear in the
    // rendered text. Asserting on the *source* rather than on parse output is
    // deliberate: it fails loudly if a future edit quietly drops an axis from the
    // acceptance case, which no downstream assertion would notice.
    const sources = renderWorkspace(kitchenSinkWorkspace)
      .map((file: { source: string }) => file.source)
      .join("\n");

    for (const [construct, pattern] of [
      ["a cross-file import", /^import \{ .+ \} from "\.\/.+\.stm"$/m],
      ["a namespace block", /^namespace \w+ \{$/m],
      ["a namespace-qualified ref", /\w+::\w+/],
      ["an each container", /^\s+each \S+ -> \S+ \{$/m],
      ["a container-relative arrow", /^\s+\.\w+ -> \.\w+$/m],
      ["an NL @ref mention", /\{ ".*@\w+\.\w+.*" \}/],
      ["a computed arrow", /^\s+-> \w+ \{ "/m],
      ["a fragment spread", /^\s+\.\.\.\w+$/m],
      ["a metric schema", /^schema \w+ \(metric, metric_name/m],
      ["a metric source token", /source \w+::\w+\)/],
      ["a list_of record declaration", /^\s+\w+ list_of record \{$/m],
    ] as const) {
      assert.match(sources, pattern, `kitchen-sink workspace lost ${construct}`);
    }
  });

  it("parses and validates as a four-file workspace", async () => {
    // The axes have to coexist, not merely each work alone: a namespace holding a
    // container block whose target spreads a fragment is where scoping rules
    // interact, and it is also the shape the multi-file import derivation has to
    // get right for the whole thing to load at all.
    await withGeneratedWorkspace(kitchenSinkWorkspace, (loaded) => {
      assert.equal(loaded.parseErrorCount, 0, `kitchen sink must parse:\n${loaded.sources}`);
      assert.deepEqual(
        semanticProblems(loaded),
        [],
        `kitchen sink must validate clean:\n${loaded.sources}`,
      );
      assert.equal(loaded.fileCount, 4, `kitchen sink must load four files:\n${loaded.sources}`);
    });
  });
});
