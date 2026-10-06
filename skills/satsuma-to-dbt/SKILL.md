---
name: satsuma-to-dbt
description: >
  Generate idiomatic dbt project scaffolds from Satsuma (.stm) mapping specs. Use this
  skill whenever the user wants to create a dbt project from Satsuma, generate dbt models
  from .stm files, scaffold a dbt pipeline from a mapping spec, or convert Satsuma to dbt.
  Also trigger for requests like "generate dbt from this spec", "create staging and mart
  models from this mapping", "scaffold a dbt project for this Satsuma file", or "turn my
  .stm into dbt SQL". Handles Kimball star schemas, Data Vault 2.0, merge strategies,
  governance metadata, and consumer schemas (reports/models → dbt exposures). Requires
  the `satsuma` CLI for structural extraction. Generates dbt projects that use {{ ref() }}
  and {{ source() }} throughout — never hardcoded table names.
---

# Satsuma to dbt Project

Generate a complete, idiomatic dbt project scaffold from Satsuma mapping specs.

## Prerequisites

- The `satsuma` CLI must be installed and on PATH.
- The user must provide one or more `.stm` files.

## Step 0: Extract structural context

Before asking the user anything, use the CLI to understand the workspace:

```bash
# Workspace overview
satsuma summary <file>.stm --json

# Full graph for topology
satsuma graph <file>.stm --json

# All warnings
satsuma warnings <file>.stm --json

# Check for data modelling tokens
satsuma find --tag dimension --json 2>/dev/null
satsuma find --tag fact --json 2>/dev/null
satsuma find --tag hub --json 2>/dev/null
satsuma find --tag satellite --json 2>/dev/null
satsuma find --tag report --json 2>/dev/null
satsuma find --tag model --json 2>/dev/null
```

From the graph output, identify:
- Which schemas are **sources** (appear only on the left side of mappings)
- Which schemas are **targets** (appear on the right side)
- Which schemas are **intermediate** (both source and target)
- Which schemas are **consumers** (report/model metadata)
- The data modelling approach (Kimball, Data Vault, or flat)
- Any merge strategy tokens on mappings

## Step 1: Ask the user essential questions

Present these questions — they directly affect the generated code:

1. **Target warehouse** — "Which data warehouse will this run on?"
   Options: Snowflake, BigQuery, Redshift, Databricks, PostgreSQL, DuckDB.
   This determines SQL dialect, function names, and type mappings. See
   `references/dialect-map.md`.

2. **Source connection details** — "What are your dbt source database and schema
   names? For example, in Snowflake this might be `raw_database.crm_schema`."
   Show the source schemas found in the spec and ask the user to provide
   `database.schema` for each. These go into `sources.yml`.

3. **dbt project conventions** — "Do you use a layered model structure?"
   Options: staging → marts (default), staging → intermediate → marts,
   raw → staging → warehouse, custom. Map layers to directory structure.

4. **Test generation** — "Should I generate dbt tests from the spec's metadata?"
   Options: Yes (recommended), No, Only schema tests (skip custom).
   Explain: "The spec has metadata like `(required)`, `(enum {...})`, and `(pii)`
   that I can convert to `not_null`, `accepted_values`, and meta tags."

5. **NL transform handling** — "For natural-language transforms that I can't
   convert to SQL automatically, should I: (a) generate TODO stubs with the NL
   text as comments, or (b) attempt a best-effort SQL translation with a
   review-needed marker?"
   Default: (b) — attempt translation but mark clearly.

Do NOT ask about naming conventions — infer them from the Satsuma spec
(source schemas keep their names; targets use their Satsuma names prefixed
with the appropriate layer prefix like `stg_`, `int_`, `dim_`, `fact_`).

## Step 2: Generate dbt project structure

Create the project scaffold:

```
<project_name>/
├── dbt_project.yml
├── packages.yml          # if dbt_utils or dbt_vault needed
├── models/
│   ├── staging/
│   │   ├── <source_system>/
│   │   │   ├── _<source_system>__sources.yml
│   │   │   ├── _<source_system>__models.yml
│   │   │   └── stg_<source>__<table>.sql
│   ├── intermediate/     # only if user chose this layer
│   │   └── int_<description>.sql
│   └── marts/
│       ├── <domain>/
│       │   ├── _<domain>__models.yml
│       │   ├── dim_<name>.sql / fact_<name>.sql
│       │   └── ...
│       └── ...
├── snapshots/            # only if SCD 2 dimensions exist
│   └── snp_<dim_name>.sql
├── tests/                # only if custom tests needed
│   └── ...
└── exposures/            # only if report/model schemas exist
    └── _exposures.yml
```

