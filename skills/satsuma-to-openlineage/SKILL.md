---
name: satsuma-to-openlineage
description: >
  Generate OpenLineage events from Satsuma (.stm) mapping specs. Use this skill whenever
  the user wants to export Satsuma lineage to OpenLineage, integrate Satsuma with Marquez
  or DataHub, generate OpenLineage JSON from .stm files, create lineage events for a data
  catalog, or bridge Satsuma specs into an OpenLineage-compatible lineage backend. Also
  trigger for requests like "export lineage to OpenLineage", "generate Marquez events",
  "create column-level lineage JSON", "integrate Satsuma with DataHub/Atlan/OpenMetadata",
  or "publish lineage from my mapping spec". Requires the `satsuma` CLI for structural
  extraction. Generates spec-compliant OpenLineage 2-0-2 RunEvents with standard and
  custom facets.
---

# Satsuma to OpenLineage

Generate OpenLineage-compliant RunEvent JSON from Satsuma mapping specs, including
column-level lineage, schema facets, documentation, governance, and data modelling
metadata.

## Core concept

Satsuma is a **design-time** specification — it describes what mappings *should* do.
OpenLineage is a **run-time** event model — it describes what jobs *did* do. This
skill bridges the gap by generating **synthetic COMPLETE events** that represent the
full structural lineage from the Satsuma spec. These events can be:

- Pushed to Marquez, DataHub, Atlan, or any OpenLineage-compatible backend
- Used as templates that a runtime integration (Airflow, Spark, dbt) decorates
  with actual run metadata (timestamps, durations, row counts)
- Consumed by data catalogs for design-time lineage before pipelines are built

## Prerequisites

- The `satsuma` CLI must be installed and on PATH.
- The user must provide one or more `.stm` files.

## Step 0: Extract structural context

```bash
# Full workspace graph — all nodes, edges, field-level flow
satsuma graph <file>.stm --json

# All warnings
satsuma warnings <file>.stm --json
```

The graph output gives you everything: schemas (→ Datasets), mappings (→ Jobs),
field-level edges (→ ColumnLineage), and transform classifications.

## Step 1: Ask the user essential questions

1. **Dataset namespace** — "What is the OpenLineage namespace for your datasets?
   This is typically derived from your data platform."
   Examples: `snowflake://account.snowflakecomputing.com`,
   `bigquery`, `postgres://host:5432/db`, `s3://bucket`.
   If schemas live on different platforms, ask for a namespace per source system.

2. **Job namespace** — "What is the namespace for your pipeline jobs?"
   Examples: `airflow://my-dag`, `dbt://project-name`, `satsuma://workspace`.
   Default: `satsuma://workspace` if the user doesn't have a scheduler yet.

3. **Dataset naming convention** — "How should dataset names be qualified?"
   Examples: `database.schema.table`, `schema.table`, `table`.
   If Satsuma schemas use namespaces, offer to use them:
   `namespace::schema` → `database.namespace.schema`.

4. **Output format** — "Should I generate:
   (a) Static JSON files (one per mapping) ready to POST to a backend,
   (b) A Python script using the OpenLineage Python client, or
   (c) A single JSON array of all events?"
   Default: (a) — one JSON file per mapping.

## Step 2: Map Satsuma entities to OpenLineage

### Satsuma schema → OpenLineage Dataset

Every schema becomes a Dataset with:
- `namespace`: from user input (step 1)
- `name`: schema name, qualified per convention (e.g., `raw.crm.customers`)
- `facets.schema`: SchemaDatasetFacet with fields and types
- `facets.documentation`: DocumentationDatasetFacet from `(note "...")`
- `facets.ownership`: OwnershipDatasetFacet from `(owner "...")` / `(steward "...")`
- `facets.satsuma_governance`: custom facet for PII, classification, retention, etc.
- `facets.satsuma_modelling`: custom facet for dimension/fact/hub/satellite tokens

### Satsuma mapping → OpenLineage Job + RunEvent

