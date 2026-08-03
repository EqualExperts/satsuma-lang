import * as vscode from "vscode";
import { runCli } from "./cli-runner";
import { resolveEntryFile } from "./entry-file";
import { parseSummaryResponse, buildSummarySections } from "./summary-logic";

export function registerSummaryCommand(
  context: vscode.ExtensionContext,
  cliPath: string,
  outputChannel: vscode.OutputChannel,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("satsuma.showSummary", async () => {
      // See sl-1ycv: the CLI needs a .stm entry file, not the cwd default.
      const entryFilePath = await resolveEntryFile();
      if (!entryFilePath) return;

      const result = await runCli(cliPath, ["summary", entryFilePath, "--json"]);

      if (result.exitCode !== 0) {
        vscode.window.showWarningMessage(
          `Summary failed: ${result.stderr.trim() || "unknown error"}`,
        );
        return;
      }

      const data = parseSummaryResponse(result.stdout);
      if (!data) {
        outputChannel.clear();
        outputChannel.appendLine(result.stdout);
        outputChannel.show();
        return;
      }

      outputChannel.clear();
      outputChannel.appendLine("Satsuma Workspace Summary");
      outputChannel.appendLine("=".repeat(40));
      outputChannel.appendLine("");
      outputChannel.appendLine(`Files: ${data.fileCount}`);
      outputChannel.appendLine("");

      for (const section of buildSummarySections(data)) {
        outputChannel.appendLine(`${section.label} (${section.items.length}):`);
        for (const line of section.items) {
          outputChannel.appendLine(line);
        }
        outputChannel.appendLine("");
      }

      outputChannel.show();
    }),
  );
}
