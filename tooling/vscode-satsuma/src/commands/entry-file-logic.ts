/**
 * entry-file-logic.ts — pure entry-file selection rules (no vscode imports).
 *
 * Since ADR-022 the Satsuma CLI rejects directory arguments: a workspace is
 * defined by a .stm entry file plus its transitive imports. Every extension
 * feature that shells out to the CLI must therefore name a concrete .stm
 * file. This module owns the *decision rules* for which file that should be;
 * the vscode wiring (active editor, file search, quick pick) lives in
 * entry-file.ts so these rules stay unit-testable in plain Node (sl-1ycv).
 */

/** File extension that marks a Satsuma source file. */
const STM_EXTENSION = ".stm";

/** Outcome of classifying the available entry-file candidates. */
export type EntryFileResolution =
  /** The active editor is a .stm file — use it without prompting. */
  | { kind: "active"; fsPath: string }
  /** Exactly one .stm file exists in the workspace — use it without prompting. */
  | { kind: "single"; fsPath: string }
  /** Several .stm files and no active one — the caller must ask the user. */
  | { kind: "ambiguous"; candidates: string[] }
  /** No .stm files in the workspace at all. */
  | { kind: "none" };

/**
 * Decide which .stm file should anchor a CLI invocation.
 *
 * Priority: the active editor's file when it is a .stm file (the user is
 * looking at it — it is the least surprising workspace root), else the only
 * .stm file when there is exactly one, else an ambiguous result carrying the
 * candidates ordered for a quick pick. Returns `none` when the workspace has
 * no .stm files.
 */
export function classifyEntryFileCandidates(
  activeEditorFsPath: string | undefined,
  workspaceStmFiles: string[],
): EntryFileResolution {
  if (activeEditorFsPath && activeEditorFsPath.endsWith(STM_EXTENSION)) {
    return { kind: "active", fsPath: activeEditorFsPath };
  }
  if (workspaceStmFiles.length === 1) {
    return { kind: "single", fsPath: workspaceStmFiles[0] };
  }
  if (workspaceStmFiles.length > 1) {
    return { kind: "ambiguous", candidates: orderCandidatesForPick(workspaceStmFiles) };
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
