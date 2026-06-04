# Facet Mapping Reference

Complete mapping from Satsuma metadata to OpenLineage facets.

## Standard OpenLineage Facets

These are defined by the OpenLineage spec and understood by all backends.

### SchemaDatasetFacet (on every dataset)

```json
{
  "schema": {
    "_producer": "https://github.com/EqualExperts/satsuma-lang",
    "_schemaURL": "https://openlineage.io/spec/facets/1-2-0/SchemaDatasetFacet.json#/$defs/SchemaDatasetFacet",
    "fields": [
      {
        "name": "customer_id",
        "type": "VARCHAR(50)",
        "description": "Durable business key"
      },
      {
        "name": "email",
        "type": "VARCHAR(255)",
        "description": "Customer email (PII)"
      }
    ]
  }
}
```

**Mapping rules:**
- Every Satsuma field → one entry in `fields`
- `type`: use the Satsuma type as-is (e.g., `VARCHAR(255)`, `INT`, `DECIMAL(12,2)`)
- `description`: from `(note "...")` on the field, or synthesised from metadata
  (e.g., "PII, encrypted with AES-256-GCM, required")
- For `record` fields (nested), flatten with dot notation: `customer.email`
- For `list_of` fields, note the type: `"type": "ARRAY<STRING>"`

**Mechanical columns for modelled schemas:**
Unlike Satsuma files, OpenLineage schemas should include inferred columns.
Add them based on modelling tokens:

| Modelling token | Columns to add |
|---|---|
| `(dimension, scd 2)` | `surrogate_key BIGINT`, `valid_from TIMESTAMPTZ`, `valid_to TIMESTAMPTZ`, `is_current BOOLEAN`, `row_hash CHAR(64)` |
| `(dimension, scd 1)` | None — natural key is the PK |
| `(fact)` | `etl_batch_id BIGINT`, `loaded_at TIMESTAMPTZ`, plus `{dim}_key BIGINT` per `ref` |
| `(hub)` | `{hub}_hk CHAR(64)`, `load_date TIMESTAMPTZ`, `record_source VARCHAR(100)` |
| `(satellite)` | `{parent}_hk CHAR(64)`, `load_date TIMESTAMPTZ`, `load_end_date TIMESTAMPTZ`, `hash_diff CHAR(64)`, `record_source VARCHAR(100)` |
| `(link)` | `{link}_hk CHAR(64)`, one `{hub}_hk CHAR(64)` per hub, `load_date TIMESTAMPTZ`, `record_source VARCHAR(100)` |

Mark these with `"description": "(inferred from Satsuma metadata)"`.

### ColumnLineageDatasetFacet (on output datasets only)

```json
{
  "columnLineage": {
    "_producer": "https://github.com/EqualExperts/satsuma-lang",
    "_schemaURL": "https://openlineage.io/spec/facets/1-1-0/ColumnLineageDatasetFacet.json#/$defs/ColumnLineageDatasetFacet",
    "fields": {
      "<target_field>": {
        "inputFields": [
          {
            "namespace": "<source_dataset_namespace>",
            "name": "<source_dataset_name>",
            "field": "<source_field_name>"
          }
        ],
        "transformationDescription": "<transform text or pipe chain>",
        "transformationType": "DIRECT | INDIRECT"
      }
    }
  }
}
```

**Mapping rules per arrow classification:**

| Satsuma arrow | transformationType | transformationDescription |
|---|---|---|
| `src -> tgt` (no transform) | `DIRECT` | empty or `"direct copy"` |
| `src -> tgt { trim \| lowercase }` | `INDIRECT` | `"trim \| lowercase"` |
| `src -> tgt { map { R: "retail", ... } }` | `INDIRECT` | `"value map: R→retail, B→business, ..."` |
| `src -> tgt { "NL description" }` | `INDIRECT` | the NL text verbatim |
| `-> tgt { now_utc }` | `INDIRECT` | `"now_utc"` (no inputFields) |
| `a, b -> tgt { "..." }` | `INDIRECT` | NL text; list both source fields |
| NL-derived (from @ref) | `INDIRECT` | `"(inferred from NL @ref)"` |

**Nested paths:**
Satsuma paths like `customer.email -> customer_email` should be flattened:
- Source field: `"customer.email"` (dot notation in the field name)
- Target field: `"customer_email"`

### DocumentationDatasetFacet / DocumentationJobFacet

```json
{
  "documentation": {
    "_producer": "https://github.com/EqualExperts/satsuma-lang",
    "_schemaURL": "https://openlineage.io/spec/facets/1-1-0/DocumentationDatasetFacet.json#/$defs/DocumentationDatasetFacet",
    "description": "Customer master — CRM system of record",
    "contentType": "text/markdown"
  }
}
```

**Source:** `(note "...")` on the schema or mapping, or `note {}` blocks.
For multi-line notes (triple-quoted), concatenate and set `contentType` to
`text/markdown`.

