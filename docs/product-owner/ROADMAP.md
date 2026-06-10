# Roadmap

Open work items and ideas for Satsuma. Concrete items have PRD references; ideas are tracked here until they graduate to a feature spec.

---

## Concrete Deferred Work

### Excel-to-Satsuma Full Skill (Feature 04, Phases 1-5)

The lite system prompt is authored and updated to v2 syntax at `useful-prompts/excel-to-stm-prompt.md`. The full skill — Python CLI tool (`excel_tool.py`), Claude Code skill prompt with survey/translate/critique phases, and end-to-end validation — is designed but not implemented.

**Why deferred:** The full skill is significant implementation effort. The lite prompt is available for immediate use; the full tooling should follow once the approach is validated.

**Source:** `features/04-excel-to-stm-skill/PRD.md` (Phases 1-5)

### Satsuma-to-Excel Export — CLI Command (Feature 05, Full Variant)

The lite system prompt and deterministic skill are complete (`useful-prompts/stm-to-excel-prompt.md`, `skills/satsuma-to-excel/`). The remaining work is a standalone `satsuma-to-excel` CLI command that doesn't require the skill wrapper — a direct `satsuma-to-excel input.stm -o output.xlsx` invocation.

**Why deferred:** The skill covers the primary use case. A standalone CLI command is a nice-to-have for CI/automation pipelines.

**Source:** `features/05-stm-to-excel-export/PRD.md` (Variant B: Full CLI Tool)

### VS Code Language Server — Lineage Visualization (Feature 16)

The LSP server is complete (Phases 1-3 delivered: semantic tokens, diagnostics, go-to-definition, find-references, completions, hover, rename, code lens, folding, document symbols). The remaining deferred item is an interactive lineage visualization webview powered by `satsuma graph`.

**Why deferred:** The core LSP features are shipped. Lineage visualization is a standalone enhancement that depends on webview infrastructure.

**Source:** `features/16-vscode-language-server/PRD.md`

### Data Modelling Tooling (Feature 06, Phases 2-3)

The Feature 06 convention spec and examples are complete. Future phases include:
- **Phase 2:** Linting rules that validate metadata token combinations (e.g., `hub` + `dimension` conflict)
- **Phase 3:** DDL/dbt model generation from convention-annotated schemas

**Why deferred:** These are tooling features that build on the convention spec. One validator bug remains (duplicate schema definitions across files cause false field-not-in-schema warnings — tracked as sl-5ms4). Once resolved, this tooling work can proceed.

**Source:** `features/06-data-modelling-with-stm/PRD.md` (Non-Goals section)

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
never uploaded. See [`features/33-live-editor/PRD.md`](../../features/33-live-editor/PRD.md),
ADR-027, and ADR-028.

---

## Convention Docs (Completed — Feature 21)

All convention documentation has been written. See [`features/21-convention-docs/PRD.md`](../../features/21-convention-docs/PRD.md) for the full plan.

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
