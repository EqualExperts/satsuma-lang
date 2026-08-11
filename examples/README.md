# examples

Canonical Satsuma v2 example corpus. Each scenario is a workspace subdirectory with one or more parser-validated `.stm` files.

The CLI requires a `.stm` file entry point (not a directory). The workspace is defined by the entry file plus its transitive imports. The **Entry file** column shows the file to pass to CLI commands like `satsuma validate`, `satsuma summary`, or `satsuma graph`.

## Scenarios

| Directory | Entry file | Description |
|-----------|------------|-------------|
| [`ancestor-escape/`](ancestor-escape/) | `pipeline.stm` | ADR-053 `^.`/`$.` escape prefixes referencing an ancestor field from inside a nested block |
| [`cobol-to-avro/`](cobol-to-avro/) | `pipeline.stm` | Mainframe COBOL customer master to Avro Kafka events |
| [`db-to-db/`](db-to-db/) | `pipeline.stm` | Legacy SQL Server to PostgreSQL customer migration (Project Phoenix) |
| [`edi-to-json/`](edi-to-json/) | `pipeline.stm` | EDI 856 ASN fixed-length messages to MFCS JSON for warehouse ingestion |
| [`filter-flatten-governance/`](filter-flatten-governance/) | `filter-flatten-governance.stm` | Scalar lists, filter/flatten, and governance metadata annotations |
| [`json-api-to-parquet/`](json-api-to-parquet/) | `pipeline.stm` | Commerce REST API order responses to Lakehouse Parquet |
| [`lineage-cycle/`](lineage-cycle/) | `pipeline.stm` | Two schemas mapped into each other in both directions — a demo fixture proving field-lineage tracing terminates on a cycle, not a plausible pipeline |
| [`merge-strategies/`](merge-strategies/) | `pipeline.stm` | All four merge strategies (upsert, append, soft delete, full refresh) |
| [`metrics-platform/`](metrics-platform/) | `metrics.stm` | Business metrics (MRR, CLV, churn, conversion) as schema blocks with `(metric, ...)` metadata |
| [`multi-hop-lineage/`](multi-hop-lineage/) | `pipeline.stm` | Artificial 7-schema, 6-hop chain with varying record nesting — a demo fixture for the field-chain viz, not a plausible pipeline |
| [`multi-source/`](multi-source/) | `multi-source-hub.stm` | Multi-source arrows, data hub, and three-way join patterns |
| [`namespaces/`](namespaces/) | `ns-platform.stm` | Namespace blocks, cross-namespace references, and namespace merging |
| [`nested-iteration/`](nested-iteration/) | `pipeline.stm` | Nested `each`/`flatten` sub-blocks mapping hierarchical dispatch events to a courier manifest |
| [`protobuf-to-parquet/`](protobuf-to-parquet/) | `pipeline.stm` | Protobuf Kafka commerce events to session-level Parquet |
| [`reports-and-models/`](reports-and-models/) | `pipeline.stm` | Reports, dashboards, and ML models as first-class pipeline consumers |
| [`sap-po-to-mfcs/`](sap-po-to-mfcs/) | `pipeline.stm` | SAP ERP purchase order to Oracle MFCS ingestion contract |
| [`seabird-colony-lineage/`](seabird-colony-lineage/) | `platform.stm` | Deeply nested field lineage and coverage across files and namespaces |
| [`top-level-dotted-each/`](top-level-dotted-each/) | `pipeline.stm` | Top-level `each` with a dotted header target — minimal fixture for tced-ninm |
| [`sfdc-to-snowflake/`](sfdc-to-snowflake/) | `pipeline.stm` | Salesforce Opportunity/Account objects to Snowflake analytics |
| [`xml-to-parquet/`](xml-to-parquet/) | `pipeline.stm` | Commerce order XML to Lakehouse Parquet |

## Shared resources

| Directory | Entry file | Description |
|-----------|------------|-------------|
| [`lib/`](lib/) | *(imported by other entry files)* | Reusable fragments and reference schemas (common, SFDC types) |
| [`lookups/`](lookups/) | `finance.stm` | Reference data lookup schemas (FX rates) |
