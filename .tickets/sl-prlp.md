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
tags: [field-lineage, core]
---
# Extract the field-lineage traversal and edge builder into satsuma-core; CLI delegates

Move the traversal and the edge builder out of satsuma-cli/src/commands/field-lineage.ts into **satsuma-core**, and point both emitters at the shared builder. The command becomes a thin adapter: parse args, load workspace, call, format.

The target package and the signature are settled by the sl-4871 spike — see features/40-shared-field-lineage-view/SPIKE-sl-4871-portable-home.md. Two corrections to this ticket as originally written:

- **Package is satsuma-core, not satsuma-viz-backend.** viz-backend is a devDependency of satsuma-cli, so lineage living there would put VizModel assembly in the published CLI bundle. Core already has the no-Node-built-ins typecheck gate this ticket's first criterion asks for.
- **The signature is not `traceFieldLineage(workspace, fieldRef, opts)`.** No workspace shape enters core at all. It splits in two (below), and step 2 is not optional — it is what "no second copy remains" actually asks for.

FieldLineageResult must keep the shape the CLI's --json already emits (field, upstream[], downstream[] with field/via_mapping/classification) because the VS Code panel consumes it today.

## Design

**Step 1 — the pure traversal.** `traceFieldLineage(edges, start, { depth, direction })` over a plain edge list and nothing else. Replaces traceUpstream/traceDownstream (field-lineage.ts:245-303). This is the function Feature 41's R4 properties (sl-jsyn) aim at, so the edge-list shape is load-bearing: it lets R4 compare directly against scenarioAncestorsWithin / scenarioDescendantsWithin in @satsuma/scenario-gen.

**Step 2 — the edge builder, behind a narrow interface.** Neither ExtractedWorkspace nor viz-backend's WorkspaceIndex may enter core. The builder reads three things:

```ts
interface FieldEdgeSource {
  arrows: Iterable<ArrowRecordLike>;                 // already deduplicated by the caller
  mappingSides(mappingKey: string): { sources: string[]; targets: string[] } | null;
  nlRefs: Iterable<ResolvedNlRefLike>;               // already resolved by the caller
}
```

distinctArrowRecords stays in the CLI (it dedupes by object reference across the multi-key fieldArrows map — a positional key is not a safe identity there), and resolveAllNLRefs stays in the CLI, so the phantom-edge history (cbh-y5og) stays on the resolver's side of the boundary. Both graph-builder.ts:469 buildFieldEdges and field-lineage.ts:160 buildFieldEdgeGraph then call the core builder; that near-line-for-line duplication is what this step deletes.

The shared builder must carry the metadata superset: graph needs transforms/nl_text/file/line and the unresolvedNl list, field-lineage needs none of them. Namespace filtering stays a caller concern — graph filters, lineage does not. graph-builder's ResolvedFieldEdge (edge + branded endpoints, added by sl-jyee) is the return shape to generalise.

**Endpoint resolution is a parameter, not a move.** Since sl-jyee, both emitters resolve endpoints through `arrowEndpoint` in satsuma-cli/src/field-endpoints.ts, which encodes the *pending* r0-7w76 reading ("a bare token that also names a declared schema reads as a field") behind a labelled rule comment. Core deliberately refuses that choice — resolveFieldEndpoint reports the fork instead. So field-endpoints.ts stays in the CLI and the core builder takes endpoint resolution as an injected function. Do not resolve r0-7w76 here.

**Dependency classification (from the spike).** spread-expand portable; nl-ref-extract portable once index-builder is; index-builder has exactly one node:path call (line 439, resolving import paths) with a precedented browser-portable substitution in viz-backend (`new URL(pathText, importerUri)`, workspace-index.ts:310); load-workspace stays in the CLI — it *is* the filesystem adapter, so the extracted code takes an already-built workspace, never a path. command-runner and option-parsers stay.

**Out of scope, deliberately.** The extracted traversal keeps today's first-visit-wins visited set, defects and all — spr-w98t owns the depth-truncation defect that R4's depth-exactness property will red-flag. Fixing it here would violate the byte-identical criterion below.

## Acceptance Criteria

- traceFieldLineage and the edge builder both live in satsuma-core with no Node built-in (fs/path/url) on their import path, asserted by core's existing test:typecheck gate plus a test over the module graph.
- No workspace index type (ExtractedWorkspace, WorkspaceIndex) appears in either core signature.
- The 17 existing tests in satsuma-cli/test/field-lineage.test.ts pass UNCHANGED.
- satsuma field-lineage output is byte-identical for every case those tests cover, and satsuma graph output is byte-identical across graph.test.ts and Feature 41 R3's generated edge invariants.
- The pinned r0-7w76 expectations in test/field-endpoints.test.ts and the pinned container-header property in test/generated-edge-invariants.test.ts stay green — going red means the extraction silently decided r0-7w76.
- Only one edge builder remains: field-lineage.ts and graph-builder.ts both call core's, and neither retains its own walk.
- Cycle detection and the --depth limit move with the traversal and stay covered.

## Notes

**2026-08-04T09:27:14Z**

Re-planned against the sl-4871 spike finding and Feature 41 R6 (both now on main at
f775a972); no code change, ticket text only.

Body and acceptance criteria previously named "the package chosen by the spike" and a
`traceFieldLineage(workspace, fieldRef, opts)` signature that the spike then ruled out.
Now records the settled answers: satsuma-core, a two-step split (pure traversal over an
edge list, then the edge builder behind FieldEdgeSource), and the one new question R6
created — field-endpoints.ts holds the undecided r0-7w76 reading that core refuses to
make, so endpoint resolution is injected rather than moved.

Raised spr-w98t for the field traversal's depth-truncation defect, found while checking
this plan: sl-y89y's DepthAwareTraversal fix reached commands/lineage.ts only, so
field-lineage.ts still has the original first-visit-wins shape. It cannot be fixed inside
this ticket (byte-identical output), and R4 (sl-jsyn) will fail on it, so it is sequenced
between the two.