## Step 3: Generate sources.yml

Every Satsuma schema that appears only as a mapping source (never as a target)
becomes a dbt source.

```yaml
# models/staging/<source_system>/_<source_system>__sources.yml
version: 2
sources:
  - name: <source_system>          # from user input
    database: <database>           # from user input
    schema: <schema>               # from user input
    tables:
      - name: <satsuma_schema_name>
        description: >             # from schema (note "...")
        columns:                   # from satsuma fields
          - name: <field_name>
            description: <note>
            data_type: <type>      # mapped via dialect-map
            meta:                  # from satsuma metadata
              pii: true            # if (pii)
              classification: X    # if (classification "X")
            tests:                 # from satsuma metadata
              - not_null           # if (required)
              - unique             # if (unique)
              - accepted_values:   # if (enum {a, b, c})
                  values: [a, b, c]
```

## Step 4: Generate staging models

One staging model per source table. Staging models do minimal cleaning — they
are the first `{{ source() }}` reference point.

```sql
-- models/staging/<sys>/stg_<sys>__<table>.sql
with source as (
    select * from {{ source('<source_name>', '<table_name>') }}
),

renamed as (
    select
        -- map source columns to clean names
        <source_field> as <target_field_name>,
        ...
    from source
)

select * from renamed
```

**Rules for staging models:**
- Always use `{{ source() }}` — never hardcode table names.
- Apply only renaming and type casting at this layer.
- Do NOT apply business transforms — those go in marts.
- Column names should be snake_case even if the source uses UPPER_CASE.

## Step 5: Generate mart models

Each Satsuma mapping becomes one or more mart models. The mapping's target
schema determines the model name and structure.

### Generating SQL from Satsuma arrows

For each mapping, use CLI to get the full arrow set:

```bash
satsuma mapping "<mapping-name>" --json
```

Then translate each arrow to SQL. Read an arrow's inputs from `srcs`, which
lists every source of a multi-source arrow (`a, b -> c`); `src` holds only the
first. See `references/satsuma-to-sql.md` for the full translation table. Key
patterns:

**Direct copy (`[none]` classification):**
```sql
stg.field_name as target_field_name
```

**Pipe chains:**
```sql
-- trim | lowercase | validate_email | null_if_invalid
case
    when trim(lower(stg.email)) ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    then trim(lower(stg.email))
    else null
end as email
```

**Map blocks → CASE WHEN:**
```sql
case
    when stg.cust_type = 'R' then 'retail'
    when stg.cust_type = 'B' then 'business'
    when stg.cust_type = 'G' then 'government'
    when stg.cust_type is null then 'retail'
    else 'unknown'
end as customer_type
```

**NL transforms → best-effort SQL + comment:**
```sql
-- TODO: NL transform — "Assign 'vip' if loyalty_tier is 'diamond' and
-- lifetime_spend > 10000. Assign 'high_value' if loyalty_tier is gold,
-- platinum, or diamond. Assign 'growth' if loyalty_tier is silver.
-- Otherwise assign 'standard'."
case
    when loyalty_tier = 'diamond' and lifetime_spend > 10000 then 'vip'
    when loyalty_tier in ('gold', 'platinum', 'diamond') then 'high_value'
    when loyalty_tier = 'silver' then 'growth'
    else 'standard'
end as customer_segment
-- REVIEW: ^^^ auto-generated from NL description — verify business logic
```

**Computed fields (`-> target` with no source):**
```sql
-- -> ingest_timestamp { now_utc }
current_timestamp as ingest_timestamp
```

### Multi-source mappings (JOINs)

When a mapping has multiple sources, read the NL join description from the
source block. Generate JOINs using `{{ ref() }}`:

