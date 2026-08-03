---
id: sl-prlp
status: open
deps: [sl-4871]
links: []
created: 2026-08-03T12:24:14Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-12kz
tags: [field-lineage]
---
# Extract traceFieldLineage into a browser-portable package; CLI delegates

Move the traversal out of satsuma-cli/src/commands/field-lineage.ts into the package chosen by the spike, as a pure traceFieldLineage(workspace, fieldRef, {depth, direction}) function. The command becomes a thin adapter: parse args, load workspace, call, format.

FieldLineageResult must keep the shape the CLI's --json already emits (field, upstream[], downstream[] with field/via_mapping/classification) because the VS Code panel consumes it today.

## Acceptance Criteria

- traceFieldLineage has no Node built-in (fs/path/url) on its import path, asserted by a test over the module graph.
- The 17 existing tests in satsuma-cli/test/field-lineage.test.ts pass UNCHANGED.
- satsuma field-lineage output is byte-identical for every case those tests cover.
- No second copy of the traversal remains in the CLI.
- Cycle detection and the --depth limit move with the traversal and stay covered.

