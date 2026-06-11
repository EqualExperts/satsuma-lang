---
id: sl-wlta
status: closed
deps: []
links: []
created: 2026-06-11T02:43:30Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-hunt, vscode]
---
# vscode: minor fixes batch — NaN exit code, SVG save dialog at filesystem root, dead escapeHtml

Three small confirmed issues. (1) cli-runner.ts exitCode uses Number(error.code): execFile failures with string codes (ENOENT when the satsuma CLI is not installed — the most common new-user failure) yield exit code NaN in messages. (2) viz/panel.ts:193 exportSvg defaultUri = vscode.Uri.file("mapping-viz.svg") resolves to /mapping-viz.svg — the save dialog opens at filesystem root instead of the workspace. (3) webview/field-lineage/field-lineage.ts:525 and webview/schema-lineage/schema-lineage.ts:301 define escapeHtml that is never called (rendering is DOM-based) and does not escape quotes — remove or fix before anyone uses it in attribute context.

## Acceptance Criteria

ENOENT reports a clear "CLI not found" message; save dialog defaults inside the workspace; dead escapeHtml removed.


## Notes

**2026-06-11T07:08:11Z**

Cause: (1) cli-runner coerced execFile's error.code with Number(), so string errnos (ENOENT when the CLI is not installed) yielded "exit code NaN" in messages; (2) exportSvg passed a bare relative Uri.file which resolves to the filesystem root, opening the save dialog at "/"; (3) field-lineage.ts and schema-lineage.ts each carried an escapeHtml that nothing called and that did not escape quotes.
Fix: (1) added vscode-free cli-runner-logic.ts with exitCodeFrom (string errno -> 1, never NaN) and spawnFailureMessage (ENOENT -> install/cliPath hint surfaced via stderr to every caller toast), unit-tested; (2) save dialog now defaults to <workspaceRoot>/mapping-viz.svg, or the dialog default when no workspace is open; (3) both dead escapeHtml functions removed.
