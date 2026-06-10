# How Do I...?

Quick answers to common questions about expressing patterns in Satsuma. Each links to a detailed guide.

---

## Getting Started

**How do I learn Satsuma from scratch?**
Start with the [BA Tutorial](docs/tutorials/ba-tutorial.md) or the [incremental lessons](lessons/README.md#suggested-reading-paths).

**How do I use Satsuma as a data engineer?**
Read the [Data Engineer Tutorial](docs/tutorials/data-engineer-tutorial.md) — covers using Satsuma specs with AI agents to generate pipeline scaffolds, data quality tests, sample data, and governance metadata.

**How do I use Satsuma as an integration engineer?**
Read the [Integration Engineer Tutorial](docs/tutorials/integration-engineer-tutorial.md) — covers using Satsuma for ESBs, APIs, message queues, and iPaaS platforms.

**How do I reverse-engineer a folder of legacy Excel mapping spreadsheets into Satsuma?**
Read the [Copilot + Excel reverse-engineering tutorial](docs/tutorials/copilot-excel-reverse-engineering-tutorial.md) — an end-to-end workflow for bootstrapping a fresh project in VS Code with GitHub Copilot agent mode, the Satsuma CLI, and the `excel-to-satsuma` skill.

**How do I look up the full syntax?**
Read the [language specification](docs/developer/SATSUMA-V2-SPEC.md). For a compact reference, see [AI-AGENT-REFERENCE.md](AI-AGENT-REFERENCE.md) or run `satsuma agent-reference`.

**How do I see working examples?**
Browse [examples/](examples/) — each scenario is a workspace subdirectory with one or more parser-validated `.stm` files.

**How do I try Satsuma without installing anything?**
Open the ["Try it Live!" playground](https://equalexperts.github.io/satsuma-lang/playground/) — a live editor in your browser with an interactive lineage visualization that updates as you type. Everything runs client-side; your source is never uploaded.

**How do I use Satsuma without the CLI?**
See [Using Satsuma Without CLI](docs/using-satsuma-without-cli.md) — Satsuma files are readable documentation even without tooling.

---

## Data Modelling

**How do I model a Kimball star schema?**
Use `(dimension)`, `(fact)`, `(grain)`, `(scd N)` tokens. Full guide with RetailCo examples: [docs/data-modelling/kimball/](docs/data-modelling/kimball/README.md)

**How do I model a Data Vault?**
Use `(hub)`, `(link)`, `(satellite)`, `(effectivity)` tokens. Full guide: [docs/data-modelling/datavault/](docs/data-modelling/datavault/README.md)

**How do I handle SCD Type 2 history?**
Use `(scd 2, natural_key <field>, track {fields})` on dimension or satellite schemas. See [Kimball conventions](docs/data-modelling/kimball/README.md#schema-level-tokens) or [Data Vault conventions](docs/data-modelling/datavault/README.md).

**How do I compare Kimball vs Data Vault for the same domain?**
Both example sets model the same RetailCo company. See the [comparison overview](docs/data-modelling/README.md#kimball-vs-data-vault-in-satsuma).

---

## Load Strategy

**How do I declare an upsert/merge strategy on a mapping?**
Use `(merge upsert, match_on <field>, on_match update, on_no_match insert)` on the mapping block. Guide: [Merge Strategy Conventions](docs/conventions-for-merge-strategy/README.md)

**How do I declare append-only loading (event streams)?**
Use `(merge append)` — no match logic needed. Guide: [Merge Strategy Conventions](docs/conventions-for-merge-strategy/README.md)

**How do I handle soft deletes?**
Use `(merge soft_delete, match_on <field>, delete_flag <field>, delete_timestamp <field>)`. Guide: [Merge Strategy Conventions](docs/conventions-for-merge-strategy/README.md)

**How do I declare a full refresh / truncate-and-reload?**
Use `(merge full_refresh)` with a `note { }` explaining why full refresh is acceptable. Guide: [Merge Strategy Conventions](docs/conventions-for-merge-strategy/README.md)

---

## Governance

**How do I mark fields as PII?**
Use `(pii)` on the field. Combine with `(classification confidential)` and `(mask <strategy>)` for full governance. Guide: [Governance Conventions](docs/conventions-for-governance/README.md)

**How do I declare data ownership and stewardship?**
Use `(owner "<team>", steward "<person>")` on the schema. Guide: [Governance Conventions](docs/conventions-for-governance/README.md)

**How do I set retention policies?**
Use `(retention years 7 after last_activity_date)` on the schema. Guide: [Governance Conventions](docs/conventions-for-governance/README.md)

**How do I declare compliance requirements (GDPR, HIPAA, etc.)?**
Use `(compliance {GDPR, CCPA, HIPAA})` on the schema. Guide: [Governance Conventions](docs/conventions-for-governance/README.md)

**How do I add org-specific governance tokens?**
Just use them — `( )` metadata accepts any vocabulary. Document your tokens in an org-specific token dictionary. Guide: [Governance Conventions](docs/conventions-for-governance/README.md)

---

## Schema Formats

**How do I represent XML sources with XPath?**
Use `(xpath "...")` on fields and records. See [examples/xml-to-parquet/pipeline.stm](examples/xml-to-parquet/pipeline.stm) for a full working example.

**How do I represent JSON API responses with JSONPath?**
Use `(format json)` on the schema and `(jsonpath "$.path")` on fields. Guide: [JSON Path Conventions](docs/conventions-for-schema-formats/json/conventions.md) | Example: [json-api-to-parquet/pipeline.stm](examples/json-api-to-parquet/pipeline.stm)

**How do I represent COBOL copybooks?**
Use `(format copybook, encoding ebcdic)` with `(pic, offset, length)` tokens. Guide: [docs/conventions-for-schema-formats/cobol-copybook/](docs/conventions-for-schema-formats/cobol-copybook/conventions.md)

**How do I represent HL7, X12/HIPAA, SWIFT, ISO 8583, or other industry formats?**
Each has a convention guide in [docs/conventions-for-schema-formats/](docs/conventions-for-schema-formats/README.md).

**How do I represent Protobuf or EDI sources?**
See [examples/protobuf-to-parquet/pipeline.stm](examples/protobuf-to-parquet/pipeline.stm) and [examples/edi-to-json/pipeline.stm](examples/edi-to-json/pipeline.stm).

---

## Reports and ML Models

**How do I declare a dashboard or report in Satsuma?**
Use `schema <name> (report, source {upstream_schemas}, tool <platform>)` with a `note { }` describing the report. Guide: [Reports and Models Conventions](docs/conventions-for-reports-and-models/README.md)

**How do I declare an ML model as a pipeline consumer?**
Use `schema <name> (model, source {upstream_schemas}, registry <platform>)` with feature descriptions and output fields. Guide: [Reports and Models Conventions](docs/conventions-for-reports-and-models/README.md)

**How do I trace lineage through reports and models?**
Reports and models declare `source {schemas}` — these appear as edges in `satsuma lineage`. They are leaf nodes in the lineage graph.

---

## Tooling

**How do I validate my Satsuma files?**
Run `satsuma validate pipeline.stm`. The CLI validates the entry file and its transitive imports. See [SATSUMA-CLI.md](SATSUMA-CLI.md).

**How do I trace data lineage?**
Run `satsuma lineage --from <schema> pipeline.stm`. For field-level edges: `satsuma arrows <schema.field>`.

**How do I lint my Satsuma files?**
Run `satsuma lint pipeline.stm`. Use `--fix` for auto-fixing. Use `--json` for CI integration.

**How do I format my Satsuma files?**
Run `satsuma fmt pipeline.stm` or use Format Document in VS Code.

**How do I get IDE support?**
Install the [VS Code extension](tooling/vscode-satsuma/) — it provides syntax highlighting, diagnostics, go-to-definition, completions, hover, rename, and more.

**How do I understand the tooling architecture?**
Read [ARCHITECTURE.md](docs/developer/ARCHITECTURE.md) — covers the package map, dependency graph, data flow (source text → parse → extraction → CLI/LSP), satsuma-core module structure, key type hierarchy, extension points, and test strategy. See [adrs/](adrs/) for the architectural decision records behind each design choice.

**How do I convert an Excel mapping spreadsheet to Satsuma?**
Use the [Excel-to-Satsuma skill](skills/excel-to-satsuma/) or the [lite system prompt](useful-prompts/excel-to-stm-prompt.md) for web LLMs.

**How do I generate an Excel workbook from a Satsuma file?**
Use the [satsuma-to-excel skill](skills/satsuma-to-excel/) or the [lite system prompt](useful-prompts/stm-to-excel-prompt.md) for web LLMs.

**How do I explain a `.stm` file to a non-technical stakeholder?**
Use the [satsuma-explainer skill](skills/satsuma-explainer/) — it produces plain-English walkthroughs, PII audits, coverage checks, and impact analysis from a Satsuma file or workspace.

**How do I reverse-engineer Satsuma from an existing dbt project?**
Use the [satsuma-from-dbt skill](skills/satsuma-from-dbt/) — it reads dbt models, sources, and lineage and emits idiomatic `.stm` mapping specs so you can adopt Satsuma without rewriting everything by hand.

**How do I scaffold a dbt project from a Satsuma spec?**
Use the [satsuma-to-dbt skill](skills/satsuma-to-dbt/) — it generates staging/marts, Kimball stars, Data Vault 2.0, and dbt exposures from `.stm` files, including governance metadata and merge strategies.

**How do I generate synthetic test data from a Satsuma schema?**
Use the [satsuma-sample-data skill](skills/satsuma-sample-data/) — it produces realistic CSV/JSON fixtures that respect types, enums, PII patterns, required fields, defaults, filters, and referential integrity across schemas.

**How do I export Satsuma lineage to OpenLineage / Marquez / DataHub / Atlan?**
Use the [satsuma-to-openlineage skill](skills/satsuma-to-openlineage/) — it emits OpenLineage JSON events with column-level lineage that any OpenLineage-compatible catalog can ingest.

**How do I extract all natural-language strings and find schema references missing @ref?**
Use the CLI to extract NL content and cross-reference it with known schema names. This is an agent workflow — give your AI agent these instructions:

```
1. Run `satsuma summary pipeline.stm` to get all schema names in the workspace.
2. Run `satsuma nl <mapping-name>` to extract all NL strings from a mapping.
3. For each NL string, check whether it mentions a schema name from step 1
   without an @ref prefix. If "loyalty_sfdc" appears as plain text in a
   NL transform instead of @loyalty_sfdc, flag it.
4. Suggest edits that add @ref so `satsuma lineage`
   and `satsuma where-used` can trace them.

Example: if a NL transform says:
  "Look up rate from currency rates using CurrencyIsoCode"
and `currency_rates` is a known schema, suggest changing it to:
  "Look up rate from @currency_rates using @CurrencyIsoCode"
```

This improves lineage tracing — `satsuma where-used` and `satsuma lineage` detect `@ref` references inside NL strings but cannot trace unquoted plain-text mentions.

---

## Metrics

**How do I define a business metric?**
Use a `schema` block with the `metric` vocabulary token in the metadata block. Optionally add `metric_name "Label"`, `grain`, `source`, `slice`, and `filter` tokens. Express the data pipeline feeding the metric as a separate `mapping` block. See [examples/metrics-platform/metrics.stm](examples/metrics-platform/metrics.stm) for patterns.

**How do I find where a metric is used?**
Run `satsuma where-used <metric-name>` or `satsuma metric <name>` for extraction. The `metric` command queries schemas decorated with the `metric` metadata token.

---

*All convention guides are complete. See [features/21-convention-docs/PRD.md](features/21-convention-docs/PRD.md) for the documentation plan.*
