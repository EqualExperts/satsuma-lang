import {
  Diagnostic,
  DiagnosticSeverity,
  Range,
  Position,
} from "vscode-languageserver";
import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Shape of a single entry from `satsuma validate --json`. */
interface ValidateEntry {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  rule: string;
  message: string;
  fixable: boolean;
}

const SEVERITY_MAP: Record<string, DiagnosticSeverity> = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  info: DiagnosticSeverity.Information,
};

/**
 * Run `satsuma validate --json` on the directory containing the given file
 * and return LSP diagnostics grouped by file URI.
 *
 * The CLI validates at directory scope so cross-file checks (undefined refs,
 * missing imports) work correctly.
 */
export async function runValidate(
  fileUri: string,
  cliPath: string,
): Promise<Map<string, Diagnostic[]>> {
  const filePath = fileURLToPath(fileUri);

  return new Promise((resolve) => {
    try {
      execFile(
        cliPath,
        ["validate", "--json", filePath],
        { timeout: 15_000 },
        (_error, stdout, _stderr) => {
          const result = new Map<string, Diagnostic[]>();
          // Parse stdout even on non-zero exit (validate returns 2 on errors)
          const raw = stdout.trim();
          if (!raw) {
            resolve(result);
            return;
          }

          let entries: ValidateEntry[];
          try {
            entries = JSON.parse(raw);
          } catch {
            resolve(result);
            return;
          }

          if (!Array.isArray(entries)) {
            resolve(result);
            return;
          }

          for (const entry of entries) {
            const uri = pathToFileUri(entry.file);
            // validate lines are 1-based; LSP is 0-based
            const line = Math.max(0, entry.line - 1);
            const col = Math.max(0, entry.column - 1);

            const diag: Diagnostic = {
              range: Range.create(
                Position.create(line, col),
                Position.create(line, col),
              ),
              severity: SEVERITY_MAP[entry.severity] ?? DiagnosticSeverity.Warning,
              source: "satsuma-validate",
              code: entry.rule,
              message: entry.message,
            };

            const existing = result.get(uri);
            if (existing) {
              existing.push(diag);
            } else {
              result.set(uri, [diag]);
            }
          }

          resolve(result);
        },
      );
    } catch {
      // Spawn can throw synchronously (EPERM, EACCES) — return empty map
      resolve(new Map());
    }
  });
}

/**
 * Convert an absolute filesystem path (as emitted by `satsuma validate --json`)
 * into a `file://` URI that matches the editor's document URIs.
 *
 * Exported for direct testing of the URI invariant. We delegate to Node's
 * `pathToFileURL` rather than hand-building the URL: on Windows a path like
 * `C:\proj\x.stm` must become `file:///c:/proj/x.stm`, but string concatenation
 * (`"file://" + path`) leaves the drive colon and backslashes raw, producing a
 * malformed URI that never matches the open document — so diagnostics silently
 * fail to attach. `pathToFileURL` also percent-encodes URL-significant
 * characters (spaces, `?`, `#`) that naive encoding mishandles. (gh-265)
 */
export function pathToFileUri(fsPath: string): string {
  return pathToFileURL(fsPath).toString();
}
