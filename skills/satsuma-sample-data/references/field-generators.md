# Field Generator Reference

For each Satsuma field, select a generator based on metadata and type. Check
metadata first (enum, format, pii), then fall back to type-based generation.

## Metadata-driven generators (highest priority)

### `(enum {val1, val2, val3})`

```python
random.choice(["val1", "val2", "val3"])
```

If the field also has a `//!` warning about NULLs, include `None` in the
choices at the configured edge-case rate.

### `(format email)`

```python
fake.email()
# Edge case: "not-an-email", "user@", "@domain.com"
```

### `(format E.164)`

```python
fake.phone_number()  # then normalize to E.164
# Or directly: f"+1{fake.numerify('##########')}"
# Edge case: "123", "+1-800-FLOWERS", "N/A"
```

### `(pii)`

See the PII heuristic table in SKILL.md. If the field name doesn't match any
pattern, fall back to type-based generation and comment it.

### `(default <val>)`

```python
val if random.random() < 0.3 else <type_generator>
```

Use the default value ~30% of the time to create realistic distribution.

### `(required)`

Never generate `None` for this field (unless creating an intentional edge case
row, clearly marked).

### `(pk)` or `(unique)`

```python
# Use a counter, UUID, or Faker.unique
fake.unique.random_int(min=1, max=999999)
# Or for UUIDs:
str(uuid.uuid4())
```

Ensure uniqueness across all generated rows.

### `(ref schema.field)`

```python
random.choice(parent_keys["field"])
```

Sample from the parent schema's generated key values. Generate parent first.

## Type-based generators (fallback)

### String types

| Satsuma type | Generator | Notes |
|---|---|---|
| `STRING` / `STRING(n)` | `fake.pystr(max_chars=n)` | Respect max length |
| `VARCHAR(n)` | `fake.pystr(max_chars=n)` | Respect max length |
| `CHAR(n)` | `fake.pystr(min_chars=n, max_chars=n)` | Fixed length |
| `TEXT` | `fake.paragraph()` | Longer text |

For short strings (n ≤ 5), prefer `fake.lexify("?" * n)` for code-like values.
For medium strings (5 < n ≤ 50), prefer `fake.word()` or `fake.name()`.
For long strings (n > 50), prefer `fake.sentence()`.

### Numeric types

| Satsuma type | Generator | Notes |
|---|---|---|
| `INT` / `INTEGER` | `fake.random_int(min=0, max=10000)` | Adjust range to context |
| `BIGINT` | `fake.random_int(min=0, max=10**9)` | |
| `DECIMAL(p, s)` | `round(random.uniform(0, 10**(p-s)), s)` | Respect precision and scale |
| `FLOAT` / `DOUBLE` | `round(random.uniform(0, 10000), 4)` | |

**Context-sensitive ranges:**
- Fields named `*price*`, `*amount*`, `*total*`, `*cost*` → `0.01` to `9999.99`
- Fields named `*quantity*`, `*count*` → `1` to `100` (integers)
- Fields named `*percent*`, `*rate*`, `*pct*` → `0.0` to `100.0`
- Fields named `*age*` → `18` to `90`
- Fields named `*year*` → `2015` to `2025`

### Boolean

```python
random.choice([True, False])
```

For fields with `(default false)`, bias toward `False` (~70%).

### Date and time types

| Satsuma type | Generator | Notes |
|---|---|---|
| `DATE` | `fake.date_between(start_date="-2y", end_date="today")` | |
| `TIMESTAMP` | `fake.date_time_between(start_date="-2y")` | |
| `TIMESTAMPTZ` | `fake.date_time_between(start_date="-2y", tzinfo=timezone.utc)` | |

**Context-sensitive dates:**
- `*created*`, `*registered*`, `*since*` → past dates, reasonable range
- `*updated*`, `*modified*` → after creation date (if both exist in schema)
- `*birth*`, `*dob*` → `fake.date_of_birth(minimum_age=18, maximum_age=90)`
- `*expiry*`, `*expires*` → future dates

### UUID

```python
str(uuid.uuid4())
```

Always unique. For `(pk)` UUID fields, use `uuid4()` directly.

### ID types (Salesforce, etc.)

```python
# Salesforce 18-char ID
fake.lexify(
    "001" + "?" * 15,
    letters="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
)
```

### PICKLIST (Salesforce)

Treat as `(enum {...})` — must have an enum metadata token to generate from.
If no enum is specified, generate from `["Option_A", "Option_B", "Option_C"]`
and add a `# TODO: replace with real picklist values` comment.

## Nested structures

### `record {}`

Generate as a nested dict:

```python
row["customer"] = {
    "customer_id": str(uuid.uuid4()),
    "email": fake.email(),
    "tier": random.choice(["standard", "silver", "gold", "platinum"]),
}
```

### `list_of TYPE`

Generate a list of scalar values:

```python
# list_of STRING
row["promo_codes"] = [fake.lexify("PROMO-????") for _ in range(random.randint(0, 3))]

# list_of INT
row["tag_ids"] = [fake.random_int(1, 1000) for _ in range(random.randint(1, 5))]
```

### `list_of record {}`

Generate a list of nested dicts:

```python
row["line_items"] = [
    {
        "line_number": i + 1,
        "sku": fake.lexify("SKU-######"),
        "quantity": fake.random_int(1, 10),
        "unit_price": round(random.uniform(1.0, 500.0), 2),
    }
    for i in range(random.randint(1, 5))
]
```

### Filtered lists

When a `list_of record` has `(filter field != "value")`:

```python
# (filter item_status != "cancelled")
# Generate only items that pass the filter
row["line_items"] = [
    {
        "item_status": random.choice(["active", "backordered"]),  # never "cancelled"
        ...
    }
    for i in range(random.randint(1, 5))
]
```

Optionally generate a separate "pre-filter" dataset that includes filtered-out
values for testing filter logic.

## Measure-aware generation

### `(measure additive)` — revenue, quantity, amounts

```python
# Positive values, realistic distribution
round(
    random.lognormvariate(3, 1), 2
)  # log-normal → right-skewed like real financial data
```

### `(measure semi_additive)` — balances, inventory

```python
# Simulate progression: start with a base, apply deltas
base = round(random.uniform(100, 10000), 2)
# Each subsequent row for the same entity: base + random delta
```

### `(measure non_additive)` — percentages, unit prices

```python
# Realistic unit prices
round(random.uniform(0.99, 299.99), 2)
# Percentages
round(random.uniform(0, 100), 1)
```

## Edge case generation patterns

Apply these at the configured rate (default 5–10%) to random rows:

| Edge case type | Generator |
|---|---|
| NULL in normally-populated field | `None` |
| Empty string | `""` |
| Max-length string | `"x" * max_length` |
| Boundary numbers | `0`, `-1`, `MAX_INT`, `0.00` |
| Invalid email | `"not-an-email"`, `"user@"`, `"@domain.com"` |
| Invalid phone | `"N/A"`, `"000-000-0000"`, `"call me"` |
| Mixed date formats | `"2024-01-15"`, `"01/15/2024"`, `"Jan 15, 2024"` |
| Unicode in strings | `"Ñoño"`, `"日本語"`, `"Ünïcödé"` |
| Leading/trailing whitespace | `"  value  "` |
| Duplicate PK values | Reuse a previously generated key |

Mark edge case rows clearly — add a `_is_edge_case` field set to `True`, or
a JSON comment, so the user can filter them in or out during testing.
