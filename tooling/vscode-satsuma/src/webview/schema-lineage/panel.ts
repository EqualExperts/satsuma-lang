/**
 * panel.ts — Extension-host side of the Schema Lineage webview panel.
 *
 * Replaces the output-channel rendering in src/commands/lineage.ts.
 * Calls `satsuma lineage --from <schema> <entry-file.stm> --json`, then sends the
 * resulting DAG to the webview for ELK-based pill rendering.
 */

import * as vscode from "vscode";
import { join } from "path";
import { runCli } from "../../commands/cli-runner";

interface LineageNode {
  name: string;
  type: "schema" | "mapping";
  file: string;
}

interface LineageEdge {
  src: string;
  tgt: string;
}

interface LineagePayload {
  schema: string;
  direction: "from" | "to";
  nodes: LineageNode[];
  edges: LineageEdge[];
  isDark: boolean;
}

export class SchemaLineagePanel {
  static currentPanel: SchemaLineagePanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly cliPath: string;
  private readonly entryFilePath: string;
  private disposables: vscode.Disposable[] = [];

  // ── Public factory ──────────────────────────────────────────────────────

  static createOrShow(
    extensionUri: vscode.Uri,
    cliPath: string,
    entryFilePath: string,
    schema: string,
    direction: "from" | "to",
  ): void {
    if (SchemaLineagePanel.currentPanel) {
      SchemaLineagePanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      SchemaLineagePanel.currentPanel.load(schema, direction);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "satsumaSchemaLineage",
      `Lineage — ${schema}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(join(extensionUri.fsPath, "dist", "webview")),
        ],
      },
    );

    SchemaLineagePanel.currentPanel = new SchemaLineagePanel(
      panel,
      extensionUri,
      cliPath,
      entryFilePath,
      schema,
      direction,
    );
  }

  // ── Constructor ─────────────────────────────────────────────────────────

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    cliPath: string,
    entryFilePath: string,
    schema: string,
    direction: "from" | "to",
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.cliPath = cliPath;
    this.entryFilePath = entryFilePath;

    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.load(schema, direction);
  }

  // ── Load ────────────────────────────────────────────────────────────────

  private async load(schema: string, direction: "from" | "to"): Promise<void> {
    this.panel.title = `Lineage ${direction} ${schema}`;

    const result = await runCli(this.cliPath, [
      "lineage",
      `--${direction}`,
      schema,
      this.entryFilePath,
      "--json",
    ]);

    const isDark = this.isDarkTheme();

    if (result.exitCode !== 0 || !result.stdout.trim()) {
      this.panel.webview.postMessage({
        type: "error",
        message: `lineage failed: ${result.stderr.trim() || "schema not found"}`,
      });
      return;
    }

    try {
      const dag = JSON.parse(result.stdout) as { nodes: LineageNode[]; edges: LineageEdge[] };
      const payload: LineagePayload = {
        schema,
        direction,
        nodes: dag.nodes ?? [],
        edges: dag.edges ?? [],
        isDark,
      };
      this.panel.webview.postMessage({ type: "schemaLineageData", payload });
    } catch {
      this.panel.webview.postMessage({
        type: "error",
        message: "Failed to parse lineage output",
      });
    }
  }

  // ── Message handling ────────────────────────────────────────────────────

  private handleMessage(msg: { type: string; uri?: string; line?: number }): void {
    if (msg.type === "navigate" && msg.uri) {
      const uri = vscode.Uri.file(msg.uri);
      const line = msg.line ?? 0;
      vscode.window.showTextDocument(uri, {
        selection: new vscode.Range(line, 0, line, 0),
      });
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private isDarkTheme(): boolean {
    const themeKind = vscode.window.activeColorTheme.kind;
    return (
      themeKind === vscode.ColorThemeKind.Dark ||
      themeKind === vscode.ColorThemeKind.HighContrast
    );
  }

  dispose(): void {
    SchemaLineagePanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  // ── HTML ─────────────────────────────────────────────────────────────────

  private getHtml(): string {
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.file(
        join(
          this.extensionUri.fsPath,
          "dist",
          "webview",
          "schema-lineage",
          "schema-lineage.js",
        ),
      ),
    );
    const styleUri = this.panel.webview.asWebviewUri(
      vscode.Uri.file(
        join(
          this.extensionUri.fsPath,
          "dist",
          "webview",
          "schema-lineage",
          "schema-lineage.css",
        ),
      ),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${this.panel.webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>Satsuma Schema Lineage</title>
</head>
<body>
  <div id="schema-lineage-root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
