---
name: satsuma-sample-data
description: >
  Generate realistic synthetic test data from Satsuma (.stm) schema definitions. Use this
  skill whenever the user wants to create test data, sample data, fake data, seed data,
  mock data, or synthetic data from a Satsuma spec. Also trigger for requests like
  "generate CSV from this schema", "create test fixtures for my mapping", "I need sample
  data to test my pipeline", "mock up some data for this spec", or "seed data for my
  warehouse". Generates data that respects all schema constraints (types, enums, required,
  PII patterns, formats, defaults, filters) and maintains referential integrity across
  schemas connected by mappings. Supports CSV, JSON/JSONL, SQL INSERT, and Parquet output.
  For exotic source formats (COBOL copybooks, HL7, EDI, ISO 8583, etc.), this skill
  generates the logical data and suggests the user create a format-specific skill for
  physical serialisation. Requires the `satsuma` CLI.
---

# Satsuma Sample Data Generator

Generate realistic, constraint-respecting synthetic data from Satsuma schemas.

## Prerequisites

- The `satsuma` CLI must be installed and on PATH.
- Python 3 with `faker` available (`pip install faker`). If generating Parquet,
  also needs `pyarrow`.
- The user must provide one or more `.stm` files.

## Step 0: Extract schema structure

```bash
# Workspace overview
satsuma summary <file>.stm --json

# Full graph to understand schema relationships
satsuma graph <file>.stm --json

# For each schema the user wants data for:
satsuma fields <schema> --json
satsuma meta <schema> --json
satsuma nl <schema>

# Warnings for edge case generation
satsuma warnings <file>.stm --json
```

## Step 1: Ask the user

1. **Which schemas?** — Show the schemas found and ask which ones need data.
   Default: all source schemas (schemas that appear on the left side of mappings).
   Target schemas often don't need seed data — they're populated by the pipeline.

