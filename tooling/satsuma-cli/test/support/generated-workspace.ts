/**
 * generated-workspace.ts — the CLI's adapter for a generated scenario workspace.
 *
 * `@satsuma/scenario-gen` builds and renders workspaces and states their ground
 * truth; it deliberately knows nothing about the toolchain. This module is the
 * CLI's half of that arrangement: write a rendered workspace to disk, load it the
 * way a command does, and hand back the pieces a property needs.
 *
 * It goes through the filesystem rather than assembling an index in memory
 * because `import` resolution is a filesystem operation — `resolveInput` follows
 * import declarations to discover the workspace's files. A property that skipped
 * that step could not exercise the multi-file axis at all, which is most of what
 * makes lineage interesting.
 *
 * Owns: materialising a workspace and loading it. Does not own: expected values
 * (the generator's ground truth) or any assertion.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderWorkspace } from "@satsuma/scenario-gen";
import type { ScenarioWorkspace } from "@satsuma/scenario-gen";
import { loadWorkspace } from "#src/load-workspace.js";
import { collectSemanticWarnings } from "#src/semantic-warnings.js";
import { buildWorkspaceGraph } from "#src/commands/graph-builder.js";
import { buildFullGraph } from "#src/schema-graph.js";
import { createFieldEdgeSource } from "#src/field-edge-source.js";
import type { WorkspaceGraph, GraphBuildOpts } from "#src/commands/graph-builder.js";
import type { ExtractedWorkspace, ParsedFile } from "#src/types.js";
import { buildFieldEdges } from "@satsuma/core";

/** A generated workspace materialised on disk and loaded by the CLI's own loader. */
export interface LoadedGeneratedWorkspace {
  /** Absolute path of the entry file — `files[0]`, the root of the import graph. */
  entryPath: string;
  /** Absolute path of the temporary directory holding every rendered file. */
  root: string;
  /** The rendered sources, for inclusion in an assertion message. */
  sources: string;
  /** The extracted index, as any command would see it. */
  index: ExtractedWorkspace;
  /**
   * Every file the loader parsed, with its CST.
   *
   * Kept because a diagnostic's *position* can only be judged against the
   * declaration it sits inside, and no extracted record carries a declaration's
   * end row — only its start (`SchemaRecord.row` and friends). The CST does, so a
   * property that asserts containment rather than an exact line reads it from
   * here. See `generated-diagnostic-properties.test.ts`.
   */
  parsed: ParsedFile[];
  /** How many files the loader actually reached by following imports. */
  fileCount: number;
  /** Total tree-sitter ERROR/MISSING recovery nodes across every loaded file. */
  parseErrorCount: number;
}

/**
 * Write already-rendered files to a fresh temporary directory and load them.
 *
 * `files[0]` is the entry. Exposed separately from
 * {@link loadGeneratedWorkspace} for the few cases that need Satsuma the scenario
 * model cannot express — a container header naming a schema *root* has no field
 * path, so it is a literal fixture rather than a scenario.
 *
 * The caller must call {@link disposeGeneratedWorkspace} — a property runs this a
 * hundred times, and leaving a directory behind each time would fill `tmpdir`.
 */
export async function loadRenderedFiles(
  files: Array<{ path: string; source: string }>,
): Promise<LoadedGeneratedWorkspace> {
  const root = mkdtempSync(join(tmpdir(), "satsuma-generated-"));
  for (const file of files) writeFileSync(join(root, file.path), file.source);

  const entryPath = join(root, files[0].path);
  const { files: loaded, index } = await loadWorkspace(entryPath);

  return {
    entryPath,
    root,
    sources: files.map((file) => `── ${file.path}\n${file.source}`).join("\n"),
    index,
    parsed: loaded,
    fileCount: loaded.length,
    parseErrorCount: loaded.reduce((total, file) => total + file.errorCount, 0),
  };
}

/** Render a scenario workspace into a fresh temporary directory and load it. */
export async function loadGeneratedWorkspace(
  workspace: ScenarioWorkspace,
): Promise<LoadedGeneratedWorkspace> {
  return loadRenderedFiles(renderWorkspace(workspace));
}

/** Remove a workspace's temporary directory. Safe to call more than once. */
export function disposeGeneratedWorkspace(loaded: LoadedGeneratedWorkspace): void {
  rmSync(loaded.root, { recursive: true, force: true });
}

/**
 * Semantic diagnostics for a loaded generated workspace, as one printable list.
 *
 * Every generated workspace must be clean: a property asserting how lineage
 * behaves on input the toolchain itself considers broken would be asserting
 * nothing worth knowing.
 */
export function semanticProblems(loaded: LoadedGeneratedWorkspace): string[] {
  return collectSemanticWarnings(loaded.index).map(
    (diagnostic) =>
      `${diagnostic.severity} ${diagnostic.rule} at ${diagnostic.file}:${diagnostic.line} — ${diagnostic.message}`,
  );
}

/**
 * Build the workspace graph for a loaded generated workspace.
 *
 * Defaults match `satsuma graph` with no flags: NL text included, field-level
 * detail kept, no namespace filter. Callers override one option at a time so a
 * failure names the flag under test.
 */
export function graphFor(
  loaded: LoadedGeneratedWorkspace,
  opts: Partial<GraphBuildOpts> = {},
): WorkspaceGraph {
  const options: GraphBuildOpts = {
    namespace: null,
    includeNl: true,
    schemaOnly: false,
    ...opts,
  };
  return buildWorkspaceGraph(loaded.index, buildFullGraph(loaded.index), loaded.root, options);
}

/**
 * Build the portable field-edge list for a loaded generated workspace.
 *
 * The same edge list `field-lineage` traces over, via the same adapter
 * (`createFieldEdgeSource`) the command itself uses — no namespace filter, since
 * field-lineage traverses the full index. This is R4's (`sl-jsyn`) entry point
 * into core's `traceFieldLineage`: properties call it directly rather than
 * through the CLI command, per the ticket's design ("aim every property at the
 * single portable traversal extracted by `sl-prlp`, not at the CLI-internal
 * function").
 */
export function fieldEdgesFor(loaded: LoadedGeneratedWorkspace) {
  return buildFieldEdges(createFieldEdgeSource(loaded.index)).edges;
}
