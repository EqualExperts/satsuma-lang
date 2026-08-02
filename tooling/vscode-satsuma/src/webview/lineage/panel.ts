import * as vscode from "vscode";
import { join } from "path";
import { runCli } from "../../commands/cli-runner";

export class LineagePanel {
  static currentPanel: LineagePanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly cliPath: string;
  private disposables: vscode.Disposable[] = [];

  static createOrShow(extensionUri: vscode.Uri, cliPath: string, fieldPath: string): void {
    if (LineagePanel.currentPanel) {
      LineagePanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      LineagePanel.currentPanel.refresh(fieldPath);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "satsumaLineage",
      `Satsuma: Lineage — ${fieldPath}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(join(extensionUri.fsPath, "dist", "webview"))],
      },
    );

    LineagePanel.currentPanel = new LineagePanel(panel, extensionUri, cliPath, fieldPath);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    cliPath: string,
    fieldPath: string,
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.cliPath = cliPath;

    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.refresh(fieldPath);
  }

  async refresh(fieldPath: string): Promise<void> {
    this.panel.title = `Satsuma: Lineage — ${fieldPath}`;

    // Trace multi-hop lineage
    const chain = await this.traceLineage(fieldPath, 10);

    this.panel.webview.postMessage({ type: "lineageData", payload: chain });
  }

  private async traceLineage(
    fieldPath: string,
    maxHops: number,
  ): Promise<
    Array<{
      source: string;
      target: string;
      classification: string;
      transform: string;
      file: string;
      line: number;
    }>
  > {
    const visited = new Set<string>();
    const allArrows: Array<{
      source: string;
      target: string;
      classification: string;
      transform: string;
      file: string;
      line: number;
    }> = [];
    const queue = [fieldPath];

    for (let hop = 0; hop < maxHops && queue.length > 0; hop++) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const result = await runCli(this.cliPath, ["arrows", current, "--as-source", "--json"]);

      if (result.exitCode !== 0 || !result.stdout.trim()) continue;

      try {
        const arrows = JSON.parse(result.stdout);
        if (!Array.isArray(arrows)) continue;

        for (const a of arrows) {
          const src = a.source_qualified ?? `${current.split(".")[0]}.${a.source}`;
          const tgt = a.target_qualified ?? `${a.target_schema ?? "?"}.${a.target}`;

          allArrows.push({
            source: src,
            target: tgt,
            classification: a.classification ?? "none",
            transform: a.transform_raw ?? "",
            file: a.file ?? "",
            line: a.line ?? 0,
          });

          // Follow the target for next hop
          if (!visited.has(tgt)) {
            queue.push(tgt);
          }
        }
      } catch {
        // Parse error — skip
      }
    }

    return allArrows;
  }

  private handleMessage(message: { type: string; uri?: string; line?: number }): void {
    if (message.type === "navigate" && message.uri) {
      const uri = vscode.Uri.file(message.uri);
      const line = message.line ?? 0;
      vscode.window.showTextDocument(uri, {
        selection: new vscode.Range(line, 0, line, 0),
      });
    }
  }

  dispose(): void {
    LineagePanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  private getHtml(): string {
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.file(join(this.extensionUri.fsPath, "dist", "webview", "lineage", "lineage.js")),
    );
    const styleUri = this.panel.webview.asWebviewUri(
      vscode.Uri.file(join(this.extensionUri.fsPath, "dist", "webview", "lineage", "lineage.css")),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>Satsuma Lineage</title>
</head>
<body>
  <div id="lineage"></div>
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