2. **Row count** — "How many rows per schema?" Default: 100. For schemas connected
   by one-to-many relationships (e.g., orders → line items), ask for the parent
   count and suggest a multiplier for children (e.g., "100 orders, 3–7 line items
   each").

3. **Output format** — CSV, JSON, JSONL, SQL INSERT, or Parquet.
   Default: CSV (most portable). For schemas with nested records or `list_of`
   fields, recommend JSON/JSONL since CSV can't represent nesting natively.

4. **Edge cases** — "Should I include realistic edge cases from the spec's
   warnings? For example, null values where the spec says 'some records have
   NULL', or malformed data where it says 'not validated'."
   Default: yes, at ~5–10% of rows.

5. **Seed** — "Want a fixed random seed for reproducible data?"
   Default: 42.

Do NOT ask about locale — infer it from the schema context (country codes,
currency, phone format hints). Default to `en_US` if unclear.

## Step 2: Build a generation plan

Before writing any code, build a plan for each schema. For every field, determine
the generator based on type + metadata. See `references/field-generators.md` for
the complete generator lookup table.

### Generator selection priority

For each field, check metadata in this order — first match wins:

1. **`(enum {a, b, c})`** → random choice from the enum values
2. **`(format <pattern>)`** → format-specific generator (email, E.164, etc.)
3. **`(pii)` + field name heuristic** → Faker generator (see PII section below)
4. **`(default <val>)`** → use the default for ~30% of rows, generate for rest
5. **Type-based fallback** → generate from the Satsuma type

### PII field heuristics

When a field has `(pii)`, use the field name to select a realistic Faker provider:

| Field name pattern | Faker provider |
|---|---|
| `*email*` | `fake.email()` |
| `*phone*`, `*mobile*`, `*tel*` | `fake.phone_number()` |
| `*first_name*`, `*first_nm*` | `fake.first_name()` |
| `*last_name*`, `*last_nm*`, `*surname*` | `fake.last_name()` |
| `*name*` (generic) | `fake.name()` |
| `*address*`, `*street*`, `*addr*` | `fake.street_address()` |
| `*city*` | `fake.city()` |
| `*state*`, `*province*` | `fake.state_abbr()` |
| `*zip*`, `*postal*` | `fake.zipcode()` |
| `*country*` | `fake.country_code()` |
| `*ssn*`, `*tax_id*`, `*national_id*` | `fake.ssn()` |
| `*dob*`, `*date_of_birth*`, `*birth*` | `fake.date_of_birth(minimum_age=18, maximum_age=90)` |
| `*card*`, `*credit*` | `fake.credit_card_number()` |
| `*iban*` | `fake.iban()` |
| `*ip*`, `*ip_address*` | `fake.ipv4()` |

If the field name doesn't match any pattern, generate a plausible string and
add a `# TODO: refine PII generator for <field>` comment.

### Referential integrity

When schemas are connected by mappings (source → target), or by `(ref dim.field)`,
or by join descriptions in source blocks:

1. **Identify FK relationships** from the graph output.
2. **Generate parent data first** — create the parent schema's rows and collect
   the key values (PK fields).
3. **Generate child data second** — for FK fields, sample from the parent's key
   values. This ensures every child row references a valid parent.
4. **For one-to-many** (e.g., orders → line items): generate a random number of
   children per parent (configurable range, e.g., 1–5).

### Nested records and list_of fields

For schemas with `record {}` and `list_of record {}` fields:

- **JSON/JSONL output**: generate nested structures naturally.
- **CSV output**: flatten with dot notation (`customer.email`) or generate
  separate CSV files per nested level (recommend the latter for `list_of`).
- **SQL output**: generate separate INSERT statements per nesting level.

For `list_of TYPE` (scalar lists like `list_of STRING`):
- JSON: generate as arrays `["value1", "value2"]`
- CSV: generate as pipe-delimited string `"value1|value2|value3"`

### Filters

When a schema has `(filter expr)` on a field or nested block, generate data
that **passes** the filter. For example:
- `(filter item_status != "cancelled")` → never generate `"cancelled"` for
  `item_status` in the primary dataset. Optionally generate a small
  "pre-filter" dataset that includes cancelled items to test filter logic.

## Step 3: Handle edge cases from warnings

Parse `//!` warnings from `satsuma warnings --json` and generate corresponding
edge cases in a controlled percentage of rows (default 5–10%):

| Warning pattern | Edge case to generate |
|---|---|
| "some records have NULL" / "nullable" | Generate nulls for this field in ~5% of rows |
| "not validated" / "unvalidated" | Generate some malformed values (e.g., invalid emails) |
| "mixed formats" | Generate values in 2–3 different formats |
| "may be empty" | Generate empty strings in ~5% of rows |
| "duplicates possible" | Generate a few duplicate values for this field |
| "legacy" / "deprecated" | Generate values in old format alongside new format |
| "truncated" / "overflow" | Generate values near or exceeding the type's length limit |

When generating edge cases, add a `_edge_case` boolean column (or a comment in
JSON) so the user can easily identify which rows are edge cases vs. clean data.

## Step 4: Generate the data

Write a Python script that uses Faker and random to generate data, then output
in the requested format. The script should be:

- **Self-contained** — runnable with `python generate_data.py`
- **Seeded** — reproducible with the same seed
- **Commented** — each generator has a comment linking to the Satsuma field

### Python generation template

```python
import csv, json, random, uuid, os
from datetime import datetime, date, timedelta
from decimal import Decimal
from faker import Faker

fake = Faker()
Faker.seed(42)
random.seed(42)

# --- Schema: <schema_name> ---
def generate_<schema_name>(n: int, parent_keys: dict = None) -> list[dict]:
    rows = []
    for i in range(n):
        row = {}
        # <field_name>: <type> <metadata>
        row["field_name"] = <generator_expression>
        ...
        rows.append(row)
    return rows

# --- Generate in dependency order ---
<parent>_data = generate_<parent>(100)
<parent>_keys = [r["<pk_field>"] for r in <parent>_data]
<child>_data = generate_<child>(300, parent_keys={"<fk>": <parent>_keys})

# --- Write output ---
# CSV / JSON / SQL / Parquet writer here
```

Run the script and present the output files.

### Output format specifics

**CSV:**
```python
with open(f"{schema_name}.csv", "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=rows[0].keys())
    writer.writeheader()
    writer.writerows(rows)
```

**JSON (pretty, one file per schema):**
```python
with open(f"{schema_name}.json", "w") as f:
    json.dump(rows, f, indent=2, default=str)
```

**JSONL (one object per line, good for streaming):**
```python
with open(f"{schema_name}.jsonl", "w") as f:
    for row in rows:
        f.write(json.dumps(row, default=str) + "\n")
```

**SQL INSERT:**
```python
with open(f"{schema_name}.sql", "w") as f:
    for row in rows:
        cols = ", ".join(row.keys())
        vals = ", ".join(sql_escape(v) for v in row.values())
        f.write(f"INSERT INTO {schema_name} ({cols}) VALUES ({vals});\n")
```

**Parquet:**
```python
import pyarrow as pa
import pyarrow.parquet as pq

table = pa.Table.from_pylist(rows)
pq.write_table(table, f"{schema_name}.parquet")
```

## Step 5: Validate and present

1. **Validate constraints:**
   - All `(required)` fields are non-null (except intentional edge cases, which
     should be clearly marked)
   - All `(enum {...})` values are within the allowed set (except edge cases)
   - All `(pk)` / `(unique)` fields have unique values
   - All FK references point to valid parent keys
   - All `(format ...)` fields match the format (except edge cases)

2. **Present the output:**
   - Data files in the requested format
   - The Python generation script (so the user can modify and re-run)
   - A brief summary: row counts per schema, edge cases included, FK
     relationships maintained

3. **Suggest next steps:**
   - "Run `satsuma validate` against your spec to confirm the schema is correct"
   - "Use these files as seed data in your pipeline tests"
   - "Pair with a test generator (dbt tests, Great Expectations) to validate
     your pipeline against this data"

## Exotic format guidance

This skill generates logical data as CSV, JSON, SQL, or Parquet. For schemas that
represent exotic wire formats, the logical data is correct but needs physical
serialisation:

| Schema convention | What this skill generates | What you need additionally |
|---|---|---|
| COBOL copybooks | CSV with correct field values | A COBOL copybook writer skill for fixed-width EBCDIC |
| HL7 v2 segments | JSON with segment fields | An HL7 message builder skill for pipe-delimited segments |
| EDI X12/EDIFACT | JSON with element values | An EDI envelope/segment builder skill |
| ISO 8583 bitmaps | JSON with field values | An ISO 8583 message packer skill |
| Fixed-width flat files | CSV with values | A fixed-width formatter skill with position maps |
| XML (FHIR, ISO 20022) | JSON with element values | An XML serialiser skill with namespace handling |
| Avro / Protobuf | JSON with field values | A schema-registry-aware serialiser skill |

For any of these, create a format-specific skill using the `skill-creator` skill.
The Satsuma repo's `docs/conventions-for-schema-formats/` directory has LLM
guidelines for many of these formats that a format skill can reference.

## Data modelling awareness

### Kimball schemas

For `(dimension, scd 2)` schemas, generate data that exercises SCD behaviour:
- Generate multiple versions of some entities (same natural key, different
  attribute values) to simulate history. Mark with different `valid_from` dates.
- Include `(track {...})` field changes between versions.
- Keep `(ignore {...})` fields constant across versions — this tests that the
  pipeline correctly ignores them.

For `(fact)` schemas:
- Respect the `(grain {...})` — ensure unique combinations of grain fields.
- FK fields must reference valid dimension keys.
- `(measure additive)` fields get realistic positive decimals.
- `(measure semi_additive)` fields (balances) should have realistic progressions.
- `(degenerate)` fields get realistic transaction-style identifiers.

### Data Vault schemas

For `(hub)` schemas:
- Generate unique business keys. Include some keys from multiple source systems
  (same entity, different source identifiers) to test deduplication.

For `(satellite)` schemas:
- Generate multiple versions per parent hash key with different load dates.
- Vary the descriptive fields between versions.

For `(link)` schemas:
- Generate combinations of hub business keys. Include some many-to-many
  relationships to exercise the link structure.

### Merge strategy awareness

When a mapping has `(merge upsert, match_on field)`:
- Generate some rows where the match key already exists (simulates updates)
  and some where it's new (simulates inserts).
- Provide both an "initial load" file and an "incremental" file so the user
  can test the upsert behaviour.

When a mapping has `(merge soft_delete)`:
- Generate a separate "deletion feed" file with a subset of match keys.

When a mapping has `(merge full_refresh)`:
- Generate a complete dataset (no incremental split needed).
