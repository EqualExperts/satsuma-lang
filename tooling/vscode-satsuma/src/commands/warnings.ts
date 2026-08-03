import * as vscode from "vscode";
import { runCli } from "./cli-runner";
import { resolveEntryFile } from "./entry-file";
import { parseWarningsResponse, groupWarningsByFile } from "./warnings-logic";

export function registerWarningsCommand(context: vscode.ExtensionContext, cliPath: string): void {
  const diagnostics = vscode.languages.createDiagnosticCollection("satsuma-warnings-cmd");
  context.subscriptions.push(diagnostics);

  context.subscriptions.push(
    vscode.commands.registerCommand("satsuma.showWarnings", async () => {
      // See sl-1ycv: the CLI needs a .stm entry file, not the cwd default.
      const entryFilePath = await resolveEntryFile();
      if (!entryFilePath) return;

      const result = await runCli(cliPath, ["warnings", entryFilePath, "--json"]);
      diagnostics.clear();

      const data = parseWarningsResponse(result.stdout);
      if (!data) {
        if (result.stderr) {
          vscode.window.showWarningMessage(result.stderr.trim());
        }
        return;
      }

      if (data.items.length === 0) {
        vscode.window.showInformationMessage("No warnings found.");
        return;
      }

      for (const [file, markers] of groupWarningsByFile(data.items)) {
        const diags = markers.map((marker) => {
          const diag = new vscode.Diagnostic(
            new vscode.Range(marker.line, 0, marker.line, 0),
            marker.text,
            vscode.DiagnosticSeverity.Warning,
          );
          diag.source = "satsuma-warnings";
          return diag;
        });
        diagnostics.set(vscode.Uri.file(file), diags);
      }

      vscode.window.showInformationMessage(`Satsuma: ${data.count} warning(s) found.`);
    }),
  );
}
