---
id: gpt-l0nz
status: open
deps: []
links: []
created: 2026-08-06T18:57:26Z
type: task
priority: 3
assignee: Thorben Louw
tags: [scenario-gen, testing, diff]
---
# scenario-gen: no generated workspace declares a transform block

The scenario model has no `transform` declaration, so no generated workspace renders one. That leaves a real shape uncovered by every generated suite in the repository, and it is not a cosmetic gap: `TransformRecord.body` is the **only layout-bearing string in an extracted index**, which makes a `transform` block with a multi-line pipe chain the only input that can tell a structural comparison from a textual one.

Found while building Feature 46 R5 (gpt-ocmp). The reformat-invariance property there had to take a literal fixture through `loadRenderedFiles` for that shape, because the generated domain could not reach it — and that fixture is what the ticket's mutation check fires on. Measured: 0 of 54 rendered files from `workspaceScenarioArbitrary` contain a pipe chain.

Consequences beyond diff: the CLI's `where-used` and `find` treat a transform as a first-class entity (`ExtractedWorkspace.transforms`), the LSP resolves and renames one, and `scenarioDeclaredEntities` has a `keyword` union that already includes only `schema`, `fragment` and `mapping`. So every generated property that loops over declared entities silently skips transforms today.

## Acceptance Criteria

workspace-model.js gains a transform declaration constructor, workspace-render.js renders it (including a multi-line pipe chain body, since collapsing layout is the point), and an arbitrary reaches it. scenarioDeclaredEntities and scenarioDeclaredUsageSites account for transforms — a transform is referenced from a pipe chain, so decide and document whether those references are usage sites. The literal fixture in tooling/satsuma-cli/test/generated-diff-algebra.test.ts is replaced by the generated domain, or kept with a comment saying what it still adds.

