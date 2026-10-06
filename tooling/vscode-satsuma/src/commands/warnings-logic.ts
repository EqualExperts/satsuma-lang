/**
 * warnings-logic.ts — pure parsing and shaping of `satsuma warnings --json`
 * output (no vscode).
 *
 * The CLI's JSON envelope crosses a subprocess boundary, so its shape is
 * verified here rather than assumed; the diagnostic collection, output
 * channel wiring, and vscode.Uri/Range construction live in warnings.ts.
 * Kept separate from that command file so the line-number conversion, kind
 * resolution and shape validation stay unit-testable in plain Node (mirrors
 * coverage-logic.ts).
 */

import { commentDiagnosticMessage } from "@satsuma/core";
import type { CommentDiagnosticKind } from "@satsuma/core";

/** A single warning or question comment, as emitted by `satsuma warnings --json`. */
export interface WarningItem {
  /**
   * Which comment this is. The default (unfiltered) response mixes `//!` and
   * `//?` under a "warning" envelope, so only this field tells them apart.
   * Optional because CLIs older than sl-0j8b do not emit it.
   */
  kind?: CommentDiagnosticKind;
  text: string;
  /** 1-indexed line number — the CLI's own convention, documented in its --json help text. */
  line: number;
  file: string;
  block?: string;
  blockType?: string;
}

/** Envelope shape of `satsuma warnings --json` (see the CLI's own help text). */
export interface WarningsResponse {
  /** The filter applied: "question" under --questions, otherwise "warning". */
  kind: CommentDiagnosticKind;
  count: number;
  items: WarningItem[];
}

/**
 * Parse and validate `satsuma warnings --json` stdout.
 *
 * Returns undefined for unparseable JSON or a response whose `items` isn't
 * an array — both signal something wrong with the CLI invocation itself,
 * distinct from a validly-parsed response with zero items.
 */
export function parseWarningsResponse(raw: string): WarningsResponse | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { items?: unknown }).items)
  ) {
    return undefined;
  }
  return parsed as WarningsResponse;
}

/** A single warning or question ready to render as an editor diagnostic. */
export interface WarningMarker {
  /** Decides the severity: `//!` → Warning, `//?` → Information. */
  kind: CommentDiagnosticKind;
  /** 0-indexed line, converted from the CLI's 1-indexed `line`. */
  line: number;
  /** Diagnostic message, worded exactly as the LSP words the same comment. */
  message: string;
}

/**
 * Group the items of a parsed response by file, converting each 1-indexed
 * CLI line to the 0-indexed line vscode.Range expects.
 *
 * An item without its own `kind` takes the envelope's. That is exact under
 * --questions and the best available guess from an older CLI.
 *
 * Items without a `file` are skipped: the CLI always sets one, but this
 * guards the subprocess boundary rather than assuming it holds (sl-6osm —
 * a prior version of this command read a `row` field that the CLI had
 * already renamed to `line`, so every marker silently landed on line 0).
 */
export function groupWarningsByFile(response: WarningsResponse): Map<string, WarningMarker[]> {
  const byFile = new Map<string, WarningMarker[]>();
  for (const item of response.items) {
    if (!item.file) continue;
    let markers = byFile.get(item.file);
    if (!markers) {
      markers = [];
      byFile.set(item.file, markers);
    }
    const kind = item.kind ?? response.kind;
    markers.push({
      kind,
      line: Math.max(0, item.line - 1),
      message: commentDiagnosticMessage(kind, item.text),
    });
  }
  return byFile;
}

/**
 * The notification shown after the command runs. It counts warnings and
 * questions separately, so a workspace with only questions is not reported
 * as "No warnings found."
 */
export function summariseMarkers(byFile: Map<string, WarningMarker[]>): string {
  let warnings = 0;
  let questions = 0;
  for (const markers of byFile.values()) {
    for (const marker of markers) {
      if (marker.kind === "question") questions++;
      else warnings++;
    }
  }
  if (warnings === 0 && questions === 0) return "Satsuma: no warnings or questions found.";
  return `Satsuma: ${countOf(warnings, "warning")} and ${countOf(questions, "question")} found.`;
}

/** "1 warning", "2 warnings", "0 questions". */
function countOf(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
