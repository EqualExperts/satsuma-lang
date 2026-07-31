# Feature 35 — Workspace Coverage Command (`satsuma coverage`)

> **Status: PROPOSED** (2026-07-31) — not yet started. Motivated by recurring
> engagements where mapping specs are reverse-engineered from spreadsheet
> workbooks and the first question every reviewer asks is "which fields are
> not mapped yet?". Today that question is answerable only inside VS Code
> (coverage gutter decorations) or by hand-composing multiple CLI calls.

## Goal

Give the CLI a first-class, deterministic coverage report: for every schema
participating in a mapping, which declared fields are referenced by at least
one arrow — per mapping, per schema, and rolled up across the workspace —
with a stable JSON contract that downstream consumers (dashboards,
satsuma-viz, CI pipelines, agents) can render without re-deriving the
semantics.

The primary success criteria are:

1. **One command answers the coverage question.** `satsuma coverage
   pipeline.stm` reports covered/uncovered fields for every mapping in the
   workspace without the caller composing `fields` + `arrows` + `mapping`
   round-trips.
2. **The computation lives in core, once.** `computeMappingCoverage` moves
   from the LSP into `@satsuma/core`; the LSP, the CLI, and satsuma-viz all
   consume the same function. No consumer re-implements coverage semantics.
3. **The JSON output is a documented, stable contract.** A dashboard or viz
   overlay can be built against `satsuma coverage --json` alone.
4. **Coverage can gate CI.** `--fail-under <pct>` turns spec completeness
   into a mergeable/unmergeable signal, the same way `fmt --check` gates
   formatting.

## Background

Coverage semantics are already implemented and tested — but split across the
wrong packages:

- `tooling/satsuma-core/src/coverage.ts` holds the shared types
  (`FieldCoverageEntry`, `SchemaCoverageResult`, `MappingCoverageResult`) and
  the `addPathAndPrefixes()` path utility. Its header comment states the
  higher-level function "lives in vscode-satsuma/server/src/coverage.ts" —
  this is stale twice over: the code has since moved to
  `tooling/satsuma-lsp/src/coverage.ts`, and the stated reason (LSP-specific
  `WorkspaceIndex`/`FieldInfo` types) is an argument for defining a core-level
  input contract, not for leaving the logic in a consumer.
- `tooling/satsuma-lsp/src/coverage.ts:41` — `computeMappingCoverage(uri,
  tree, mappingName, wsIndex)` walks a mapping body, collects covered
  source/target paths (arrows, `each` blocks, `flatten` blocks), and builds
  per-schema field coverage. Consumed only by the VS Code coverage command
  for gutter decorations.
- `tooling/satsuma-viz/src/field-coverage.ts` independently consumes
  `@satsuma/core/coverage-paths` (`buildCoveredFieldSet`) for mapping-detail
  rendering — a third consumer already orbiting the same semantics.
- `tooling/satsuma-cli/src/commands/fields.ts:89-103` — **the CLI already has a
  fourth implementation**. `satsuma fields <schema> --unmapped-by <mapping>`
  computes the per-mapping uncovered set via its own private
  `getMappedFieldNames()` + `filterUnmappedFields()` helpers, built on core's
  `addPathAndPrefixes`. It is documented at `SATSUMA-CLI.md:196` and
  `AI-AGENT-REFERENCE.md:329,391,409,441`. This is the single most important
  fact for this feature: unless `--unmapped-by` is re-based on the relocated
  core function (R2), shipping `coverage` creates two CLI commands answering
  the same question from independently maintained code — exactly the drift
  this feature exists to prevent.
- `SATSUMA-CLI.md` documents "coverage assessment" as a *composed agent
  workflow* (query target fields, query arrows per mapping, intersect results
  yourself). This is exactly the kind of deterministic, structure-only
  operation the CLI's design principle says belongs in the CLI.

Per the Core vs Consumer rule in `CLAUDE.md`, logic needed by a second
consumer must move to core — including its tests — as part of the ticket
work. This feature is that move, plus the thin command on top.

## Problems

### P1 — The coverage question has no *workspace-level* CLI answer

The CLI answers coverage for **one schema against one mapping**
(`fields <schema> --unmapped-by <mapping>`), and it gets the path-prefix
semantics right. What it cannot answer is the question reviewers actually
ask: *"across this whole workspace, which fields does no mapping populate?"*

An agent or script must therefore enumerate every mapping, call `fields
--unmapped-by` once per (schema, mapping) pair, and intersect the results
itself — the composed workflow documented at `AI-AGENT-REFERENCE.md:391`.
The per-call normalization is safe; the *aggregation* is what every caller
re-implements, and where they get it wrong (e.g. treating a field as
uncovered because mapping B ignores it, when mapping A populates it).

