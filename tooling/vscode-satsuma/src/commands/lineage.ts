import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { getEditorActionContext } from "./action-context";
import { resolveEntryFile } from "./entry-file";
import { SchemaLineagePanel } from "../webview/schema-lineage/panel";

interface ShowLineageArgs {
  schemaName?: string;
  direction?: "from" | "to";
}

export function registerLineageCommand(
  context: vscode.ExtensionContext,
  cliPath: string,
  client: LanguageClient,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("satsuma.showLineage", async (args?: ShowLineageArgs) => {
      const direction = args?.direction === "to" ? "to" : "from";
      let selected = args?.schemaName;

      if (!selected) {
        const actionContext = await getEditorActionContext(client);
        selected = actionContext.schemaName ?? undefined;
      }

      // Get block names from the LSP server
      let names: Array<{ name: string; kind: string }>;
      try {
        names = await client.sendRequest("satsuma/blockNames");
      } catch {
        names = [];
      }

      const schemaNames = names
        .filter((n) => n.kind === "schema")
        .map((n) => n.name);

      if (schemaNames.length === 0) {
        vscode.window.showInformationMessage("No schemas found in workspace.");
        return;
      }

      if (!selected) {
        selected = await vscode.window.showQuickPick(schemaNames, {
          placeHolder: `Select a schema to trace lineage ${direction}`,
        });
      }
      if (!selected) return;

      // The CLI rejects directories (ADR-022) — resolve a .stm entry file.
      const entryFilePath = await resolveEntryFile();
      if (!entryFilePath) return;

      SchemaLineagePanel.createOrShow(
        context.extensionUri,
        cliPath,
        entryFilePath,
        selected,
        direction,
      );
    }),
  );
}
