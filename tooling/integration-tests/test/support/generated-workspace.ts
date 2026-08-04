/**
 * generated-workspace.ts — this package's adapter for a generated scenario
 * workspace, on the CLI side of a comparison.
 *
 * `@satsuma/scenario-gen` builds and renders workspaces and states their
 * ground truth; it deliberately knows nothing about the toolchain. This
 * module writes a rendered workspace to disk and loads it through
 * `satsuma-cli`'s own loader (`satsuma-cli/testing`), the same way the
 * `field-lineage` and `graph` commands do — mirrors
 * `satsuma-cli/test/support/generated-workspace.ts`, which the CLI's own
 * in-process property suites use for the same purpose.
 *
 * Owns: materialising a workspace, loading it, and building the CLI's field
 * edges from it. Does not own: expected values (the generator's ground truth)
 * or any assertion.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderWorkspace } from "@satsuma/scenario-gen";
import type { ScenarioWorkspace } from "@satsuma/scenario-gen";
import { buildFieldEdges } from "@satsuma/core";
import { loadWorkspace, createFieldEdgeSource } from "satsuma-cli/testing";
import type { ExtractedWorkspace } from "satsuma-cli/testing";

/** A generated workspace materialised on disk and loaded by the CLI's own loader. */
export interface LoadedGeneratedWorkspace {
  /** Absolute path of the entry file — `files[0]`, the root of the import graph. */
  entryPath: string;
  /** Absolute path of the temporary directory holding every rendered file. */
  root: string;
  /** The rendered sources, for inclusion in an assertion message. */
  sources: string;
  /** The extracted index, as any CLI command would see it. */
  index: ExtractedWorkspace;
}

/** Render a scenario workspace into a fresh temporary directory and load it. */
export async function loadGeneratedWorkspace(
  workspace: ScenarioWorkspace,
): Promise<LoadedGeneratedWorkspace> {
  const files = renderWorkspace(workspace);
  const root = mkdtempSync(join(tmpdir(), "satsuma-generated-"));
  for (const file of files) writeFileSync(join(root, file.path), file.source);

  const entryPath = join(root, files[0]!.path);
  const { index } = await loadWorkspace(entryPath);

  return {
    entryPath,
    root,
    sources: files.map((file) => `── ${file.path}\n${file.source}`).join("\n"),
    index,
  };
}

/** Remove a workspace's temporary directory. Safe to call more than once. */
export function disposeGeneratedWorkspace(loaded: LoadedGeneratedWorkspace): void {
  rmSync(loaded.root, { recursive: true, force: true });
}

/**
 * The CLI's own field edges for a loaded generated workspace — the same edge
 * list `field-lineage` and `graph` build, via the same adapter
 * (`createFieldEdgeSource`) those commands use.
 */
export function cliFieldEdgesFor(loaded: LoadedGeneratedWorkspace) {
  return buildFieldEdges(createFieldEdgeSource(loaded.index)).edges;
}
