---
id: tced-ewd4
status: closed
deps: []
links: [sl-x9m1, tced-vrul, tced-ninm]
created: 2026-08-07T11:24:58Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [core, cli, coverage]
---
# coverage: a top-level 'each list -> .target' crashes with 'Schema-local path must not be empty'

`satsuma coverage` throws and exits non-zero on any file whose mapping contains a **top-level** `each <list> -> .<target>` — an `each` block written at the mapping's own level, with a leading-dot target and no enclosing container:

```
$ satsuma coverage meridian-claims.stm
Unhandled error: Schema-local path must not be empty
```

Minimal repro:

```satsuma
schema src { id VARCHAR(10) (pk)  parties list_of record { party_role VARCHAR(20) (required) } }
schema tgt { k VARCHAR(10) (required)  rows list_of record { role VARCHAR(20) (required) } }
mapping m {
  source { src }  target { tgt }
  id -> k
  each parties -> .rows { .party_role -> .role { trim } }   // crashes
}
```

Writing `each parties -> rows` instead — same semantics, no leading dot — makes `coverage` work normally. Every other command is unaffected: `validate`, `lint`, `summary`, `graph`, `nl-refs`, `field-lineage` and `mapping` all succeed on the crashing file, so nothing in `run-repo-checks.sh` catches it.

## Why the corpus never hit it

`examples/` uses the leading-dot `each` target only *nested* inside another `each` (`examples/nested-iteration/pipeline.stm:93`, `examples/seabird-colony-lineage/observations.stm:29`). At mapping top level the corpus always writes a bare name (`examples/sap-po-to-mfcs/pipeline.stm:147`, `examples/edi-to-json/pipeline.stm:137`, `examples/cobol-to-avro/pipeline.stm:148`). The Feature 44 Phase 0.5 probe scenario (PR #518, `evals/phase-0.5-probe/scenario/meridian-claims.stm:177` and `:192`) is the first artifact in the repo to write the top-level form.

## Stack

```
TypeError: Schema-local path must not be empty
    at validatedReference        (@satsuma/core/src/reference-stages.ts:74:11)
    at createSchemaLocalPath     (@satsuma/core/src/reference-stages.ts:94:10)
    at properPrefixesOf          (@satsuma/core/src/coverage-paths.ts:125:19)
    at buildCoveredFieldPaths    (@satsuma/core/src/coverage-paths.ts:105:26)
    at coverageForSchema         (@satsuma/core/src/coverage.ts:787:17)
    at computeMappingCoverage    (@satsuma/core/src/coverage.ts:421:7)
    at coverageForMapping        (satsuma-cli/src/coverage-workspace.ts:135:41)
```

## Two defects, and the fix belongs to the first

**1. The schema-local path keeps its leading dot.** The target of a top-level `each parties -> .rows` reaches `buildCoveredFieldPaths` spelled `.rows`, not `rows`. A leading dot means "relative to the enclosing block's target"; at mapping top level the enclosing target *is* the mapping's target root, so it should normalise away. `schemaLocalFieldPath` (`coverage-paths.ts:200-227`) returns `createSchemaLocalPath(fieldRef)` with the dot intact when no schema prefix matches.

This is specific to the schema-local stage. Canonicalisation already gets it right — `satsuma graph --json` emits `::tgt.rows.role` for both the dotted and undotted forms — so the two stages currently disagree about the same arrow.

**2. `properPrefixesOf` turns a malformed path into an opaque crash.** For `.rows`, `path.split(".").slice(0, -1)` is `[""]`, so `prefix` stays `""` and `createSchemaLocalPath("")` throws. The `TypeError` carries no file, no line and no field name, and the CLI surfaces it as a bare `Unhandled error:` — the user has no way to tell which arrow caused it. Even after defect 1 is fixed, a path with a leading or doubled dot should not be able to produce this.

## Why it matters beyond the crash

Arm S+ of the Feature 44 eval is defined as language *plus* CLI, and `coverage` is the command that enumerates unmapped fields — exactly what a T5 ambiguity-detection episode would reach for. An S+ episode that runs it on the probe scenario gets an unexplained crash and burns a repair loop, and those tokens are charged to the representation rather than to the tool. This should be fixed, or the probe scenario changed to the undotted form, before `sl-x9m1` runs its episodes.

## Acceptance Criteria

- `satsuma coverage` completes normally on a mapping containing a top-level `each <list> -> .<target>`, and reports the same coverage as the equivalent undotted `each <list> -> <target>` spelling — the two are semantically identical and must not differ.
- The schema-local path recorded for such a target has no leading dot, so the schema-local and canonical stages agree on the same arrow.
- A core test covers the top-level dotted `each` target directly, alongside the nested form the corpus already exercises.
- The two pinned tests asserting the old behaviour — in `satsuma-core` and in `satsuma-viz` — are converted from pins of the preserved dot into assertions of the resolved path, each carrying the reason it reversed.
- The scenario-gen gap that let this escape the property suites is filed rather than left unstated (tced-vrul).


## Notes

**2026-08-07T11:35:37Z**

Cause: qualifyChildArrowPath returned a mapping-body-level path untouched, leading dot and all — a deliberate, tested choice on the reasoning that a top-level dot is a typo best left matching nothing. It contradicted spec §4.6 ('a leading `.` documents the relativity, but it does not decide it'), and left coverage the only consumer holding that view: arrows, graph and field-lineage all resolved `each parties -> .rows` to tgt.rows already. The preserved dot then reached properPrefixesOf, whose empty first segment cannot be branded a SchemaLocalPath, so the command died rather than reporting the 'uncovered' the old behaviour intended.
Fix: strip the relativity marker at every frame including the mapping root, so coverage shares one path identity with lineage (ADR-035). Reversed the two tests that pinned the old behaviour (satsuma-core arrow-records, satsuma-viz field-coverage), corrected the buildCoveredFieldPaths comment that called the empty-ancestor case harmless and unreachable when it was neither, and added a core test asserting the dotted and undotted spellings produce identical coverage. The viz reads the same core rule, so its coverage lookups and hover highlighting pick the shape up too. Scenario-gen cannot generate a dotted block header at all, which is why no property suite caught this — filed as tced-vrul. (commit immediately after 036a518a)
