# Lesson 12 — The Data & Analytics Engineer's Playbook

> **Personas:** Data Engineer, Analytics Engineer, Data Modeler

## Your Role in the Satsuma Model

As a data or analytics engineer, you use Satsuma as the **source of truth** for warehouse, lakehouse, and dimensional modeling work. You care about precise schemas, structural transforms, metrics definitions, lineage, and using the agent to accelerate mapping authoring and implementation planning.

Where the BA focuses on meaning and intent, you focus on **precision and implementability**:
- Are the types exact enough for your target platform?
- Are the transforms implementable in SQL/Spark/dbt?
- Does the lineage graph match the actual data flow?
- Are metrics defined with the right grain, additivity, and source tables?

---

## Precise Schema Definitions

Your schemas should be implementation-ready. Use exact types, constraints, and format metadata:

```satsuma
schema order_headers_parquet (format parquet, note "Curated order header dataset") {
  order_id             STRING         (pk)
  order_channel        STRING         (enum {web, mobile, store, marketplace}, required)
  order_timestamp_utc  TIMESTAMPTZ    (required)
  customer_id          STRING
  customer_email       STRING         (format email, pii)
  loyalty_tier         STRING         (enum {bronze, silver, gold, platinum})
  ship_country         STRING         (required)
  currency_code        STRING         (required)
  subtotal_amount      DECIMAL(12,2)
  tax_amount           DECIMAL(12,2)
  total_amount         DECIMAL(12,2)  (required)
  discount_codes       JSON
  line_count           INT32
  ingest_date          DATE           (required)
}
```

### Tips for engineering-grade schemas:

- **Use format metadata** — `format parquet`, `format snowflake`, `format postgresql` — to document the target platform.
- **Be explicit about decimal precision** — `DECIMAL(12,2)` not just `DECIMAL`.
- **Mark nullability** — `(required)` means NOT NULL. Absence of `required` means nullable.
- **Include referential constraints** — `(ref customers.customer_id)`.
- **Use platform-specific notes** — document partitioning, clustering, or distribution keys.

---

## Structural Transforms for Implementation

As an engineer, you lean toward structural (deterministic) transforms because they translate directly to implementation code:

```satsuma
// These translate directly to SQL/Spark/dbt
EMAIL_ADDR -> email { trim | lowercase | validate_email | null_if_invalid }
CREDIT_LIMIT -> credit_limit_cents { coalesce(0) | * 100 | round }
CREATED_DATE -> created_at { parse("MM/DD/YYYY") | drop_if_invalid | assume_utc | to_iso8601 }
ACCOUNT_STATUS -> status { map { A: "active", S: "suspended", C: "closed", D: "delinquent" } }
```

When you see a structural pipeline, you know exactly what SQL or Spark expression to write. The transform vocabulary is designed to be unambiguous.

### Error-handling convention

The error-handling tokens follow a consistent pattern:

| Pattern | Behavior |
|---|---|
| `null_if_*` | Replace value with null (record survives) |
| `drop_if_*` | Discard entire record |
| `warn_if_*` | Log warning, pass through |
| `error_if_*` | Halt pipeline |

Choose based on your data quality requirements:
- `null_if_invalid` — tolerant, preserves records
- `drop_if_invalid` — strict, ensures only clean records
- `warn_if_invalid` — tolerant but auditable
- `error_if_null` — hard stop, use for critical fields

---

## Metrics: Defining Business KPIs

A Satsuma metric is a `schema` marked with the `metric` token. Its metadata declares the source, grain, dimensions and filter; its fields declare measure additivity:

```satsuma
schema monthly_recurring_revenue (
  metric,
  metric_name "MRR",
  source fact_subscriptions,
  grain monthly,
  slice {customer_segment, product_line, region},
  filter "status = 'active' AND is_trial = false"
) {
  value  DECIMAL(14,2)  (measure additive)

  note {
    """
    Sum of active subscription amounts, normalized to monthly.
    Annual subscriptions divided by 12. Quarterly by 3.
    Excludes trials and churned subscriptions.

    **Owner:** Finance — Revenue team
    **SLA:** Available by 09:00 UTC on the 2nd of each month
    """
  }
}
```

### Key metric concepts:

**Source** — which fact/dimension tables feed the metric:
```satsuma
source fact_subscriptions              // single source
source {fact_orders, dim_customer}     // multiple sources
```

**Grain** — the time resolution:
```satsuma
grain daily | weekly | monthly
```

**Slice** — the dimensions you can break the metric by:
```satsuma
slice {customer_segment, product_line, region}
```

