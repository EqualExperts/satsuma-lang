---
id: sl-rw3e
status: in_progress
deps: []
links: []
created: 2026-06-12T06:41:50Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [lsp, vscode, diagnostics]
---
# LSP semantic diagnostics use folder-wide index instead of import closure — false duplicate-definition errors

In VS Code, opening a file (e.g. reports-and-models/pipeline.stm) reports 'Schema X is already defined in <other file>' for files that have no import relationship with the open file — e.g. two independent entry-point files in the same workspace folder that both define fact_orders.

Root cause: sendMergedDiagnostics (tooling/satsuma-lsp/src/server.ts:492) passes the GLOBAL wsIndex (seeded by a recursive folder scan in indexWorkspaceFolder) into computeSemanticValidationDiagnostics. Duplicate detection in buildSemanticIndex (tooling/satsuma-lsp/src/semantic-diagnostics.ts:191-206) therefore runs across every definition in the VS Code folder, violating ADR-022 ('IDE/LSP features for an open file consider only what is reachable transitively via imports from that file. Tooling must not treat the surrounding directory or workspace folder as an implicit merged scope.').

Every other LSP feature (definition, references, completions, rename, code lens, viz model, coverage) already uses scopeIndex(uri) (server.ts:476). Only the semantic diagnostics path uses the global index. The CLI-subprocess diagnostics path (validate-diagnostics.ts) is already import-scoped because it hands the open file to 'satsuma validate'.

## Design

Fix at the LSP call site, not in core (agreed with user): core's validateSemanticWorkspace stays reachability-unaware for duplicates because the CLI feeds it a closure-scoped index by construction; note this contract in core's doc-comment.

In the LSP, split the index passed to the two diagnostic families:
- Core semantic rules (duplicates, undefined refs, etc.): run against scopeIndex(uri) — createScopedIndex(wsIndex, getImportReachableUris(uri, wsIndex)).
- missing-import rule: keep the GLOBAL wsIndex — it must see definitions outside the closure to suggest 'Add: import { X } from ...'. Scoping it would degrade the diagnostic to a plain undefined-ref with no suggestion.

The split already exists as computeCoreSemanticDiagnostics / computeMissingImportDiagnostics in semantic-diagnostics.ts; give them different index arguments in sendMergedDiagnostics and dedup as before.

## Acceptance Criteria

1. Two sibling .stm files in the workspace folder defining the same schema name, with NO import relationship: opening either file produces NO duplicate-definition diagnostic.
2. An open file that defines a schema and imports a file defining the same name: duplicate diagnostic IS still reported on the open file (duplicates within the import closure remain errors). [Refined during implementation: the original "entry file importing two conflicting files" phrasing attaches the diagnostic to the two definition-site files, not the entry file — live LSP diagnostics are published per open file, so the testable boundary is a conflict where the open file holds one definition site. The save-time CLI path still covers whole-closure reporting.]
3. missing-import diagnostics still fire with the import suggestion when a referenced symbol exists only outside the open file's closure.
4. Regression tests added in satsuma-lsp covering these cases.
5. Full satsuma-lsp test suite passes.

