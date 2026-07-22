---
id: sl-b90g
status: in_progress
deps: []
links: [sl-mrn3]
created: 2026-07-22T15:18:15Z
type: bug
priority: 0
assignee: Thorben Louw
tags: [vscode, webview, regression]
---
# Webview message guard breaks all webviews: 'No mapping file loaded'

The security fix in e8c638c (sl-mrn3) added a webview message guard that checks event.source === window.parent. This is the wrong invariant for VS Code webviews: messages posted by the extension host via webview.postMessage() do not arrive with source === window.parent, so the guard silently drops every host message. All four webviews (viz, lineage, schema-lineage, field-lineage) are affected; the viz panel shows a permanent 'No mapping file loaded' because the vizModel message never reaches the component. The regression shipped untested against the real VS Code runtime — message-guard.test.js only unit-tests the pure identity function, and the viz-harness Playwright suite does not exercise the VS Code webview.

## Acceptance Criteria

1. Viz panel renders the mapping model again (no permanent 'No mapping file loaded'). 2. All four webviews receive host messages. 3. Provenance guard still rejects foreign-origin messages, satisfying the Semgrep concern from sl-mrn3. 4. Guard uses the VS Code-sanctioned check (event.origin === window.origin). 5. message-guard.test.js updated to reflect origin semantics; unit tests pass. 6. dist rebuilt.


## Notes

**2026-07-22T15:21:26Z**

**2026-07-22T15:21:26Z**

Cause: The webview message guard added in e8c638c (sl-mrn3) checked event.source === window.parent. That invariant does not hold in the VS Code webview runtime — host messages posted via webview.postMessage() do not arrive with source === window.parent — so the guard dropped every host message and all four webviews (viz, lineage, schema-lineage, field-lineage) stopped receiving data; viz showed a permanent 'No mapping file loaded'.
Fix: Switched the guard to the VS Code-sanctioned check event.origin === window.origin (isExtensionHostMessage now takes selfOrigin), updated all four call sites to pass window.origin, and rewrote message-guard.test.js for origin semantics. Guard still rejects foreign-origin messages, preserving the sl-mrn3 Semgrep fix.
