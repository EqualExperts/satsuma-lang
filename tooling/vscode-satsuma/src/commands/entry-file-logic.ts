/**
 * entry-file-logic.ts — pure entry-file selection rules (no vscode imports).
 *
 * Since ADR-022 the Satsuma CLI rejects directory arguments: a workspace is
 * defined by a Satsuma entry file plus its transitive imports. Every extension
 * feature that shells out to the CLI must therefore name a concrete source
 * file (.stm or .satsuma — see @satsuma/core source-files, sl-v215). This
 * module owns the *decision rules* for which file that should be; the vscode
 * wiring (active editor, file search, quick pick) lives in entry-file.ts so
 * these rules stay unit-testable in plain Node (sl-1ycv).
 */

import { isSatsumaFilePath } from "@satsuma/core/source-files";

/** Outcome of classifying the available entry-file candidates. */
export type EntryFileResolution =
  /** The active editor is a Satsuma file — use it without prompting. */
  | { kind: "active"; fsPath: string }
  /** Exactly one Satsuma file exists in the workspace — use it without prompting. */
  | { kind: "single"; fsPath: string }
  /** Several Satsuma files and no active one — the caller must ask the user. */
  | { kind: "ambiguous"; candidates: string[] }
  /** No Satsuma files in the workspace at all. */
  | { kind: "none" };

/**
 * Decide which Satsuma file should anchor a CLI invocation.
 *
 * Priority: the active editor's file when it is a Satsuma file (the user is
 * looking at it — it is the least surprising workspace root), else the only
 * Satsuma file when there is exactly one, else an ambiguous result carrying
 * the candidates ordered for a quick pick. Returns `none` when the workspace
 * has no Satsuma files.
 */
export function classifyEntryFileCandidates(
  activeEditorFsPath: string | undefined,
  workspaceSourceFiles: string[],
): EntryFileResolution {
  if (activeEditorFsPath && isSatsumaFilePath(activeEditorFsPath)) {
    return { kind: "active", fsPath: activeEditorFsPath };
  }
  if (workspaceSourceFiles.length === 1) {
    return { kind: "single", fsPath: workspaceSourceFiles[0] };
  }
  if (workspaceSourceFiles.length > 1) {
    return { kind: "ambiguous", candidates: orderCandidatesForPick(workspaceSourceFiles) };
  }
  return { kind: "none" };
}

/**
 * Order candidate paths for the quick pick: shallowest first, then
 * alphabetically. Platform entry-point files conventionally live at the
 * workspace root (e.g. `platform.stm` importing the per-domain pipelines —
 * see "Platform Lineage Entry Point" in AGENTS.md), so the most likely
 * entry file sorts to the top.
 */
export function orderCandidatesForPick(fsPaths: string[]): string[] {
  const depth = (p: string) => p.split(/[\\/]/).length;
  return [...fsPaths].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
}
