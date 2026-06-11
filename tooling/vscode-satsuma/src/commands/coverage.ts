/**
 * coverage.ts — vscode wiring for the mapping-coverage gutter overlay.
 *
 * Owns the decoration types, status-bar item, and editor lifecycle around the
 * pure result shaping in coverage-logic.ts. One coverage overlay is active at
 * a time: running the command replaces the previous overlay entirely, and the
 * satsuma.clearCoverage command (also bound to the status-bar item) dismisses
 * it. Decorations are applied to editors as they become visible — never by
 * opening files, which used to yank editor focus once per schema (sl-89id).
 */

import * as vscode from "vscode";
import { join } from "path";
import { LanguageClient } from "vscode-languageclient/node";
import { getEditorActionContext } from "./action-context";
import {
  CoverageSchema,
  FileCoverageMarkers,
  computeTargetCoverageStats,
  groupCoverageByUri,
} from "./coverage-logic";

// ---------- Overlay state (one active coverage run at a time) ----------

/**
 * Decoration types for the current run. Created fresh per run and disposed on
 * clear: disposing a TextEditorDecorationType is the only operation that
 * removes its decorations from every editor, including tabs that are not
 * currently visible — per-editor setDecorations(…, []) cannot reach those,
 * which is exactly how stale icons survived earlier runs (sl-89id).
 */
let mappedDecoration: vscode.TextEditorDecorationType | undefined;
let unmappedDecoration: vscode.TextEditorDecorationType | undefined;

/** Status bar item showing target coverage %; clicking it clears the overlay. */
let coverageBar: vscode.StatusBarItem | undefined;

/**
 * Markers of the active run, keyed by normalised document URI. Consulted when
 * an affected file becomes visible so its icons appear without the command
 * having to open (and focus) every file up front.
 */
let activeMarkers: Map<string, FileCoverageMarkers> | undefined;

/** Normalise an LSP-reported URI for comparison with editor document URIs. */
function normalizeUri(uri: string): string {
  return vscode.Uri.parse(uri).toString();
}

/** Dispose the current overlay: all gutter icons everywhere, plus the bar. */
function clearCoverageOverlay(): void {
  mappedDecoration?.dispose();
  unmappedDecoration?.dispose();
  mappedDecoration = undefined;
  unmappedDecoration = undefined;
  activeMarkers = undefined;
  coverageBar?.hide();
}

// ---------- Decoration application ----------

/** Gutter icon size relative to the line height, shared by both icons. */
const GUTTER_ICON_SIZE = "80%";

function createDecorationTypes(extensionPath: string): void {
  mappedDecoration = vscode.window.createTextEditorDecorationType({
    gutterIconPath: join(extensionPath, "icons", "mapped.svg"),
    gutterIconSize: GUTTER_ICON_SIZE,
    overviewRulerColor: "#4caf50",
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });
  unmappedDecoration = vscode.window.createTextEditorDecorationType({
    gutterIconPath: join(extensionPath, "icons", "unmapped.svg"),
    gutterIconSize: GUTTER_ICON_SIZE,
    overviewRulerColor: "#f44336",
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });
}

function toDecorationOptions(
  markers: { line: number; hoverMessage: string }[],
): vscode.DecorationOptions[] {
  return markers.map((m) => ({
    range: new vscode.Range(m.line, 0, m.line, 0),
    hoverMessage: m.hoverMessage,
  }));
}

/** Apply the active run's markers to one editor, if its file is affected. */
function decorateEditor(editor: vscode.TextEditor): void {
  if (!activeMarkers || !mappedDecoration || !unmappedDecoration) return;
  const markers = activeMarkers.get(editor.document.uri.toString());
  if (!markers) return;
  editor.setDecorations(mappedDecoration, toDecorationOptions(markers.mapped));
  editor.setDecorations(unmappedDecoration, toDecorationOptions(markers.unmapped));
}

// ---------- Command registration ----------

export function registerCoverageCommand(
  context: vscode.ExtensionContext,
  _cliPath: string,
  client: LanguageClient,
): void {
  coverageBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  // The bar doubles as the overlay's dismiss affordance.
  coverageBar.command = "satsuma.clearCoverage";
  context.subscriptions.push(coverageBar);
  context.subscriptions.push({ dispose: clearCoverageOverlay });

  context.subscriptions.push(
    vscode.commands.registerCommand("satsuma.showCoverage", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "satsuma") return;

      const actionContext = await getEditorActionContext(client);
      const { mappingName } = actionContext;

      if (!mappingName) {
        vscode.window.showWarningMessage(
          "Place cursor inside a named mapping block to show coverage.",
        );
        return;
      }

      let coverageResult: { schemas: CoverageSchema[] };
      try {
        coverageResult = await client.sendRequest("satsuma/mappingCoverage", {
          uri: editor.document.uri.toString(),
          mappingName,
        });
      } catch {
        vscode.window.showWarningMessage("Could not compute mapping coverage.");
        return;
      }

      if (coverageResult.schemas.length === 0) {
        vscode.window.showInformationMessage(
          `No schemas found for mapping '${mappingName}'.`,
        );
        return;
      }

      // Each run fully replaces the previous overlay — disposing the old
      // decoration types removes stale icons from every file (sl-89id).
      clearCoverageOverlay();
      createDecorationTypes(context.extensionPath);

      const grouped = groupCoverageByUri(coverageResult.schemas);
      activeMarkers = new Map(
        [...grouped].map(([uri, markers]) => [normalizeUri(uri), markers]),
      );

      // Decorate only what is already on screen; other affected files get
      // their icons when they become visible. Never open files here — one
      // showTextDocument per schema used to churn the visible editor.
      for (const visible of vscode.window.visibleTextEditors) {
        decorateEditor(visible);
      }

      const stats = computeTargetCoverageStats(coverageResult.schemas);
      if (stats && coverageBar) {
        coverageBar.text = `$(check) Coverage: ${stats.pct}%`;
        coverageBar.tooltip =
          `${stats.mapped}/${stats.total} target fields mapped by ` +
          `'${mappingName}' — click to clear coverage icons`;
        coverageBar.show();
      }
    }),
  );

  // Explicit dismissal for the whole overlay (also reachable via the bar).
  context.subscriptions.push(
    vscode.commands.registerCommand("satsuma.clearCoverage", () => {
      clearCoverageOverlay();
    }),
  );

  // Late decoration: an affected file opened or revealed after the run still
  // gets its icons, replacing the old behaviour of force-opening every file.
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const e of editors) decorateEditor(e);
    }),
  );
}
