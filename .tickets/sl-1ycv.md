---
id: sl-1ycv
status: closed
deps: []
links: []
created: 2026-06-10T21:51:46Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [vscode, cli, lineage]
---
# VS Code lineage panels pass workspace directory to CLI, rejected since ADR-022

The 'Satsuma: Show Lineage From...' command fails with: "lineage failed: Error resolving path '<path>': directory arguments are not supported — provide a .stm file instead."

Root cause: ADR-022 (commit 62479fd, 2026-03-31) made the CLI reject directory arguments — the workspace is now defined by a .stm entry file and its transitive imports. The VS Code extension was never updated and still passes directory paths:

- tooling/vscode-satsuma/src/commands/lineage.ts:50-51 resolves workspaceFolders[0].uri.fsPath (a directory) and hands it to SchemaLineagePanel.
- tooling/vscode-satsuma/src/webview/schema-lineage/panel.ts:112-118 runs 'satsuma lineage --from <schema> <workspacePath> --json' with that directory.
- tooling/vscode-satsuma/src/webview/field-lineage/panel.ts:133-136 has the identical pattern for 'satsuma field-lineage'.
- tooling/vscode-satsuma/src/commands/validate.ts, warnings.ts, summary.ts pass NO path; the CLI defaults the path arg to '.' (load-workspace.ts:69, validate.ts:45) which is also a directory, so these commands fail the same way.

The schema-lineage webview shipped 2026-03-29 (4f39116), two days before ADR-022 landed; nothing reconciled the two. Users hit it now because the latest release is the first to bundle the directory-rejecting CLI with the extension.

Fix direction: the extension needs an entry-file resolution strategy instead of directory/cwd args — e.g. the active editor's .stm file, the LSP's known workspace entry, and/or a satsuma.entryFile setting (the platform entry-point convention in CLAUDE.md). Apply it to all six runCli call sites and add regression coverage so extension CLI invocations never pass directories.

## Acceptance Criteria

All extension CLI invocations (schema-lineage, field-lineage, validate, warnings, summary) pass a .stm file path, never a directory or implicit cwd. Lineage panel renders for a multi-file workspace. Tests cover the entry-file resolution logic.


## Notes

**2026-06-10T22:29:52Z**

Cause: ADR-022 (62479fd) made the CLI reject directory arguments, but the extension still passed the workspace folder (schema-lineage and field-lineage panels, viz panel's fieldLineage message) or no path at all (validate/warnings/summary, which the CLI defaults to '.') — every CLI-backed feature failed with 'directory arguments are not supported'.
Fix: added resolveEntryFile() (commands/entry-file.ts + pure rules in entry-file-logic.ts): active .stm editor wins, else the single workspace .stm file, else a quick pick (shallowest-first, last choice floated to top); all six runCli call sites now pass a .stm entry file and abort rather than fall back to a directory. Unit tests cover the selection rules (test/entry-file-logic.test.js).
