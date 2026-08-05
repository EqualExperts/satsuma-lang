# Roadmap

Open work items and ideas for Satsuma. Concrete items have PRD references; ideas are tracked here until they graduate to a feature spec.

Feature specs live in `features/` while active and move to `archive/features/` once delivered. A spec's own `Status:` line is authoritative for that feature; this page is the cross-feature view.

---

## Active Feature Specs

Features 36 and 40 are active, and Feature 44 is proposed but not yet started.
Everything numbered 01–35 plus Features 37, 38, 39, 41, 42, 43 and 45 has
shipped and is archived (see [Shipped Features](#shipped-features)).

### Feature 36 — Viz Coverage Overlay and Field Chain View (in progress)

A paint-only coverage overlay on the viz overview, uncovered-field treatment in cards and detail views, and a chain view rendering one field's full upstream/downstream lineage. Seven tickets under epic `sl-3de8`; three closed (`sl-jcs6` chain traversal model, `sl-5m9x` overlay toggle, `sl-4czz` chain view rendering), four open.

**Ready now:** `sl-twe8` (uncovered-field treatment) and `sl-iwlv` (VS Code webview wiring, unblocked now that `sl-4czz` has landed). `sl-1ml2` and `sl-nswc` remain; `sl-nswc` (the harness Playwright suite) still waits on both `sl-twe8` and `sl-iwlv`.

**Landed alongside `sl-4czz`:** neither core's field-lineage traversal nor the CLI's `field-lineage --json` carried any depth signal, so the chain view's "depth limit reached" affordance could not be shown honestly. Added an additive `depth` (per hop) and `maxDepth` (traversal cap) to the shared CLI/browser JSON contract.

**Deferred by decision:** public-playground exposure of coverage is out of scope and gets its own future feature (`sl-1ml2`).

**Source:** `features/36-viz-coverage-and-chain-view/PRD.md`

### Feature 44 — Token and Task-Completion Eval (proposed)

A pre-registered protocol replacing the site's "3-8x less token usage" and
"40-60% smaller" claims with measured, CI-bounded numbers. Arms compare `.xlsx`,
markdown, `.stm` alone, and `.stm` + CLI, all rendered mechanically from one
neutral `MappingIntent` record so the comparison is genuinely paired.

**Ready now:** nothing. The only unblocked ticket is the Feature 45 gate
(`sl-6ips`) — Feature 45 is implemented (all 9 `arpd-*` tickets closed) and
its measured baselines are in `reference/token-costs.md`, but the gate needs
that branch merged **and** released, not just implemented, so it stays open
until then. The Phase 0.5 probe epic (`sl-qz3v`) and its three children sit
behind it.

**Next step is deliberately cheap:** Phase 0.5 is a ~$8 hand-graded probe that
returns a directional effect size *before* the `MappingIntent` machinery, the
renderers, the graders and the pairing audit get built, with pre-committed kill
thresholds. If the effect is inside noise, the honest outcome is to correct the
site copy downward without running a full study.

**Open for the project owner:** the run no longer fits its $100 cap once the
markdown arm is included (~$118). Either drop the harness-invariance slice and run
markdown at two rungs (~$98), or raise the cap.

**Source:** `features/44-token-and-task-eval/PRD.md`

## Shipped Features

Delivered and moved to `archive/features/`. Recent work, most recent first:

| Feature | Shipped | What landed |
| --- | --- | --- |
| 45 — Progressive disclosure for the AI Agent Reference | 2026-08-05 (implemented; PR #492 pending merge/release — see gate `sl-6ips`) | Canonical `reference/*.md` sections composed at build time into three envelopes (CLI, the now-generated `AI-AGENT-REFERENCE.md`, and the new `satsuma-language` skill); `agent-reference --section/--profile/--list` with bare invocation byte-identical; every bytes/4 estimate replaced by measured `o200k_base` counts in `reference/token-costs.md`, including an MCP-tool-schema comparison point |
| 43 — Marketing site audit fixes | 2026-08-05 | All 11 `saf-*` tickets: dead links, stats drift, fabricated example snippets, self-contradictions, and a reframe of `vscode.njk` around workflows and `cli.njk` around agents. Deliberately left the unsubstantiated "3-8x"/"40-60%"/">90%" numbers for Feature 44 to measure |
| 42 — Monorepo build tooling | 2026-08-04 | npm workspaces behind one root lockfile, a Turborepo task graph whose build order is derived from the manifests rather than written down, and a persisted content-hash cache (ADR-049). CI 4m35s → 1m56s warm; the eleven packages' `prebuild`/`pretest` sibling-build chains and `scripts/build-workspace.sh` are gone |
| 39 — Correctness by default | 2026-08-04 | Generated CST contracts, opaque path/ref stages, generated coverage and formatter properties, an independent coverage oracle, enforced typecheck and type-aware lint gates, and structural `FieldDecl` variants |
| 38 — Hierarchical field coverage | 2026-08-03 | Path-correct nested coverage, container tri-state, whole-subtree arrow semantics, leaf-only ratios, and parity across the CLI, LSP, VS Code, and viz consumers (ADR-035–041) |
| 35 — Workspace coverage command | 2026-08-01 | `satsuma coverage` with per-mapping/per-schema/workspace rollups, a stable `--json` contract, and a `--fail-under` CI gate on exit code 3; `computeMappingCoverage` relocated into `@satsuma/core` |
| 34 — Live editor UX polish | 2026-06-10 | All eight R1–R8 fixes to the public playground chrome and edit-loop behaviour (ADR-029, ADR-030) |
| 33 — Live editor / "Try it Live!" | 2026-06-10 | The client-only browser playground (ADR-027, ADR-028) — see [below](#browser-playground--live-editor-shipped--feature-33) |
| 32 — Viz light mode | 2026-06-09 | Light and dark as first-class viz themes, driven by the VS Code colour theme, with one palette source of truth in `tokens.css` |
| 31 — Alignment with the EE brand | 2026-06-04 | Repository move to `EqualExperts/satsuma-lang`, EE named as maintainer, `assets/ee-brand/`, README and site brand touches |
| 30 — Viz test suite expansion | 2026-04-09 | Real-interaction Playwright coverage across viz fixture families, geometry sanity helpers, and a deterministic screenshot review workflow |

Two open tickets are follow-ups to archived features rather than outstanding scope: `f3vt-qb8u` (dense lineage layouts route edges through unrelated mapping cards — surfaced by Feature 30's suite, needs an edge-routing strategy decision) and `3cc-iedv` (whole-record arrow leaves nested leaves uncovered — a duplicate of the defect Feature 38's `sl-r6b0` fixes).

---

## Concrete Deferred Work

### Correctness Research Follow-ons (Feature 39)

Feature 39 deliberately left two research spikes outside its delivery gate:

- **Bounded consistency model:** time-box an Alloy or Z3 model of the settled
  ADR-034–041 coverage rules and report either a small counterexample or no
  counterexample within the stated bound.
- **Compositional semantics proposal:** propose a semantic domain and
  interpretation for multi-source joins, filtering, `each`, and `flatten`, then
  assess whether ADR-037, ADR-038, and ADR-041 can be derived from it.

**Why deferred:** Both investigations may improve confidence in the language's
semantic foundations, but neither is required for the compiler- and
test-enforced contracts Feature 39 delivered. They are intentionally
time-boxed research, not unfinished implementation.

**Source:** `archive/features/39-correctness-by-default/PRD.md` (Follow-on
Investigations)

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
