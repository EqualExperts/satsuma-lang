/**
 * warnings.ts — the "Satsuma: Show Warnings" command.
 *
 * The LSP reports `//!` and `//?` comments only for documents open in an
 * editor. This command fills the gap for the rest of the workspace: it runs
 * `satsuma warnings <entry> --json` and puts every warning and question it
 * finds into the Problems panel, `//!` at Warning and `//?` at Information.
 * Parsing and shaping the CLI output lives in warnings-logic.ts.
 */

import * as vscode from "vscode";
import type { CommentDiagnosticKind } from "@satsuma/core";
import { runCli } from "./cli-runner";
import { resolveEntryFile } from "./entry-file";
import { parseWarningsResponse, groupWarningsByFile, summariseMarkers } from "./warnings-logic";
import type { WarningMarker } from "./warnings-logic";

/** Same severities the LSP uses for the same comments (see its diagnostics.ts). */
const SEVERITY_BY_KIND: Record<CommentDiagnosticKind, vscode.DiagnosticSeverity> = {
  warning: vscode.DiagnosticSeverity.Warning,
  question: vscode.DiagnosticSeverity.Information,
};

export function registerWarningsCommand(context: vscode.ExtensionContext, cliPath: string): void {
  const diagnostics = vscode.languages.createDiagnosticCollection("satsuma-warnings-cmd");
  context.subscriptions.push(diagnostics);

  // ── Overlap with the LSP ────────────────────────────────────────────────
  // Rule: while a file is open, its comments come from the LSP alone, which
  // re-reads them on every edit. Publishing the command's snapshot as well
  // would list each comment twice, and the snapshot goes stale as soon as the
  // user types. So the command's results for a file are withheld while it is
  // open and restored when it closes, which is also when the LSP clears its
  // own diagnostics for it.
  const lastResults = new Map<string, vscode.Diagnostic[]>();

  const isOpen = (uri: vscode.Uri): boolean =>
    vscode.workspace.textDocuments.some((doc) => doc.uri.toString() === uri.toString());

  const publish = (uri: vscode.Uri): void => {
    const diags = lastResults.get(uri.toString());
    if (diags && !isOpen(uri)) diagnostics.set(uri, diags);
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => diagnostics.delete(doc.uri)),
    vscode.workspace.onDidCloseTextDocument((doc) => publish(doc.uri)),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("satsuma.showWarnings", async () => {
      // See sl-1ycv: the CLI needs a .stm entry file, not the cwd default.
      const entryFilePath = await resolveEntryFile();
      if (!entryFilePath) return;

      const result = await runCli(cliPath, ["warnings", entryFilePath, "--json"]);
      diagnostics.clear();
      lastResults.clear();

      const data = parseWarningsResponse(result.stdout);
      if (!data) {
        if (result.stderr) {
          vscode.window.showWarningMessage(result.stderr.trim());
        }
        return;
      }

      const byFile = groupWarningsByFile(data);
      for (const [file, markers] of byFile) {
        const uri = vscode.Uri.file(file);
        lastResults.set(uri.toString(), markers.map(toDiagnostic));
        publish(uri);
      }

      vscode.window.showInformationMessage(summariseMarkers(byFile));
    }),
  );
}

/** A zero-width diagnostic at the start of the comment's line. */
function toDiagnostic(marker: WarningMarker): vscode.Diagnostic {
  const diag = new vscode.Diagnostic(
    new vscode.Range(marker.line, 0, marker.line, 0),
    marker.message,
    SEVERITY_BY_KIND[marker.kind],
  );
  diag.source = "satsuma-warnings";
  return diag;
}
