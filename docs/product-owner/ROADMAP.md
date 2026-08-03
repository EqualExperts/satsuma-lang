# Roadmap

Open work items and ideas for Satsuma. Concrete items have PRD references; ideas are tracked here until they graduate to a feature spec.

Feature specs live in `features/` while active and move to `archive/features/` once delivered. A spec's own `Status:` line is authoritative for that feature; this page is the cross-feature view.

---

## Active Feature Specs

The four specs currently in `features/`. Everything numbered 01–35 has shipped and is archived (see [Shipped Features](#shipped-features)).

### Feature 38 — Hierarchical Field Coverage (in flight)

Makes field coverage correct and single-definition for nested records, lists of records, and schemas that reuse field names across depths, so a coverage percentage can be trusted as a merge gate. Four of nine tickets are closed (epic `sl-j6g9`).

**Remaining:** `sl-0pun` (container tri-state: covered / partial / uncovered) and `sl-r6b0` (whole-subtree arrow coverage) are both unblocked and ready; then `sl-hcan` (the viz card counts containers in its ratio, disagreeing with `satsuma coverage`) and `sl-5nsv` (cross-consumer parity tests, including fragment-spread expansion).

**Why it matters most:** until this lands, `--fail-under` can fail a fully-mapped spec — the repo's own canonical nested example reports 75% when it is 100% mapped.

**Source:** `features/38-hierarchical-coverage/PRD.md`

### Feature 36 — Viz Coverage Overlay and Field Chain View (not started)

A paint-only coverage overlay on the viz overview, uncovered-field treatment in cards and detail views, and a chain view rendering one field's full upstream/downstream lineage. Eight tickets, none started (epic `sl-3de8`).

**Ready now:** its core dependencies (`sl-gsxu`, `sl-4qvp`) shipped with Feature 35, so `sl-jcs6` (chain traversal model) and `sl-5m9x` (overlay toggle) can both start. `sl-4czz`, `sl-twe8`, `sl-iwlv`, and `sl-nswc` follow from those.

**Prerequisite worth pulling in:** `3cdd-yavi` — viz-backend does not qualify relative child-arrow paths against their container, so coverage lookups and edge ports silently drop every relative-path arrow. That directly undermines the overlay.

**Deferred by decision:** public-playground exposure of coverage is out of scope and gets its own future feature (`sl-1ml2`).

**Source:** `features/36-viz-coverage-and-chain-view/PRD.md`

### Feature 37 — Structural Lint Rules (not started)

Two warning-severity lint rules — `type-mismatch-direct-arrow` (bare arrows between fields of different declared types) and `lineage-cycle` (schema-level cycles) — plus a `satsuma.config.yaml` loader for type aliases, rule suppression, and strict mode. Six tickets, none started (epic `sl-iffm`). Independent of Features 36 and 38.

**Sequencing:** `sl-npi6` (the config loader) gates everything else — `sl-j30s`, `sl-hysg`, `sl-1u6r`, then `sl-ay8a` for docs.

**Breaking change to plan for:** lint gets its own documented exit-code table (0/1/2/3). It currently returns `2` for error findings where `2` is documented as "parse error", so CI consumers keying on today's codes will need to change.

**Recorded decision this rule must honour:** self-mappings (same source and target schema) are legitimate — they represent increments — and do not count as cycles. See the note at the foot of this page.

**Source:** `features/37-lint-structural-rules/PRD.md`

### Feature 39 — Correctness by Default (proposed, no tickets yet)

Moves the invariants this toolchain documents in prose into the build: node-kind types generated from `node-types.json` so a grammar rename cannot silently change behaviour, branded path and ref types so `sl-joeq`'s name-for-path confusion is unrepresentable, generated-input properties for the ADR-034–041 coverage rules, a naive reference model to differentially test against, and type-aware linting across the four packages that currently have none.

**Why it matters:** the recent defect clusters were *specification* defects — `sl-joeq`, `sl-qead` (which forced ADR-041 to amend ADR-035), ADR-038 constraining ADR-037 — where the code correctly implemented a rule that was wrong or absent, and a green suite said so. Feature 38 is deciding what those rules should be; this feature makes them machine-checked so they cannot quietly stop holding.

**Ready now:** R1 (generated node-kind types) is small, mechanical, blocks two other requirements, and touches nothing Feature 38 is changing. R5 and the R6 lint rollout follow.

**Sequenced behind Feature 38:** R2, R3 and R4 touch `coverage.ts` and `coverage-paths.ts`, which `sl-0pun` and `sl-r6b0` are still changing; the two spikes (R7 rule-consistency model, R8 denotational spec section) wait for epic `sl-j6g9` to close.

**Source:** `features/39-correctness-by-default/PRD.md`

---

## Shipped Features

Delivered and moved to `archive/features/`. Recent work, most recent first:

| Feature | Shipped | What landed |
| --- | --- | --- |
| 35 — Workspace coverage command | 2026-08-01 | `satsuma coverage` with per-mapping/per-schema/workspace rollups, a stable `--json` contract, and a `--fail-under` CI gate on exit code 3; `computeMappingCoverage` relocated into `@satsuma/core` |
| 34 — Live editor UX polish | 2026-06-10 | All eight R1–R8 fixes to the public playground chrome and edit-loop behaviour (ADR-029, ADR-030) |
| 33 — Live editor / "Try it Live!" | 2026-06-10 | The client-only browser playground (ADR-027, ADR-028) — see [below](#browser-playground--live-editor-shipped--feature-33) |
| 32 — Viz light mode | 2026-06-09 | Light and dark as first-class viz themes, driven by the VS Code colour theme, with one palette source of truth in `tokens.css` |
| 31 — Alignment with the EE brand | 2026-06-04 | Repository move to `EqualExperts/satsuma-lang`, EE named as maintainer, `assets/ee-brand/`, README and site brand touches |
| 30 — Viz test suite expansion | 2026-04-09 | Real-interaction Playwright coverage across viz fixture families, geometry sanity helpers, and a deterministic screenshot review workflow |

Two open tickets are follow-ups to archived features rather than outstanding scope: `f3vt-qb8u` (dense lineage layouts route edges through unrelated mapping cards — surfaced by Feature 30's suite, needs an edge-routing strategy decision) and `3cc-iedv` (whole-record arrow leaves nested leaves uncovered — a duplicate of the defect Feature 38's `sl-r6b0` fixes).

---

## Concrete Deferred Work

### Excel-to-Satsuma Full Skill (Feature 04, Phases 1-5)

The lite system prompt is authored and updated to v2 syntax at `useful-prompts/excel-to-stm-prompt.md`. The full skill — Python CLI tool (`excel_tool.py`), Claude Code skill prompt with survey/translate/critique phases, and end-to-end validation — is designed but not implemented.

**Why deferred:** The full skill is significant implementation effort. The lite prompt is available for immediate use; the full tooling should follow once the approach is validated.

**Source:** `archive/features/04-excel-to-stm-skill/PRD.md` (Phases 1-5)

### Satsuma-to-Excel Export — CLI Command (Feature 05, Full Variant)

The lite system prompt and deterministic skill are complete (`useful-prompts/stm-to-excel-prompt.md`, `skills/satsuma-to-excel/`). The remaining work is a standalone `satsuma-to-excel` CLI command that doesn't require the skill wrapper — a direct `satsuma-to-excel input.stm -o output.xlsx` invocation.

**Why deferred:** The skill covers the primary use case. A standalone CLI command is a nice-to-have for CI/automation pipelines.

**Source:** `archive/features/05-stm-to-excel-export/PRD.md` (Variant B: Full CLI Tool)

### VS Code Language Server — Lineage Visualization (Feature 16)

The LSP server is complete (Phases 1-3 delivered: semantic tokens, diagnostics, go-to-definition, find-references, completions, hover, rename, code lens, folding, document symbols). The remaining deferred item is an interactive lineage visualization webview powered by `satsuma graph`.

**Why deferred:** The core LSP features are shipped. Lineage visualization is a standalone enhancement that depends on webview infrastructure.

**Source:** `archive/features/16-vscode-language-server/PRD.md`

### Data Modelling Tooling (Feature 06, Phases 2-3)

The Feature 06 convention spec and examples are complete. Future phases include:
- **Phase 2:** Linting rules that validate metadata token combinations (e.g., `hub` + `dimension` conflict)
- **Phase 3:** DDL/dbt model generation from convention-annotated schemas

**Why deferred:** These are tooling features that build on the convention spec. One validator bug remains (duplicate schema definitions across files cause false field-not-in-schema warnings — tracked as sl-5ms4). Once resolved, this tooling work can proceed.

**Source:** `archive/features/06-data-modelling-with-stm/PRD.md` (Non-Goals section)

---

## Ideas

### External Schema Import (DBML, Protobuf, Avro, JSON Schema ...)

The grammar doesn't need to understand every schema language. We just need a clean way to say "this structure is defined over there, bring it in."

```satsuma
// Pull in a DBML file -- the tooling resolves it to Satsuma-equivalent fields
schema crm_database (from dbml "schemas/crm.dbml", table "customers") {}

// Same idea for Avro, Protobuf, JSON Schema
schema events (from avro "schemas/clickstream.avsc") {}
schema warehouse (from protobuf "protos/warehouse.proto", message "OrderRow") {}
schema api_payload (from json-schema "schemas/order-response.json") {}

// You can still override or annotate individual fields after import
schema crm_database (from dbml "schemas/crm.dbml", table "customers") {
  email  STRING  (pii)              // add metadata the DBML didn't have
  phone  STRING  (pii, format E.164)
}
```

**Why metadata tokens and not a grammar extension:** The DBML/Avro/etc. parsers live in external tooling. Satsuma just needs to say "resolve this" and then the AST looks identical to a hand-written schema block. An LLM interpreter can read the referenced file and inline the fields.

---

## Browser Playground / Live Editor (Shipped — Feature 33)

The "Try it Live!" playground is live on the website at `/playground/`: a
server-free, in-browser live editor where visitors edit Satsuma source (or
open a local `.stm` file) and watch the visualization re-render as they type.
Parsing, model building, and persistence are entirely client-side — source is
never uploaded. See [`archive/features/33-live-editor/PRD.md`](../../archive/features/33-live-editor/PRD.md),
ADR-027, and ADR-028.

---

## Convention Docs (Completed — Feature 21)

All convention documentation has been written. See [`archive/features/21-convention-docs/PRD.md`](../../archive/features/21-convention-docs/PRD.md) for the full plan.

- **Merge / upsert strategy** — [`docs/conventions-for-merge-strategy/`](../conventions-for-merge-strategy/README.md) with canonical example [`examples/merge-strategies/pipeline.stm`](../../examples/merge-strategies/pipeline.stm)
- **Governance tags** — [`docs/conventions-for-governance/`](../conventions-for-governance/README.md) with canonical example [`examples/filter-flatten-governance/governance.stm`](../../examples/filter-flatten-governance/governance.stm)
- **JSON path** — [`docs/conventions-for-schema-formats/json/`](../conventions-for-schema-formats/json/conventions.md) with canonical example [`examples/json-api-to-parquet/pipeline.stm`](../../examples/json-api-to-parquet/pipeline.stm)
- **Reports and ML models** — [`docs/conventions-for-reports-and-models/`](../conventions-for-reports-and-models/README.md) with canonical example [`examples/reports-and-models/pipeline.stm`](../../examples/reports-and-models/pipeline.stm)
- **Data Engineer Tutorial** — [`docs/tutorials/data-engineer-tutorial.md`](../tutorials/data-engineer-tutorial.md)
- **Integration Engineer Tutorial** — [`docs/tutorials/integration-engineer-tutorial.md`](../tutorials/integration-engineer-tutorial.md)

---

## Design Principles

These principles guide all future syntax and convention decisions:

- **Stay declarative and BA-friendly** — describe *what*, not *how*.
- **Lean on existing constructs** — `(metadata)` tokens, bare `"NL strings"` in `{ }`, `note { }` blocks, and vocabulary conventions — before inventing new keywords.
- **Natural language is the escape hatch** — for anything too complex or domain-specific to express in a piped transform chain, write intent in English and let the interpreter figure it out.
- **Vocabulary tokens are the extension mechanism** — new semantics come from *convention* (token dictionaries) and *tooling* (linters, interpreters), not grammar changes.
- **High bar for new keywords** — "Is this concept so fundamentally different from schema/fragment/mapping that using an existing keyword would confuse a BA reading the file?"

---

Better field level lineage commands 

Split satsuma into

satsuma field-lineage --from --to in_filename.stm 
satsuma schema-lineage considers any mappings that use the schema as a source or target




lieage anchor point is fully qualified field (or list subfield) lilke ns::schema.field.record.list.subfield

If a simpler form is given we should try to resolve if it is unabiguoug is is OK (s.f or f) and if there si ONLY 1 possible resolution that is fine use it, but if ambiguous error

Need MUCH better docs for the options in subcommands!

ALL stm subcommands should operate on an entry-point FILE rather than a folder -- people can have project files that  just import all the relative bits they need

file-level commands all DO follow imports to bring in context 

imports can include ../../ paths (outside current dir)

---
self-mappings (same source and target schema) are OK -- we can use that to represent things like increments, and DON'T cause graph cycles.
