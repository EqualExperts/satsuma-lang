---
id: sl-wlta
status: open
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

