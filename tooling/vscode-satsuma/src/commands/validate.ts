import * as vscode from "vscode";
import { runCli } from "./cli-runner";
import { resolveEntryFile } from "./entry-file";

export function registerValidateCommand(
  context: vscode.ExtensionContext,
  cliPath: string,
): void {
  const diagnostics = vscode.languages.createDiagnosticCollection("satsuma-validate-cmd");
  context.subscriptions.push(diagnostics);

  context.subscriptions.push(
    vscode.commands.registerCommand("satsuma.validateWorkspace", async () => {
      // The CLI rejects directories and defaults a missing path argument to
      // "." (ADR-022) — name a .stm entry file explicitly (sl-1ycv).
      const entryFilePath = await resolveEntryFile();
      if (!entryFilePath) return;

      const result = await runCli(cliPath, ["validate", entryFilePath, "--json"]);
      diagnostics.clear();

      let entries: Array<{
        file: string;
        line: number;
        column: number;
        severity: string;
        rule: string;
        message: string;
      }>;

      try {
        entries = JSON.parse(result.stdout);
        if (!Array.isArray(entries)) return;
      } catch {
        if (result.stderr) {
          vscode.window.showWarningMessage(`Satsuma validate: ${result.stderr.trim()}`);
        }
        return;
      }

      const grouped = new Map<string, vscode.Diagnostic[]>();
      for (const e of entries) {
        const uri = vscode.Uri.file(e.file).toString();
        const diag = new vscode.Diagnostic(
          new vscode.Range(
            Math.max(0, e.line - 1),
            Math.max(0, e.column - 1),
            Math.max(0, e.line - 1),
            Math.max(0, e.column - 1),
          ),
          e.message,
          e.severity === "error"
            ? vscode.DiagnosticSeverity.Error
            : vscode.DiagnosticSeverity.Warning,
        );
        diag.source = "satsuma-validate";
        diag.code = e.rule;
        if (!grouped.has(uri)) grouped.set(uri, []);
        grouped.get(uri)!.push(diag);
      }

      for (const [uriStr, diags] of grouped) {
        diagnostics.set(vscode.Uri.parse(uriStr), diags);
      }

      vscode.window.showInformationMessage(
        `Satsuma: ${entries.length} diagnostic(s) found.`,
      );
    }),
  );
}
