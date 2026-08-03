/**
 * warnings-logic.ts — pure parsing and shaping of `satsuma warnings --json`
 * output (no vscode).
 *
 * The CLI's JSON envelope crosses a subprocess boundary, so its shape is
 * verified here rather than assumed; the diagnostic collection, output
 * channel wiring, and vscode.Uri/Range construction live in warnings.ts.
 * Kept separate from that command file so the line-number conversion and
 * shape validation stay unit-testable in plain Node (mirrors coverage-logic.ts).
 */

/** A single warning or question comment, as emitted by `satsuma warnings --json`. */
export interface WarningItem {
  text: string;
  /** 1-indexed line number — the CLI's own convention, documented in its --json help text. */
  line: number;
  file: string;
  block?: string;
  blockType?: string;
}

/** Envelope shape of `satsuma warnings --json` (see the CLI's own help text). */
export interface WarningsResponse {
  kind: "warning" | "question";
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

/** A single warning ready to render as an editor diagnostic. */
export interface WarningMarker {
  /** 0-indexed line, converted from the CLI's 1-indexed `line`. */
  line: number;
  text: string;
}

/**
 * Group warning items by file, converting each 1-indexed CLI line to the
 * 0-indexed line vscode.Range expects.
 *
 * Items without a `file` are skipped: the CLI always sets one, but this
 * guards the subprocess boundary rather than assuming it holds (sl-6osm —
 * a prior version of this command read a `row` field that the CLI had
 * already renamed to `line`, so every marker silently landed on line 0).
 */
export function groupWarningsByFile(items: WarningItem[]): Map<string, WarningMarker[]> {
  const byFile = new Map<string, WarningMarker[]>();
  for (const item of items) {
    if (!item.file) continue;
    let markers = byFile.get(item.file);
    if (!markers) {
      markers = [];
      byFile.set(item.file, markers);
    }
    markers.push({ line: Math.max(0, item.line - 1), text: item.text });
  }
  return byFile;
}
