/**
 * viz-target.ts — which file the mapping visualisation panel loads (bsw-a2zk).
 *
 * The panel can be asked to show a file three ways: a command invoked with a
 * file's URI (the Explorer's right-click entry), the active Satsuma editor,
 * or, when the webview itself has focus, the file it last showed. This module
 * owns only the precedence between them. It knows nothing about VS Code, so
 * the rule stays unit-testable in plain Node.
 */

/** The candidate files the panel could show, as URI strings. */
export interface VizTargetCandidates {
  /** URI the command was invoked with, e.g. the file right-clicked in the Explorer. */
  requestedUri: string | undefined;
  /** URI of the active editor's document, when that document is Satsuma. */
  activeSatsumaUri: string | undefined;
  /** URI the panel last loaded successfully. */
  lastUri: string | undefined;
}

/**
 * The URI the panel should load, or undefined when nothing names a file.
 *
 * An explicitly requested file wins, because the reader just named it; then
 * the active Satsuma editor; then the last file shown, so Refresh still works
 * while the webview has focus.
 */
export function chooseVizTargetUri(candidates: VizTargetCandidates): string | undefined {
  return candidates.requestedUri ?? candidates.activeSatsumaUri ?? candidates.lastUri;
}
