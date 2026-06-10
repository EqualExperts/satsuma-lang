import * as vscode from "vscode";
import { runCli } from "./cli-runner";
import { resolveEntryFile } from "./entry-file";

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

      try {
        const data = JSON.parse(result.stdout);
        outputChannel.clear();
        outputChannel.appendLine("Satsuma Workspace Summary");
        outputChannel.appendLine("=".repeat(40));
        outputChannel.appendLine("");

        if (data.files !== undefined) {
          outputChannel.appendLine(`Files: ${data.files}`);
          outputChannel.appendLine("");
        }

        const sections: {
          key: string;
          label: string;
          format: (item: Record<string, unknown>) => string;
        }[] = [
          {
            key: "schemas",
            label: "Schemas",
            format: (s) => {
              const fields =
                s.fieldCount === 1
                  ? `[${s.fieldCount} field]`
                  : `[${s.fieldCount} fields]`;
              const note = s.note ? ` — ${s.note}` : "";
              return `  ${s.name}  ${fields}${note}`;
            },
          },
          {
            key: "mappings",
            label: "Mappings",
            format: (m) => {
              const note = m.note ? ` — ${m.note}` : "";
              return `  ${m.name}${note}`;
            },
          },
          {
            key: "fragments",
            label: "Fragments",
            format: (f) => {
              const note = f.note ? ` — ${f.note}` : "";
              return `  ${f.name}${note}`;
            },
          },
          {
            key: "transforms",
            label: "Transforms",
            format: (t) => {
              const note = t.note ? ` — ${t.note}` : "";
              return `  ${t.name}${note}`;
            },
          },
          {
            key: "metrics",
            label: "Metrics",
            format: (m) => {
              const note = m.note ? ` — ${m.note}` : "";
              return `  ${m.name}${note}`;
            },
          },
          {
            key: "notes",
            label: "Notes",
            format: (n) => `  ${n.name || n.text || JSON.stringify(n)}`,
          },
          {
            key: "arrows",
            label: "Arrows",
            format: (a) => `  ${a.name || JSON.stringify(a)}`,
          },
        ];

        for (const section of sections) {
          const items = data[section.key];
          if (Array.isArray(items) && items.length > 0) {
            outputChannel.appendLine(
              `${section.label} (${items.length}):`,
            );
            for (const item of items) {
              outputChannel.appendLine(section.format(item));
            }
            outputChannel.appendLine("");
          }
        }

        outputChannel.show();
      } catch {
        outputChannel.clear();
        outputChannel.appendLine(result.stdout);
        outputChannel.show();
      }
    }),
  );
}