```sql
with customers as (
    select * from {{ ref('stg_crm__customers') }}
),

orders as (
    select * from {{ ref('stg_pos__orders') }}
),

joined as (
    select
        customers.customer_id,
        orders.order_id,
        ...
    from orders
    left join customers
        on orders.customer_id = customers.customer_id
)

select * from joined
```

**Critical rule**: Every table reference MUST use `{{ ref('model_name') }}` for
other dbt models or `{{ source('source', 'table') }}` for raw sources. Never
hardcode schema-qualified table names.

### Model materialization from merge tokens

Map Satsuma merge tokens to dbt config. See `references/merge-to-dbt.md`.

```sql
-- (merge upsert, match_on customer_id)
{{
    config(
        materialized='incremental',
        unique_key='customer_id',
        on_schema_change='append_new_columns'
    )
}}

-- (merge append)
{{
    config(
        materialized='incremental'
    )
}}

-- (merge full_refresh)
{{
    config(
        materialized='table'
    )
}}
```

## Step 6: Generate SCD Type 2 handling

For schemas with `(dimension, scd 2)`, you have two approaches. Ask the user
which they prefer if not obvious from their existing project:

### Option A: dbt snapshots (recommended for most teams)

```sql
-- snapshots/snp_dim_customer.sql
{% snapshot snp_dim_customer %}
{{
    config(
        target_schema='snapshots',
        unique_key='customer_id',
        strategy='check',
        check_cols=['email', 'phone', 'loyalty_tier'],  -- from (track {...})
        invalidate_hard_deletes=True
    )
}}

select * from {{ ref('stg_crm__customers') }}

{% endsnapshot %}
```

Then create a mart model that reads from the snapshot:

```sql
-- models/marts/dim_customer.sql
select
    {{ dbt_utils.generate_surrogate_key(['customer_id', 'dbt_valid_from']) }}
        as surrogate_key,
    *,
    dbt_valid_from as valid_from,
    dbt_valid_to as valid_to,
    case when dbt_valid_to is null then true else false end as is_current
from {{ ref('snp_dim_customer') }}
```

### Option B: Incremental with merge (for teams that prefer it)

```sql
-- models/marts/dim_customer.sql
{{
    config(
        materialized='incremental',
        unique_key='surrogate_key',
        on_schema_change='append_new_columns'
    )
}}
-- SCD Type 2 logic implemented inline
-- See dbt docs on incremental SCD2 patterns for your warehouse
```

### Inferring snapshot config from Satsuma tokens

| Satsuma token | dbt snapshot config |
|---|---|
| `natural_key <field>` | `unique_key='<field>'` |
| `track {f1, f2, f3}` | `check_cols=['f1', 'f2', 'f3']` |
| `ignore {f1, f2}` | Omit these from `check_cols`; if `track` is absent, use all fields minus `ignore` |
| `scd 2` | `strategy='check'` (or `'timestamp'` if a clear updated_at field exists) |

### Omitting mechanical columns

Per Satsuma convention, mechanical columns (surrogate keys, valid_from/to,
is_current, row_hash, hash keys, load dates, record_source) are NOT written
in the .stm file — they are inferred. When generating dbt, you must ADD these
columns back:

**Kimball SCD 2:**
- `surrogate_key` — use `dbt_utils.generate_surrogate_key()`
- `valid_from`, `valid_to`, `is_current` — from snapshot or incremental logic
- `row_hash` — optional; use `dbt_utils.generate_surrogate_key()` on tracked fields

**Data Vault:**
- `*_hk` hash keys — use `dbt_utils.generate_surrogate_key()` on business keys
- `load_date` — `current_timestamp`
- `record_source` — from the mapping's `-> record_source { "SYSTEM" }` arrow
- `hash_diff` — hash of all descriptive fields in a satellite

**Facts:**
- `etl_batch_id` — from your orchestrator or `{{ invocation_id }}`
- `loaded_at` — `current_timestamp`
- `dim_*_key` — surrogate key lookups via joins to dimensions

## Step 7: Generate schema YAML with tests

For every generated model, create a YAML entry with column definitions and tests
derived from Satsuma metadata:

