import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";

export interface EditorActionContext {
  schemaName: string | null;
  fieldPath: string | null;
  mappingName: string | null;
  targetSchema: string | null;
}

export async function getEditorActionContext(client: LanguageClient): Promise<EditorActionContext> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "satsuma") {
    return { schemaName: null, fieldPath: null, mappingName: null, targetSchema: null };
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
    return { schemaName: null, fieldPath: null, mappingName: null, targetSchema: null };
  }
}
