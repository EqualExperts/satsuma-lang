---
id: tced-ewd4
status: open
deps: []
links: [sl-x9m1]
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
- `properPrefixesOf` cannot emit an empty prefix. A malformed path with a leading or doubled dot either normalises or raises an error naming the offending field, never a bare `TypeError`.
- A core test covers the top-level dotted `each` target directly, alongside the nested form the corpus already exercises. The satsuma-scenario-gen arbitraries should be able to produce the top-level dotted form so the property suites reach it too — if they cannot, say so and raise a follow-up rather than leaving the gap silent.
- A corpus example or fixture uses the top-level dotted form, so the shape is no longer unrepresented in `examples/`.

