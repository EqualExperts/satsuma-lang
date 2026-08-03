import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";

export interface EditorActionContext {
  schemaName: string | null;
  fieldPath: string | null;
  mappingName: string | null;
  /**
   * 0-indexed start row of the enclosing `mapping` block, or null when the cursor
   * is not inside one.
   *
   * Identity, where `mappingName` is only a display label: two namespaces may each
   * declare `mapping load`, and an anonymous block has no label at all, so a
   * request carrying the name alone gets whichever block was declared first. Pass
   * this to `satsuma/mappingCoverage`.
   */
  mappingRow: number | null;
  targetSchema: string | null;
}

/** No cursor context: every field absent rather than a partial shape. */
const EMPTY_CONTEXT: EditorActionContext = {
  schemaName: null,
  fieldPath: null,
  mappingName: null,
  mappingRow: null,
  targetSchema: null,
};

export async function getEditorActionContext(client: LanguageClient): Promise<EditorActionContext> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "satsuma") {
    return EMPTY_CONTEXT;
  }

  try {
    return await client.sendRequest("satsuma/actionContext", {
      uri: editor.document.uri.toString(),
      position: {
        line: editor.selection.active.line,
        character: editor.selection.active.character,
      },
    });
  } catch {
    return EMPTY_CONTEXT;
  }
}