### OwnershipDatasetFacet

```json
{
  "ownership": {
    "_producer": "https://github.com/EqualExperts/satsuma-lang",
    "_schemaURL": "https://openlineage.io/spec/facets/1-0-1/OwnershipDatasetFacet.json#/$defs/OwnershipDatasetFacet",
    "owners": [
      { "name": "data-platform-team", "type": "TEAM" },
      { "name": "Jane Smith", "type": "PERSON" }
    ]
  }
}
```

**Source:** `(owner "team")` → type `TEAM`. `(steward "person")` → type `PERSON`.

### JobTypeJobFacet

```json
{
  "jobType": {
    "_producer": "https://github.com/EqualExperts/satsuma-lang",
    "_schemaURL": "https://openlineage.io/spec/facets/2-0-3/JobTypeJobFacet.json#/$defs/JobTypeJobFacet",
    "processingType": "BATCH",
    "integration": "SATSUMA",
    "jobType": "TASK"
  }
}
```

**Mapping from Satsuma:**
- `processingType`: always `BATCH` (Satsuma is batch-oriented)
- `integration`: always `SATSUMA`
- `jobType`: `TASK` for regular mappings, `REPORT` for consumer report schemas,
  `MODEL` for consumer model schemas

## Custom Satsuma Facets

These carry Satsuma-specific metadata that has no standard OpenLineage equivalent.
They use the `satsuma_` prefix per OpenLineage custom facet naming conventions.

### satsuma_governance (DatasetFacet)

Carries PII, classification, retention, compliance, and masking metadata.

```json
{
  "satsuma_governance": {
    "_producer": "https://github.com/EqualExperts/satsuma-lang",
    "_schemaURL": "https://github.com/EqualExperts/satsuma-lang/blob/main/openlineage/SatsumaGovernanceDatasetFacet.json",
    "classification": "RESTRICTED",
    "retention": "7y",
    "compliance": ["GDPR", "SOX"],
    "owner": "data-platform-team",
    "steward": "Jane Smith",
    "piiFields": ["email", "phone"],
    "fieldClassifications": {
      "email": {
        "pii": true,
        "classification": "RESTRICTED",
        "retention": "3y",
        "encrypt": "AES-256-GCM",
        "mask": "partial_email"
      },
      "phone": {
        "pii": true,
        "classification": "RESTRICTED"
      }
    }
  }
}
```

Only include keys that are present in the Satsuma spec. Omit keys with no data.

### satsuma_modelling (DatasetFacet)

Carries Kimball / Data Vault structural metadata.

**Kimball dimension:**
```json
{
  "satsuma_modelling": {
    "_producer": "...", "_schemaURL": "...",
    "entityType": "dimension",
    "conformed": true,
    "scdType": 2,
    "naturalKey": "customer_id",
    "trackedFields": ["email", "phone"],
    "ignoredFields": ["last_login_channel"],
    "inferredColumns": ["surrogate_key", "valid_from", "valid_to", "is_current", "row_hash"]
  }
}
```

**Kimball fact:**
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
    },
    "inferredColumns": ["dim_customer_key", "dim_product_key", "etl_batch_id", "loaded_at"]
  }
}
```

**Data Vault hub:**
```json
{
  "satsuma_modelling": {
    "entityType": "hub",
    "businessKey": "customer_id",
    "inferredColumns": ["hub_customer_hk", "load_date", "record_source"]
  }
}
```

### satsuma_mergeStrategy (JobFacet)

Carries merge / load strategy from Satsuma mapping metadata.

```json
{
  "satsuma_mergeStrategy": {
    "_producer": "...", "_schemaURL": "...",
    "strategy": "upsert",
    "matchOn": ["customer_id"],
    "onMatch": "update",
    "onNoMatch": "insert"
  }
}
```

Possible `strategy` values: `upsert`, `append`, `soft_delete`, `full_refresh`.
Include `deleteFlag` and `deleteTimestamp` for `soft_delete`.

### satsuma_consumer (DatasetFacet)

For report/model consumer schemas.

```json
{
  "satsuma_consumer": {
    "_producer": "...", "_schemaURL": "...",
    "consumerType": "report",
    "tool": "looker",
    "dashboardId": "retail-weekly-001",
    "refreshSchedule": "Monday 06:00 UTC"
  }
}
```

### satsuma_warnings (DatasetFacet or JobFacet)

Carries `//!` and `//?` comments from the Satsuma spec.

```json
{
  "satsuma_warnings": {
    "_producer": "...", "_schemaURL": "...",
    "warnings": [
      { "type": "data_quality", "message": "some records have NULL", "field": "CUST_TYPE" },
      { "type": "open_question", "message": "mixed formats", "field": "PHONE_NBR" }
    ]
  }
}
```