```yaml
# models/marts/_<domain>__models.yml
version: 2
models:
  - name: dim_customer
    description: >                    # from schema (note "...")
    meta:
      owner: "data-team"              # from (owner "...")
      classification: "INTERNAL"      # from (classification "...")
      scd_type: 2                     # from (scd 2)
    columns:
      - name: customer_id
        description: "Durable business key"
        tests:
          - not_null                   # from (required)
          - unique                    # from (pk) or (unique)
      - name: email
        meta:
          pii: true                   # from (pii)
          classification: "RESTRICTED"
        tests:
          - not_null                   # from (required)
      - name: loyalty_tier
        tests:
          - accepted_values:           # from (enum {bronze, silver, ...})
              values: ['bronze', 'silver', 'gold', 'platinum', 'diamond']
```

### Test generation from Satsuma metadata

| Satsuma metadata | dbt test |
|---|---|
| `(pk)` | `not_null` + `unique` |
| `(pk, required)` | `not_null` + `unique` |
| `(required)` | `not_null` |
| `(unique)` | `unique` |
| `(enum {a, b, c})` | `accepted_values: {values: [a, b, c]}` |
| `(ref dim_x.field)` | `relationships: {to: ref('dim_x'), field: field}` |
| `(format email)` | Custom test or regex test (suggest to user) |
| `(format E.164)` | Custom test or regex test (suggest to user) |

### Test generation from Satsuma warnings and comments

| Satsuma comment | dbt test suggestion |
|---|---|
| `//! some records have NULL` | `not_null` with `warn` severity, or note in description |
| `//! not validated` | Suggest adding a validation test |
| `//?` open questions | Add as `description` note, flag for team review |

### Fact table dimension relationship tests

For schemas with `(fact, ref dim_x.field)`, generate referential integrity tests:

```yaml
- name: dim_customer_key
  tests:
    - not_null
    - relationships:
        to: ref('dim_customer')
        field: surrogate_key
```

## Step 8: Generate dbt exposures from consumer schemas

Satsuma schemas with `(report)` or `(model)` metadata become dbt exposures:

```yaml
# exposures/_exposures.yml
version: 2
exposures:
  - name: weekly_sales_dashboard
    type: dashboard                     # report → dashboard; model → ml
    owner:
      name: "Analytics Team"            # from (owner "...")
    description: >                      # from (note "...")
    depends_on:
      - ref('fact_orders')              # from (source {fact_orders, dim_product})
      - ref('dim_product')
    url: "https://..."                  # from (dashboard_id "...") if URL-like
    meta:
      tool: looker                      # from (tool looker)
      classification: "INTERNAL"        # from (classification "...")
      refresh: "Monday 06:00 UTC"       # from (refresh schedule "...")
```

### Consumer type mapping

| Satsuma token | dbt exposure type |
|---|---|
| `(report)` | `dashboard` |
| `(model)` | `ml` |
| `(report)` with `(tool jupyter)` | `notebook` |

## Step 9: Generate packages.yml

Based on what the scaffold needs:

```yaml
packages:
  - package: dbt-labs/dbt_utils
    version: [">=1.0.0", "<2.0.0"]
  # Add if Data Vault patterns detected:
  - package: Datavault-UK/dbtvault
    version: [">=0.10.0", "<1.0.0"]
```

## Step 10: Validate and present

1. Review the generated project for consistency:
   - Every `{{ ref() }}` points to a model that exists in the scaffold.
   - Every `{{ source() }}` has a matching entry in sources.yml.
   - No hardcoded table names anywhere.
   - Materializations match the merge strategy tokens.

2. List what was generated and what needs manual attention:
   - Models with TODO markers from NL transforms.
   - Any `//!` warnings that need operational decisions.
   - Any `//?` open questions that need stakeholder input.
   - Custom tests that were suggested but not generated.

3. Present the files to the user.

## Important: What NOT to generate

- **Do not generate `profiles.yml`** — this contains credentials and is
  environment-specific. Mention that the user needs to configure it.
- **Do not hardcode warehouse-specific function names without checking the
  dialect** — always consult `references/dialect-map.md`.
- **Do not generate models for Satsuma schemas that are only used as sources** —
  they belong in sources.yml, not as models.
- **Do not collapse multiple Satsuma mappings targeting the same schema into one
  model** without asking the user. Multiple mappings to one target may represent
  sequential load steps or alternative sources.
