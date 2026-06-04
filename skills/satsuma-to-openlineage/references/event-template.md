# OpenLineage Event Template

Use this template when generating RunEvent JSON from Satsuma mappings. Every
mapping produces one COMPLETE event.

## Full event structure

```json
{
  "eventTime": "2025-01-01T00:00:00.000Z",
  "eventType": "COMPLETE",
  "producer": "https://github.com/EqualExperts/satsuma-lang",
  "schemaURL": "https://openlineage.io/spec/2-0-2/OpenLineage.json#/$defs/RunEvent",
  "run": {
    "runId": "<deterministic-uuid-v5>",
    "facets": {}
  },
  "job": {
    "namespace": "<job-namespace>",
    "name": "<mapping-name>",
    "facets": {
      "documentation": {
        "_producer": "https://github.com/EqualExperts/satsuma-lang",
        "_schemaURL": "https://openlineage.io/spec/facets/1-1-0/DocumentationJobFacet.json#/$defs/DocumentationJobFacet",
        "description": "<mapping note text>"
      },
      "jobType": {
        "_producer": "https://github.com/EqualExperts/satsuma-lang",
        "_schemaURL": "https://openlineage.io/spec/facets/2-0-3/JobTypeJobFacet.json#/$defs/JobTypeJobFacet",
        "processingType": "BATCH",
        "integration": "SATSUMA",
        "jobType": "TASK"
      },
      "satsuma_mergeStrategy": {}
    }
  },
  "inputs": [
    {
      "namespace": "<dataset-namespace>",
      "name": "<source-schema-name>",
      "facets": {
        "schema": {},
        "documentation": {},
        "ownership": {},
        "satsuma_governance": {},
        "satsuma_modelling": {},
        "satsuma_warnings": {}
      }
    }
  ],
  "outputs": [
    {
      "namespace": "<dataset-namespace>",
      "name": "<target-schema-name>",
      "facets": {
        "schema": {},
        "columnLineage": {},
        "documentation": {},
        "ownership": {},
        "satsuma_governance": {},
        "satsuma_modelling": {},
        "satsuma_warnings": {}
      }
    }
  ]
}
```

## Field-by-field guide

### Required top-level fields

| Field | Value | Notes |
|---|---|---|
| `eventTime` | ISO 8601 timestamp | Use current time when generating, or a fixed timestamp for reproducibility |
| `eventType` | `"COMPLETE"` | Always COMPLETE for design-time lineage |
| `producer` | `"https://github.com/EqualExperts/satsuma-lang"` | Fixed |
| `schemaURL` | `"https://openlineage.io/spec/2-0-2/OpenLineage.json#/$defs/RunEvent"` | Current spec version |

### Run

| Field | Value | Notes |
|---|---|---|
| `run.runId` | UUID v5 | Generate deterministically from `uuid5(NAMESPACE_URL, job_namespace + "/" + job_name)` so re-runs produce the same ID |
| `run.facets` | `{}` | Empty for design-time events. Runtime integrations add `nominalTime`, `parent`, etc. |

### Job

| Field | Value | Notes |
|---|---|---|
| `job.namespace` | User-provided | e.g., `satsuma://workspace`, `airflow://my-dag` |
| `job.name` | Mapping name | Kebab-case: `customer-migration`, `sfdc-to-dim-customer` |

### Inputs (one per source schema)

Each source schema in the mapping's `source { }` block becomes one input dataset.

**Dataset naming**: Use dot-qualified names. If Satsuma uses namespaces, include them:
- `raw::crm_customers` → `raw.crm_customers`
- `customers` (no namespace) → use user's convention, e.g., `public.customers`

Include `schema` and `documentation` facets on every input. Include governance
and modelling facets only when the schema has relevant metadata.

### Outputs (one per target schema)

The mapping's `target { }` schema becomes the output dataset.

**Critical**: the `columnLineage` facet goes here and ONLY here. Never on inputs.

## Generating deterministic UUIDs

Python example for reproducible run IDs:

```python
import uuid

SATSUMA_NAMESPACE = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")  # URL namespace

def run_id(job_namespace: str, job_name: str) -> str:
    return str(uuid.uuid5(SATSUMA_NAMESPACE, f"{job_namespace}/{job_name}"))
```

This means:
- Same mapping → same runId every time
- Re-emitting to a backend replaces the event, not duplicates it
- Different mappings → different runIds

## Generating a Python emitter script

If the user requests option (b) from Step 1, generate a Python script using
the OpenLineage client:

```python
from openlineage.client import OpenLineageClient
from openlineage.client.run import (
    RunEvent, RunState, Run, Job, Dataset,
    InputDataset, OutputDataset
)
from openlineage.client.facet_v2 import (
    schema_dataset, column_lineage_dataset,
    documentation_dataset, documentation_job,
    ownership_dataset, job_type_job
)
import uuid
from datetime import datetime, timezone

client = OpenLineageClient.from_environment()

# ... generate events and emit with client.emit(event)
```

Note: the user needs `pip install openlineage-python` and environment variables
configured for their backend (e.g., `OPENLINEAGE_URL=http://localhost:5000`).

## Omitting empty facets

Do NOT include facets with no data. If a schema has no `(note "...")`, omit the
`documentation` facet entirely rather than emitting `{"description": ""}`.
Same for governance, modelling, warnings, etc.

## Multi-file workspaces

When a Satsuma workspace spans multiple `.stm` files with imports:
- Use the platform entry point (e.g., `platform.stm`) as the input to
  `satsuma graph --json` to get the complete workspace
- Schemas imported from other files are still separate Datasets
- The namespace of imported schemas follows the same rules as local ones
- Cross-file lineage is captured naturally through the graph output