Every mapping becomes a Job, and we emit one synthetic COMPLETE RunEvent per mapping:
- `job.namespace`: from user input
- `job.name`: mapping name (e.g., `customer-migration`)
- `job.facets.documentation`: from mapping `note {}` blocks
- `job.facets.jobType`: processing type from merge tokens
- `inputs`: source schemas as InputDatasets
- `outputs`: target schema as OutputDataset with ColumnLineageDatasetFacet
- `run.runId`: a deterministic UUID v5 from the job namespace + name (reproducible)
- `run.facets`: empty (no actual run metadata for design-time events)

### Satsuma arrows → ColumnLineageDatasetFacet

Field-level arrows become column lineage entries on the **output** dataset:

```json
{
  "columnLineage": {
    "_producer": "https://github.com/EqualExperts/satsuma-lang",
    "_schemaURL": "https://openlineage.io/spec/facets/1-1-0/ColumnLineageDatasetFacet.json#/$defs/ColumnLineageDatasetFacet",
    "fields": {
      "customer_id": {
        "inputFields": [
          {
            "namespace": "snowflake://...",
            "name": "raw.crm.customers",
            "field": "CUST_ID"
          }
        ],
        "transformationDescription": "uuid_v5(\"namespace\", CUST_ID)",
        "transformationType": "INDIRECT"
      }
    }
  }
}
```

See `references/facet-mapping.md` for the complete mapping rules.

## Step 3: Generate events

For each Satsuma mapping, use the CLI to extract arrows:

```bash
satsuma mapping "<mapping-name>" --json
```

Then build the RunEvent. See `references/event-template.md` for the full
JSON structure.

### Transform classification → transformationType

| Satsuma classification | OpenLineage transformationType |
|---|---|
| `[none]` (direct copy) | `DIRECT` |
| `[nl]` (has transform body) | `INDIRECT` |
| `[nl-derived]` (inferred from @ref) | `INDIRECT` |

### Multi-source arrows

When an arrow has multiple source fields (`a, b -> target`), list all source
fields in the `inputFields` array:

```json
"full_name": {
  "inputFields": [
    { "namespace": "...", "name": "...", "field": "first_name" },
    { "namespace": "...", "name": "...", "field": "last_name" }
  ],
  "transformationDescription": "Concat first_name + ' ' + last_name",
  "transformationType": "INDIRECT"
}
```

### Computed fields (no source)

Fields with `-> target { ... }` (no left side) use an empty `inputFields` array
with a description:

```json
"ingest_timestamp": {
  "inputFields": [],
  "transformationDescription": "now_utc",
  "transformationType": "INDIRECT"
}
```

## Step 4: Handle governance metadata as custom facets

Satsuma governance tokens don't have standard OpenLineage facets, so emit them
as custom facets with the `satsuma_` prefix:

```json
{
  "satsuma_governance": {
    "_producer": "https://github.com/EqualExperts/satsuma-lang",
    "_schemaURL": "https://github.com/EqualExperts/satsuma-lang/blob/main/openlineage/SatsumaGovernanceDatasetFacet.json",
    "piiFields": ["email", "phone", "tax_id"],
    "classification": "RESTRICTED",
    "retention": "7y",
    "compliance": ["GDPR", "SOX"],
    "owner": "data-platform-team",
    "steward": "Jane Smith",
    "fieldClassifications": {
      "email": { "classification": "RESTRICTED", "retention": "3y",
                 "encrypt": "AES-256-GCM", "mask": "partial_email" }
    }
  }
}
```

## Step 5: Handle data modelling metadata as custom facets

```json
{
  "satsuma_modelling": {
    "_producer": "https://github.com/EqualExperts/satsuma-lang",
    "_schemaURL": "https://github.com/EqualExperts/satsuma-lang/blob/main/openlineage/SatsumaModellingDatasetFacet.json",
    "entityType": "dimension",
    "scdType": 2,
    "naturalKey": "customer_id",
    "trackedFields": ["email", "phone", "loyalty_tier"],
    "ignoredFields": ["last_login_channel"],
    "conformed": true
  }
}
```

