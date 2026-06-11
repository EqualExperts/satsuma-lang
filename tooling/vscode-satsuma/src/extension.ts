import { join } from "path";
import * as vscode from "vscode";
import { ExtensionContext, window, workspace } from "vscode";
import { SATSUMA_FILE_GLOB } from "@satsuma/core/source-files";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import { registerValidateCommand } from "./commands/validate";
import { registerLineageCommand } from "./commands/lineage";
import { registerWarningsCommand } from "./commands/warnings";
import { registerSummaryCommand } from "./commands/summary";
import { registerCoverageCommand } from "./commands/coverage";
import { getEditorActionContext } from "./commands/action-context";
import { resolveEntryFile } from "./commands/entry-file";
import { VizPanel } from "./webview/viz/panel";
import { FieldLineagePanel } from "./webview/field-lineage/panel";

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
  const serverModule = context.asAbsolutePath(
    join("server", "dist", "server.js"),
  );

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6009"] },
    },
  };

  const config = workspace.getConfiguration("satsuma");
  const cliPath = config.get<string>("cliPath") || "satsuma";

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "satsuma" }],
    initializationOptions: {
      cliPath,
    },
    synchronize: {
      // One watcher covering every registered Satsuma extension — the server
      // gates incoming events with the same shared predicate (sl-v215).
      fileEvents: [workspace.createFileSystemWatcher(SATSUMA_FILE_GLOB)],
    },
  };

  client = new LanguageClient(
    "satsumaLanguageServer",
    "Satsuma Language Server",
    serverOptions,
    clientOptions,
  );

  client.start();
  context.subscriptions.push({ dispose: () => client?.stop() });

  // Output channel for command results
  const outputChannel = window.createOutputChannel("Satsuma");
  context.subscriptions.push(outputChannel);

  // Register commands
  registerValidateCommand(context, cliPath);
  registerLineageCommand(context, cliPath, client);
  registerWarningsCommand(context, cliPath);
  registerSummaryCommand(context, cliPath, outputChannel);

  registerCoverageCommand(context, cliPath, client);

  // Mapping visualization webview
  context.subscriptions.push(
    vscode.commands.registerCommand("satsuma.showViz", () => {
      if (client) {
        VizPanel.createOrShow(context.extensionUri, client, cliPath);
      }
    }),
  );

  // Field Lineage webview (Phase 1 — ELK panel)
  context.subscriptions.push(
    vscode.commands.registerCommand("satsuma.traceFieldLineage", async (args?: { fieldPath?: string }) => {
      // The CLI scopes the workspace via the entry file's imports and rejects
      // directories (ADR-022) — never fall back to a folder path (sl-1ycv).
      const entryFilePath = await resolveEntryFile();
      if (!entryFilePath) return;

      // Prefer: explicit arg > LSP actionContext > user input
      let fieldPath: string | undefined = args?.fieldPath;

      if (!fieldPath && client) {
        const actionContext = await getEditorActionContext(client);
        fieldPath = actionContext.fieldPath ?? undefined;
      }

      if (!fieldPath) {
        // Command-palette fallback: prompt for the field
        const editor = vscode.window.activeTextEditor;
        const word = editor?.document.getText(
          editor.document.getWordRangeAtPosition(editor.selection.active),
        );
        fieldPath = await vscode.window.showInputBox({
          prompt: "Enter field reference (schema.field)",
          value: word?.includes(".") ? word : `${word ?? ""}.`,
          placeHolder: "customers.email",
        });
      }

      if (!fieldPath) return;

      FieldLineagePanel.createOrShow(
        context.extensionUri,
        cliPath,
        entryFilePath,
        fieldPath,
      );
    }),
  );
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
