/**
 * entry-file.ts — vscode wiring for entry-file resolution (sl-1ycv).
 *
 * Owns the editor/workspace lookups and the quick-pick UI around the pure
 * selection rules in entry-file-logic.ts. Every CLI invocation in the
 * extension goes through {@link resolveEntryFile} so no call site can fall
 * back to a directory path, which the CLI rejects since ADR-022.
 */

import * as vscode from "vscode";
import { classifyEntryFileCandidates } from "./entry-file-logic";

/**
 * Cap on the workspace .stm search. Far above any realistic workspace size —
 * it only guards against pathological folders (e.g. a home directory opened
 * by accident).
 */
const MAX_STM_SEARCH_RESULTS = 200;

/**
 * The user's last quick-pick choice, offered as the top item next time.
 * Session-scoped on purpose: a persisted default could silently go stale
 * when the workspace's entry-point file moves.
 */
let lastPickedEntryFile: string | undefined;

/**
 * Resolve the .stm file that anchors a CLI invocation, prompting only when
 * the workspace is genuinely ambiguous (several .stm files and none active).
 * Returns undefined when the user dismisses the prompt or the workspace has
 * no .stm files — callers must abort their CLI call in that case, never
 * substitute a directory.
 */
export async function resolveEntryFile(): Promise<string | undefined> {
  const activeDoc = vscode.window.activeTextEditor?.document;
  const activeFsPath =
    activeDoc && !activeDoc.isUntitled ? activeDoc.uri.fsPath : undefined;

  const found = await vscode.workspace.findFiles(
    "**/*.stm",
    "**/node_modules/**",
    MAX_STM_SEARCH_RESULTS,
  );

  const resolution = classifyEntryFileCandidates(
    activeFsPath,
    found.map((uri) => uri.fsPath),
  );

  switch (resolution.kind) {
    case "active":
    case "single":
      return resolution.fsPath;

    case "ambiguous": {
      // Float the previous choice to the top so repeat invocations are
      // one keystroke, without skipping the prompt entirely.
      const ordered = lastPickedEntryFile
        ? [
            ...resolution.candidates.filter((c) => c === lastPickedEntryFile),
            ...resolution.candidates.filter((c) => c !== lastPickedEntryFile),
          ]
        : resolution.candidates;

      const picked = await vscode.window.showQuickPick(
        ordered.map((fsPath) => ({
          label: vscode.workspace.asRelativePath(fsPath),
          description: fsPath === lastPickedEntryFile ? "last used" : undefined,
          fsPath,
        })),
        {
          placeHolder:
            "Select the Satsuma entry file (the workspace is its transitive imports)",
        },
      );
      if (picked) lastPickedEntryFile = picked.fsPath;
      return picked?.fsPath;
    }

    case "none":
      vscode.window.showInformationMessage(
        "No .stm files found in this workspace.",
      );
      return undefined;
  }
}