### P2 — The computation sits in a consumer package

`computeMappingCoverage` lives in `satsuma-lsp` and is exercised only through
the editor. The CLI cannot reach it (the LSP is not a CLI dependency), and
the browser-bundled viz component cannot either. The core module's own header
comment anticipates CLI sharing and is now factually wrong about where the
function lives.

### P3 — No machine-readable coverage contract exists

There is no JSON shape a dashboard, viz overlay, or report generator can
consume. Feature 36 (viz coverage overlay) is blocked on this: the overlay
must render the same numbers the CLI reports, or the two will drift.

### P4 — Spec completeness cannot gate CI

Teams converting large mapping workbooks iteratively have no way to enforce
"coverage must not regress" or "the target schema must be ≥ N% mapped before
sign-off" in a pipeline. `fmt --check` set the precedent for CI-gating exit
codes; coverage has no equivalent.

## Requirements

### R1 — Relocate `computeMappingCoverage` into `@satsuma/core` (fixes P2)

- Move the function and its private helpers from
  `tooling/satsuma-lsp/src/coverage.ts` into core, alongside the types it
  already returns.
- Define the input contract in core terms: the function needs a parse tree
  and a way to resolve schema definitions to field lists. Introduce a minimal
  core-level resolver interface (or reuse core's existing extraction types)
  so the function depends on neither the LSP's `WorkspaceIndex` nor the CLI's
  index — each consumer adapts its own index to the interface.
- The LSP keeps a thin adapter and re-exports so existing imports compile
  unchanged; the VS Code gutter behaviour must be byte-identical before and
  after.
- Move the coverage tests to core with the logic (per the test-consolidation
  standard: test each invariant once, at the right level). LSP-side tests
  shrink to adapter wiring only.
- Fix the stale header comment in `satsuma-core/src/coverage.ts`.

### R2 — `satsuma coverage [path]` command (fixes P1)

New command in `tooling/satsuma-cli/src/commands/coverage.ts`, following the
existing command-loader conventions:

- Default scope: every mapping in the workspace reachable from the entry
  file (imports followed, like other commands).
- Scoping flags: `--mapping <name>` (one mapping), `--schema <name>` (one
  schema across all mappings that reference it), `--role source|target`.
- `--uncovered` lists only unmapped fields — the review-queue view.
- Human output: a per-mapping table (schema, role, covered/total, %) followed
  by uncovered field paths; compact enough to paste into a review comment.
- `--json`: the full structure — per-mapping, per-schema, per-field entries
  (path, role, mapped, file, line where available from the CLI index).

**`fields --unmapped-by` is re-based, not removed.** The existing flag stays
as a convenience alias — it is documented, agent-facing, and the natural
single-schema shorthand — but its private `getMappedFieldNames()` /
`filterUnmappedFields()` helpers are deleted and it delegates to the
relocated core function. A test must assert that `fields Y --unmapped-by X`
and `coverage --uncovered --mapping X --schema Y` report the same field set
on one fixture, so the two surfaces cannot drift.

### R3 — Aggregation and rollups (fixes P1, P3)

- **Per-mapping**: covered/total per participating schema (this is R1's
  function, unchanged).
- **Per-schema across mappings**: a target field counts as covered when *any*
  mapping populates it; a source field counts as consumed when *any* mapping
  reads it. This matches the documented composed workflow ("intersect results
  to find fields unmapped by ALL mappings") and must be labelled as the
  aggregate view in output so it is not confused with per-mapping numbers.
- **Workspace totals**: overall percentage, plus per-namespace subtotals when
  namespaces are present.
- The JSON shape for all three levels is documented in `SATSUMA-CLI.md` and
  treated as a stable contract (consumed by Feature 36).

**Build order: the core aggregation function must not depend on the CLI
command.** Feature 36's browser-only coverage overlay consumes the aggregation
directly from `@satsuma/core`; if the core function is built behind the CLI
surface, the viz overlay is serialised behind CLI plumbing it never uses. The
core aggregation depends only on R1; the CLI's rendering of it depends on R2.

### R4 — CI gate via `--fail-under <pct>` (fixes P4)

- `satsuma coverage pipeline.stm --fail-under 90` exits non-zero when the
  workspace target-coverage percentage is below the threshold.
- Exit codes: `0` success/threshold met, `2` parse or filesystem error,
  `3` **threshold not met**. `1` keeps its established meaning (not found /
  no results) — `EXIT_NOT_FOUND` is already thrown for an unresolvable
  `--mapping` name (`fields.ts:98`).

  A distinct code is required, not cosmetic: if "threshold not met" also
  returned `1`, then `coverage --fail-under 90 --mapping "typo"` would exit
  `1` for a misspelled mapping name *and* `1` for genuine under-coverage. CI
  could not distinguish "the spec is incomplete" from "the build invocation
  is broken" — which defeats the purpose of the gate. `fmt --check` does not
  have this problem because it takes no scope arguments that can fail to
  resolve.
- Unresolvable scope arguments (`--mapping`, `--schema` naming something that
  does not exist) exit `1` as elsewhere in the CLI, and must never be
  reported as a coverage failure.
- `--fail-under` applies to target-role aggregate coverage by default;
  combined with `--role source` it gates source consumption instead.
- The coverage-specific exit codes are documented as their own table in
  `SATSUMA-CLI.md`, following the precedent already set for `fmt`
  (`SATSUMA-CLI.md:86`).

### R5 — Documentation and agent surface (fixes P3)

- Add the command to `SATSUMA-CLI.md` (extractors table + a coverage section
  with the JSON contract and the per-mapping vs aggregate distinction).
- Update `AI-AGENT-REFERENCE.md` / `agent-reference` output: the documented
  "coverage assessment" composed workflow is replaced by the single command,
  with the composed form retained only as an explanation of the semantics.

## Acceptance Tests

Minimal-snippet tests (per test quality standards), covering at least:

- A mapping covering a nested path (`address.city`) reports the parent
  (`address`) covered and a sibling (`address.line1`) uncovered.
- `each`/`flatten` block source paths contribute coverage exactly as the LSP
  behaviour does today (regression-locked by the relocated core tests).
- A target field populated by mapping A but not mapping B is uncovered in
  B's per-mapping report and covered in the schema-level aggregate.
- `fields Y --unmapped-by X` and `coverage --uncovered --mapping X --schema Y`
  report the identical field set (locks the two surfaces together).
- `--fail-under` exit codes: met → 0, not met → 3, parse error → 2,
  unresolvable `--mapping` → 1 (not mistaken for a coverage failure).
- `--json` output validates against the documented shape (golden fixture from
  an `examples/` workspace).
- LSP regression: existing coverage code-lens/gutter tests pass unchanged
  against the adapter.

## Out of Scope

- Any dashboard or visual rendering of coverage (Feature 36).
- Policy judgements about *acceptable* gaps — e.g. "fields tagged
  `(optional)` don't count against coverage". That is lint/policy territory
  (see Feature 37 and the lint framework) and must not be baked into the
  deterministic count. The JSON includes field metadata so policy layers can
  filter.
- ~~NL interpretation: a field populated "implicitly" by prose in a note block
  is uncovered by definition.~~ **Superseded by ADR-036** (implemented in
  `sl-qxyl`). The carve-out equated "follows a resolved `@ref`" with "interprets
  natural language", and those are different acts: the author wrote `@` as a
  sigil meaning *this is a reference*, and resolving it reads no surrounding
  prose. It also contradicted ADR-013, which every other lineage-aware command
  honoured. A resolved `@ref` now counts, as a distinct `nl` tier over the same
  denominator. A field prose merely *describes* without an `@ref` is still
  uncovered, and an unresolved `@ref` still counts for nothing — those remain
  `nl-refs` and `lint`'s territory.

## Open Questions

1. Should per-field entries carry declaration line numbers in CLI output?
   The core type has a `line` field set by the consumer; the CLI's index may
   need to start recording field positions to populate it (useful for
   editor-jump links in downstream UIs). YES

   **Resolved, and the work is smaller than stated.** The positions already
   exist: core's `FieldDecl` carries `startRow`/`startColumn`, "always set by
   `extractFieldTree`" (`satsuma-core/src/types.ts:113-127`, added by
   aa-65ni). The reason the CLI cannot see them is that
   `satsuma-cli/src/types.ts:37-45` keeps a *divergent structural copy* of
   `FieldDecl` that omits both fields. The task is therefore to delete the
   CLI's clone and re-export core's type — a Core vs Consumer violation in
   its own right — not to add position tracking.

   One case needs a decided answer rather than an accident: fields
   materialised by fragment-spread expansion (`spread-expand.ts`,
   `deepCopyFields`) have no declaration row of their own. They must either
   carry the spread site's position or report `line` as absent — never a
   silently-wrong `0`, which would send an editor-jump link to line 1 of the
   wrong file.
2. Aggregate source coverage: is "read by any mapping" the right default, or
   should unreferenced source fields be reported per-mapping only? Default
   proposed: aggregate both roles, clearly labelled. ACCEPT PROPOSAL
3. Does `--fail-under` belong on aggregate workspace coverage only, or also
   per-mapping (`--fail-under 90 --mapping "orders to warehouse"`)? Proposed:
   respect whatever scope flags are active. ACCEPT PROPOSAL