**Filter** — row-level filter applied before aggregation:
```satsuma
filter "status = 'active' AND is_trial = false"
```

**Measure additivity** — how the metric can be aggregated across dimensions:

| Additivity | Meaning | Example |
|---|---|---|
| `measure additive` | Can be summed across all dimensions | Revenue, order count |
| `measure non_additive` | Cannot be summed (ratios, averages) | Churn rate, CLV, avg order value |
| `measure semi_additive` | Can be summed across some dimensions | Account balances (sum across accounts, not time) |

**Critical rule:** Metrics are terminal nodes in the lineage graph. Data flows **into** them, nothing flows **out**. A mapping may target a metric to show how its values are produced, but never use one as a mapping source.

---

## Lineage for Data Engineering

Lineage is your tool for understanding and managing data flow:

### Upstream lineage (where does data come from?)

```
satsuma lineage --to order_headers_parquet pipeline.stm
```

Shows every schema and mapping that feeds into the target, helping you understand:
- Which source systems contribute data
- What transformations happen along the way
- Where data quality issues might originate

### Downstream lineage (what depends on this?)

```
satsuma lineage --from crm_customers pipeline.stm
```

Shows every downstream consumer, helping you assess:
- Impact of schema changes
- Which metrics are affected by a source change
- How many targets need to be rebuilt if a source changes

### Field-level lineage

```
satsuma arrows crm_customers.email
```

Shows exactly how a specific field flows through the system — what transforms are applied, where it lands, whether it's referenced in NL transforms via `@ref` markers.

---

## Data Vault and Dimensional Modeling

Satsuma supports data modeling conventions with domain-specific metadata tokens:

### Data Vault

```satsuma
schema hub_customer (datavault hub) {
  customer_hk    BINARY(32)    (pk, hashkey)
  customer_email VARCHAR(255)  (required, unique)
  load_date      TIMESTAMPTZ   (required)
  record_source  VARCHAR(100)  (required)
}

schema sat_customer_details (datavault satellite) {
  customer_hk    BINARY(32)    (pk, ref hub_customer.customer_hk)
  first_name     VARCHAR(100)
  last_name      VARCHAR(100)
  effective_from TIMESTAMPTZ   (pk)
  effective_to   TIMESTAMPTZ
  ...audit columns
}
```

### Slowly Changing Dimensions

```satsuma
schema dim_customer (scd_type_2) {
  customer_sk      BIGINT        (pk)
  customer_id      VARCHAR(36)   (unique)
  customer_name    VARCHAR(200)
  segment          VARCHAR(20)
  effective_from   DATE          (required)
  effective_to     DATE
  is_current       BOOLEAN       (required)
}
```

These tokens are vocabulary conventions — they document the modeling pattern and can be used by lint rules or downstream tooling.

---

## Using the Agent for Implementation Planning

Beyond mapping authoring, the agent can help with implementation:

| Task | How to use the agent |
|---|---|
| Generate SQL from a mapping | "Generate a SQL INSERT...SELECT statement that implements the `customer migration` mapping" |
| Plan dbt models | "Based on these mappings, outline the dbt model structure and dependencies" |
| Identify materializations | "Which mappings involve aggregation? These probably need intermediate materialization" |
| Check transform feasibility | "Can all the structural transforms in this mapping be expressed in Snowflake SQL?" |
| Review NL transforms for implementability | "List all NL transforms and assess whether each can be implemented in SQL or needs custom code" |

The agent uses the CLI to extract the relevant mapping details and then reasons about implementation feasibility.

---

## Workspace Graph for Platform Reasoning

For platform-scale work, the full workspace graph is your most powerful tool:

```
satsuma graph --json pipeline.stm
```

This gives you the complete node and edge structure of the workspace. The agent can use it to:
- Identify independent data pipelines (disconnected subgraphs)
- Find the longest transformation chain
- Detect circular dependencies
- Plan parallel execution order

---

## Key Takeaways

1. Use precise types, constraints, and format metadata — your schemas should be implementation-ready.
2. Prefer structural transforms that translate directly to SQL/Spark expressions.
3. Metric schemas (marked with the `metric` token) define KPIs with source, grain, slice, filter, and measure additivity. They are terminal nodes.
4. Use lineage commands to trace data flow upstream and downstream, especially before making changes.
5. Data Vault and dimensional modeling conventions are supported as vocabulary tokens.
6. The agent can help with implementation planning — SQL generation, dbt structuring, and feasibility assessment.

---

**Next:** [Lesson 13 — The Governance & Audit Playbook](13-governance-playbook.md)
