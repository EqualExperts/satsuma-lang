---
id: sl-qead
status: closed
deps: []
links: [sqdsp-00kv]
created: 2026-08-02T21:41:14Z
type: bug
priority: 2
assignee: Thorben Louw
parent: sl-j6g9
tags: [feature-38, coverage, core, cli]
---
# coverage: a fragment spread that redeclares an explicit field counts the field twice

When a schema declares a field explicitly and also spreads a fragment declaring the same name, expansion emits two FieldCoverageEntry rows with the identical path. Both land in the denominator, and if the field is covered both land in the numerator, so the percentage depends on how many times a name is declared.

Minimal repro — three distinct leaves (id, load_ts, batch_id), two of them mapped:

  fragment meta { load_ts TIMESTAMPTZ  batch_id STRING(36) }
  schema s_d { id STRING(10)  load_ts TIMESTAMPTZ  ...meta }
  mapping ... { id -> id   load_ts -> load_ts }

  $ satsuma coverage dupspread.stm
    source  s_d  3/4  75%        <- should be 2/3, 67%

satsuma validate reports no issue. The duplicate is overstated coverage — the dangerous direction for --fail-under.

Present in the shipped corpus, not just contrived input: examples/namespaces/ns-platform.stm's vault::sat_contact_details declares load_ts at line 85 and spreads ...standard_metadata, which declares load_ts again. coverage --json lists load_ts twice in fields[] and reports 11 leaves where the schema has 10. Same in tooling/satsuma-cli/test/fixtures/platform.stm. A sweep of examples/ found no other case.

ADR-035 makes the qualified path a coverage entry's identity, so two entries sharing a path is a contract violation on its own terms: any consumer keying fields[] by path silently collapses them and then disagrees with the printed counts.

## Design

Two questions, and the second is the user's:

1. Coverage counting. expandDeclaredFields (satsuma-core/src/spread-expand.ts) should not emit a path already declared at that level. Explicit declaration wins over the spread, matching the intuition that a spread fills in what the body did not say. Dedupe there rather than in each consumer, so the CLI, LSP and viz all see one entry.

2. Language semantics. The v2 spec says nothing about a spread colliding with an explicit field — grep for 'duplicate'/'collision' in docs/developer/SATSUMA-V2-SPEC.md finds nothing on point. It could be an override (as above), an error, or a warning. Whatever is decided must be written into the spec, and a lint or validate diagnostic for a redeclared field is the natural companion, since today the author gets no signal at all. Note the corpus relies on the permissive reading: ns-platform.stm would emit a diagnostic on day one.

Coverage should be fixed to dedupe regardless of how the spec question lands — a duplicated path cannot be right under any reading.

## Acceptance Criteria

The minimal fixture above reports 2/3 (67%) from the CLI, the LSP path and the viz path. coverage --json never emits two fields[] entries with the same path, pinned by a test. examples/namespaces/ns-platform.stm reports vault::sat_contact_details with 10 leaves. The spec question is resolved and recorded in docs/developer/SATSUMA-V2-SPEC.md; if the ruling is that a redeclaration is a diagnostic, it is raised as a separate lint ticket rather than folded in here.


## Notes

**2026-08-03T06:12:43Z**

**2026-08-03T00:00:00Z**

Cause: core's `expandEntityFields` returned every field a fragment declared, including names the entity's own body had already declared, so `expandDeclaredFields` concatenated two entries with one path — inflating both the denominator and, for a mapped field, the numerator.
Fix: a spread now contributes only names the body has not claimed (explicit wins, first spread wins between spreads), seeded from the entity's own fields so the nested record form is covered by the same rule; the minimal fixture reports 2/3 67% and vault::sat_contact_details reports its true 10 leaves. (commit 92ce4b39)

Spec question resolved as **override** and recorded in docs/developer/SATSUMA-V2-SPEC.md §5.1 ("Redeclaring a spread field") plus AI-AGENT-REFERENCE.md: redeclaration stays legal, shadowing is whole-field, no diagnostic today. The author-facing warning is raised separately as sqdsp-00kv.
