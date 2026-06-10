/**
 * panel.ts — Extension-host side of the Field Lineage webview panel.
 *
 * Drives the panel by calling `satsuma field-lineage <field> <entry-file.stm> --json`
 * (a single CLI call, not the old hop-by-hop arrows loop) and maintains
 * breadcrumb navigation state as the user re-centres on different fields.
 */

import * as vscode from "vscode";
import { join } from "path";
import { runCli } from "../../commands/cli-runner";

export class FieldLineagePanel {
  static currentPanel: FieldLineagePanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly cliPath: string;
  private readonly entryFilePath: string;
  private breadcrumb: string[] = [];
  private depth = 3;
  private disposables: vscode.Disposable[] = [];

  // ── Public factory ────────────────────────────────────────────────────────

  static createOrShow(
    extensionUri: vscode.Uri,
    cliPath: string,
    entryFilePath: string,
    fieldPath: string,
  ): void {
    if (FieldLineagePanel.currentPanel) {
      FieldLineagePanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      // Reset breadcrumb for a fresh navigation from a new field
      FieldLineagePanel.currentPanel.breadcrumb = [];
      FieldLineagePanel.currentPanel.navigateTo(fieldPath);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "satsumaFieldLineage",
      `Field Lineage — ${fieldPath}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(join(extensionUri.fsPath, "dist", "webview")),
        ],
      },
    );

    FieldLineagePanel.currentPanel = new FieldLineagePanel(
      panel,
      extensionUri,
      cliPath,
      entryFilePath,
      fieldPath,
    );
  }

  // ── Constructor ───────────────────────────────────────────────────────────

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    cliPath: string,
    entryFilePath: string,
    fieldPath: string,
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

    this.navigateTo(fieldPath);
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  /**
   * Navigate to a new focal field.
   * Appends to the breadcrumb trail and re-runs the CLI.
   */
  async navigateTo(fieldPath: string): Promise<void> {
    this.breadcrumb.push(fieldPath);
    this.panel.title = `Field Lineage — ${fieldPath}`;
    await this.refresh();
  }

  /**
   * Navigate back one step in the breadcrumb trail.
   */
  async back(): Promise<void> {
    if (this.breadcrumb.length <= 1) return;
    this.breadcrumb.pop();
    const prev = this.breadcrumb[this.breadcrumb.length - 1]!;
    this.panel.title = `Field Lineage — ${prev}`;
    // Remove the last breadcrumb entry so refresh() re-adds it via navigateTo pattern
    this.breadcrumb.pop();
    await this.navigateTo(prev);
  }

  /**
   * Jump to a specific index in the breadcrumb trail (e.g. clicking a crumb).
   */
  async breadcrumbGoto(index: number): Promise<void> {
    if (index < 0 || index >= this.breadcrumb.length - 1) return;
    const target = this.breadcrumb[index]!;
    this.breadcrumb = this.breadcrumb.slice(0, index);
    await this.navigateTo(target);
  }

  // ── Refresh ───────────────────────────────────────────────────────────────

  private async refresh(): Promise<void> {
    const fieldPath = this.breadcrumb[this.breadcrumb.length - 1];
    if (!fieldPath) return;

    // The CLI takes schema.field (without leading ::)
    const bare = fieldPath.startsWith("::") ? fieldPath.slice(2) : fieldPath;

    const result = await runCli(this.cliPath, [
      "field-lineage",
      bare,
      this.entryFilePath,
      "--json",
      "--depth",
      String(this.depth),
    ]);

    const isDark = this.isDarkTheme();

    if (result.exitCode !== 0 || !result.stdout.trim()) {
      this.panel.webview.postMessage({
        type: "error",
        message: `field-lineage failed: ${result.stderr.trim() || "field not found"}`,
      });
      return;
    }

    try {
      const data = JSON.parse(result.stdout) as {
        field: string;
        upstream: Array<{ field: string; via_mapping: string; classification: string }>;
        downstream: Array<{ field: string; via_mapping: string; classification: string }>;
      };

      this.panel.webview.postMessage({
        type: "fieldLineageData",
        payload: {
          field: data.field,
          upstream: data.upstream ?? [],
          downstream: data.downstream ?? [],
          breadcrumb: [...this.breadcrumb],
          isDark,
        },
      });
    } catch {
      this.panel.webview.postMessage({
        type: "error",
        message: "Failed to parse field-lineage output",
      });
    }
  }

  // ── Message handling ──────────────────────────────────────────────────────

  private handleMessage(msg: {
    type: string;
    fieldPath?: string;
    index?: number;
    uri?: string;
    line?: number;
    depth?: number;
  }): void {
    switch (msg.type) {
      case "recenter":
        if (msg.fieldPath) {
          this.navigateTo(msg.fieldPath);
        }
        break;

      case "back":
        this.back();
        break;

      case "breadcrumbGoto":
        if (msg.index !== undefined) {
          this.breadcrumbGoto(msg.index);
        }
        break;

      case "navigate":
        if (msg.uri) {
          const uri = vscode.Uri.file(msg.uri);
          const line = msg.line ?? 0;
          vscode.window.showTextDocument(uri, {
            selection: new vscode.Range(line, 0, line, 0),
          });
        }
        break;

      case "setDepth":
        if (msg.depth !== undefined && msg.depth >= 1 && msg.depth <= 10) {
          this.depth = msg.depth;
          // Re-run with the current focal field at the new depth
          this.breadcrumb.pop();
          const current = this.breadcrumb[this.breadcrumb.length - 1];
          if (current !== undefined) {
            this.breadcrumb.pop();
            this.navigateTo(current);
          }
        }
        break;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private isDarkTheme(): boolean {
    const themeKind = vscode.window.activeColorTheme.kind;
    return (
      themeKind === vscode.ColorThemeKind.Dark ||
      themeKind === vscode.ColorThemeKind.HighContrast
    );
  }

  dispose(): void {
    FieldLineagePanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  // ── HTML ──────────────────────────────────────────────────────────────────

  private getHtml(): string {
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.file(
        join(
          this.extensionUri.fsPath,
          "dist",
          "webview",
          "field-lineage",
          "field-lineage.js",
        ),
      ),
    );
    const styleUri = this.panel.webview.asWebviewUri(
      vscode.Uri.file(
        join(
          this.extensionUri.fsPath,
          "dist",
          "webview",
          "field-lineage",
          "field-lineage.css",
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
  <title>Satsuma Field Lineage</title>
</head>
<body>
  <div id="field-lineage-root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