For facts:
```json
{
  "satsuma_modelling": {
    "entityType": "fact",
    "grain": ["transaction_id", "line_number"],
    "dimensionRefs": [
      { "dimension": "dim_customer", "joinField": "customer_id" },
      { "dimension": "dim_product", "joinField": "sku" }
    ],
    "measures": {
      "quantity": "additive",
      "net_amount": "additive",
      "unit_price": "non_additive"
    }
  }
}
```

For Data Vault entities, use equivalent structure with `hub`, `satellite`, `link`.

## Step 6: Handle merge strategy as a job facet

```json
{
  "satsuma_mergeStrategy": {
    "_producer": "https://github.com/EqualExperts/satsuma-lang",
    "_schemaURL": "https://github.com/EqualExperts/satsuma-lang/blob/main/openlineage/SatsumaMergeStrategyJobFacet.json",
    "strategy": "upsert",
    "matchOn": ["customer_id"],
    "onMatch": "update",
    "onNoMatch": "insert"
  }
}
```

## Step 7: Handle consumer schemas

Satsuma `(report)` and `(model)` schemas are leaf-node consumers. They become
OutputDatasets on a synthetic "consumption" job, or can be emitted as standalone
datasets with documentation and ownership facets.

If a consumer has `(source {schema1, schema2})`, generate an additional synthetic
job that shows the consumption dependency:

```json
{
  "job": {
    "namespace": "satsuma://workspace",
    "name": "weekly_sales_dashboard",
    "facets": {
      "jobType": {
        "processingType": "BATCH",
        "integration": "SATSUMA",
        "jobType": "REPORT"
      }
    }
  },
  "inputs": [
    { "namespace": "...", "name": "fact_orders" },
    { "namespace": "...", "name": "dim_product" }
  ],
  "outputs": [
    {
      "namespace": "looker://instance",
      "name": "weekly_sales_dashboard",
      "facets": {
        "documentation": {
          "description": "Executive weekly sales overview"
        },
        "satsuma_consumer": {
          "consumerType": "report",
          "tool": "looker",
          "dashboardId": "retail-weekly-001",
          "refreshSchedule": "Monday 06:00 UTC"
        }
      }
    }
  ]
}
```

## Step 8: Validate and present

1. Validate every generated event against the OpenLineage 2-0-2 schema:
   - Required fields: `eventTime`, `producer`, `schemaURL`, `run.runId`
   - All facets have `_producer` and `_schemaURL`
   - `columnLineage` is on output datasets only
   - Dataset names use dot-qualified format
   - No duplicate runIds across events

2. Present the output files to the user with a summary:
   - Number of events generated
   - Number of datasets (input/output)
   - Number of jobs
   - Column-level lineage coverage (fields with lineage / total target fields)
   - Any NL transforms that produced `INDIRECT` lineage
   - Any governance metadata emitted as custom facets

## Important design decisions

**Why synthetic COMPLETE events?** OpenLineage requires at least a START and
COMPLETE event per run. For design-time lineage, we emit only COMPLETE events
with all metadata attached. This is the pattern used by dbt's OpenLineage
integration for static lineage. Backends like Marquez accept this gracefully.

**Why deterministic UUIDs?** Using UUID v5 with the job name as input means
re-running the generator produces the same runIds. This makes events idempotent —
re-emitting to a backend updates rather than duplicates.

**Why custom facets for governance?** OpenLineage has standard facets for schema,
documentation, ownership, and data source, but not for PII, classification,
retention, or data modelling tokens. Custom facets with the `satsuma_` prefix are
the spec-compliant way to carry this metadata. Backends that don't understand
them will ignore them safely; backends that do (or custom integrations) can use
them for governance dashboards.

**Mechanical columns**: For Kimball and Data Vault schemas, inferred columns
(surrogate keys, hash keys, validity timestamps) should be included in the
SchemaDatasetFacet — unlike in Satsuma files where they are omitted, OpenLineage
consumers expect the full physical schema. Add them based on the modelling tokens
and note their origin in the `satsuma_modelling` facet.
