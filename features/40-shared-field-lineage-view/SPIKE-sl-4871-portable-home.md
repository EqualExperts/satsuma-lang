# Spike `sl-4871` — the portable home for the field-lineage traversal

**Finding, 2026-08-03.** No production code committed, per the ticket's own
acceptance criteria. Written while implementing Feature 41, whose R4 and R5 both
wait on `sl-prlp`, which waits on this.

**State checked against:** `feat/lineage-graph-confidence` at `5df87195`
(`main` at `3ba4e95d` plus Feature 41 R1–R3).

## Recommendation in one line

Split the work in two and put **both halves in `satsuma-core`**: a pure
`traceFieldLineage(edges, start, opts)` over a plain edge list, and a
`buildFieldEdges(source)` over a **narrow structural interface** that the CLI and
`viz-backend` each satisfy from their own index. Do not put either in
`satsuma-viz-backend`.

## Why the split is the whole answer

`field-lineage.ts` is two things stacked, and only one of them is coupled to a
workspace shape:

| Part | Lines | Needs |
|---|---|---|
| `buildFieldEdgeGraph(index)` | 159–234 | the workspace index |
| `traceUpstream` / `traceDownstream` | 242–300 | **an edge list and nothing else** |

Every logged traversal defect lives in the *second* part — `sl-y89y` (a plain
visited-set truncating a subtree under a depth limit), `sg-pufq` (`--to` returning
one chain instead of every branch) — and that part has no coupling to argue about.
Extracting it is unconditionally safe and needs no interface design at all.

The first part is where the coupling is, and it is also the part **duplicated**:
`graph-builder.ts:458 buildFieldEdges` and `field-lineage.ts:159
buildFieldEdgeGraph` are near line-for-line the same walk, differing in namespace
filtering and NL text. Extracting it once deletes that duplication, which is what
`sl-prlp`'s "no second copy of the traversal remains in the CLI" is really asking
for.

## The four CLI-internal dependencies, classified

The ticket asks for each of `index-builder`, `nl-ref-extract`, `spread-expand` and
`load-workspace` to be classified portable / must-move / can-be-parameterised.

| Module | Node built-ins | Verdict |
|---|---|---|
| `spread-expand.ts` | none | **portable.** Its only CLI import is `resolveScopedEntityRef`, which core already exports from `canonical-ref.ts` — so that import is a re-export hop, not a dependency. |
| `nl-ref-extract.ts` | none of its own | **portable, once `index-builder` is.** It pulls `canonicalKey`, `distinctArrowRecords` and `qualifyField` from `index-builder`, and so inherits that module's single `node:path` import transitively. The three helpers themselves are pure. |
| `index-builder.ts` | `node:path`, at **one** site | **can be parameterised — or better, substituted.** Line 439: `resolve(dirname(fileData.filePath), imp.path)`, resolving import paths for `fileImports`. `viz-backend` already does the same job browser-portably with `new URL(pathText, importerUri)` (`workspace-index.ts:310 resolveImportUri`, hardened for URI spelling under `sl-akz6`). That is a precedented one-line substitution, not a parameter to thread. |
| `load-workspace.ts` | `node:fs` throughout, by design | **stays in the CLI.** It *is* the filesystem adapter: `resolveInput` walks the import graph on disk, `parseFile` reads files. The extracted function must take an already-built workspace, never a path. |

Two more that `field-lineage.ts` imports and the ticket does not name:

| Module | Verdict |
|---|---|
| `command-runner.ts`, `option-parsers.ts` | **stay.** `commander`, `process.exit`, CLI exit codes. The command becomes a thin adapter around them, which is the shape `sl-prlp` describes. |
| `types.ts` | **portable** — type-only, and its own imports are core types. |

So the *only* real portability obstacle in the whole set is one `node:path` call
with an existing browser-portable replacement in a sibling package.

## The `ExtractedWorkspace` coupling — what shape to take instead

`ExtractedWorkspace` is the CLI's index; `viz-backend` has its own `WorkspaceIndex`.
Neither should appear in the extracted signature, and neither needs to. The edge
builder reads exactly three things:

```ts
/**
 * Everything building a field-edge graph needs. Deliberately narrower than any
 * workspace index: it is three accessors, so the CLI can satisfy it from
 * ExtractedWorkspace and viz-backend from WorkspaceIndex without either shape
 * entering core.
 */
interface FieldEdgeSource {
  /** Deduplicated arrow records, one per authored arrow. */
  arrows: Iterable<ArrowRecordLike>;
  /** A mapping's declared source and target lists, for qualifying arrow paths. */
  mappingSides(mappingKey: string): { sources: string[]; targets: string[] } | null;
  /** Resolved NL `@ref` mentions, for the `nl-derived` tier. */
  nlRefs: Iterable<ResolvedNlRefLike>;
}
```

Three consequences worth stating, because each removes a design question:

1. **`arrows` is already deduplicated.** `distinctArrowRecords`
   (`index-builder.ts:579`) dedupes *by object reference* across the CLI's
   multi-key `fieldArrows` map — a positional key is explicitly not a safe identity
   there. That multi-key registration is a CLI indexing concern, so
   `distinctArrowRecords` **stays in the CLI** and core receives the flat sequence.
2. **`mappingSides` is a lookup, not a map.** Passing a `Map` would drag the CLI's
   `MappingRecord` into core. A function returning two string arrays is the whole
   contract.
3. **NL refs arrive resolved.** `resolveAllNLRefs` is the CLI's; core takes its
   output, not the resolver. This also keeps the phantom-edge history (`cbh-y5og`)
   on the resolver's side of the boundary rather than the traversal's.

## Why `satsuma-core`, not `satsuma-viz-backend`

- `viz-backend` is a **devDependency** of `satsuma-cli`. Putting lineage there
  makes it a runtime dependency of the CLI, so the published CLI bundle would carry
  the VizModel assembly. That is backwards: the CLI owns `field-lineage`, the viz
  is the newer consumer.
- Once the edge list is the interface, nothing about the traversal is
  workspace-index-dependent — which is the only thing that argued for
  `viz-backend`. `AGENTS.md`'s own rule applies directly: logic more than one
  consumer needs belongs in core.
- Core is already where the neighbouring pieces live: `qualifyField`,
  `resolveScopedEntityRef`, `canonicalRef`, `schemaLocalFieldPath`.
- Core has no Node built-in on its import path today and a `test:typecheck` gate to
  keep it that way, so `sl-prlp`'s "no Node built-in, asserted by a test over the
  module graph" is a smaller step there than anywhere else.

## Suggested sequencing for `sl-prlp`

1. Move `traceUpstream`/`traceDownstream` into core as one
   `traceFieldLineage(edges, start, { depth, direction })`. The 17 existing tests
   in `field-lineage.test.ts` pass unchanged; output stays byte-identical because
   the command still formats.
2. Move the edge builder behind `FieldEdgeSource`, and point **both**
   `graph-builder.ts` and `field-lineage.ts` at it. This is the step that deletes
   the duplication; do not stop after step 1.
3. Substitute `new URL()` for `index-builder.ts:439`'s `node:path` call — needed
   only if the builder's own dependencies follow it into core, and cheap either way.

Feature 41's R4 (`sl-jsyn`) and R5 (`sl-kwet`) aim at the function step 1 produces.
R4's oracle already exists — `scenarioAncestorsWithin` / `scenarioDescendantsWithin`
in `@satsuma/scenario-gen`, shipped early under `sl-dqyu` — so R4 becomes a test
file that calls one traversal, not a design exercise.
