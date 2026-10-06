# Lesson 04 — Reuse, Imports, and Multi-File Thinking

## Beyond a Single File

Real integration projects don't fit in one file. A customer data platform might have schemas for CRM, billing, support, orders, and a warehouse — each with dozens of fields. Some field patterns (addresses, audit columns, timestamps) repeat across every schema.

Satsuma handles this with three mechanisms:

1. **Fragments** — reusable groups of fields.
2. **Imports** — pulling definitions from other files.
3. **Multi-file workspaces** — organizing related schemas and mappings across files.

---

## Fragments: Reusable Field Groups

A `fragment` defines a named set of fields that can be spread into any schema:

```satsuma
fragment `address fields` {
  line1        STRING(200)    (required)
  line2        STRING(200)
  city         STRING(100)    (required)
  state        STRING(50)
  postal_code  STRING(20)     (required)
  country      ISO-3166-a2    (required)
}

fragment `audit columns` {
  created_at   TIMESTAMPTZ    (required)
  created_by   VARCHAR(100)   (required)
  updated_at   TIMESTAMPTZ
  updated_by   VARCHAR(100)
}
```

Use fragments with the spread operator `...`:

```satsuma
schema customers {
  customer_id  UUID  (pk)
  name         VARCHAR(200)
  ...`address fields`
  ...`audit columns`
}
```

The parser expands the spread at parse time. Tools and agents see the individual fields as if they were declared inline.

### When to extract a fragment

- A group of 3+ fields appears in 2+ schemas.
- The fields represent a single concept (address, audit trail, contact info).
- Changes to the group should propagate to all schemas that use it.

### When not to extract a fragment

- Fields appear once. Don't create a fragment for a one-off use.
- The fields differ slightly between schemas. If you need `state VARCHAR(50)` in one schema and `state CHAR(2)` in another, they're not the same fragment.

---

## Named Transforms: Reusable Logic

Just as fragments let you reuse field groups, named transforms let you reuse transformation logic:

```satsuma
transform `clean email` {
  "Trim whitespace, lowercase, validate RFC 5322 format, return null if invalid"
}

transform `to utc date` {
  parse("MM/DD/YYYY") | assume_utc | to_iso8601
}
```

Spread them into mapping arrows with `...`:

```satsuma
EMAIL_ADDR -> email { ...`clean email` }
CREATED_DATE -> created_at { ...`to utc date` }
```

Named transforms are useful when the same transformation applies to multiple fields across different mappings — email normalization, date parsing, phone formatting.

In this lesson, the spread form (`` { ...`clean email` } ``) is treated as the canonical style because it matches the current spec. You may also encounter exploratory examples in this repo that invoke a named transform directly, such as `{ normalize_email }`. If you are writing new introductory material or teaching the basics, prefer one style consistently and call out the other explicitly when it appears.

---

## Imports: Sharing Across Files

The `import` statement pulls named definitions from another file:

```satsuma
import { `address fields`, `audit columns` } from "lib/common.stm"
import { fx_spot_rates } from "lookups/finance.stm"
```

### What can be imported

Any named definition: `schema`, `fragment`, `transform`, `mapping`, `metric`.

### File organization patterns

A typical workspace might look like this:

```
project/
├── lib/
│   └── common.stm          ← shared fragments and transforms
├── lookups/
│   └── finance.stm         ← currency rates, country codes
├── crm/
│   └── customer-migration.stm
├── orders/
│   └── order-ingestion.stm
└── platform.stm             ← entry point for platform-wide lineage
```

The `lib/` directory holds reusable building blocks. Integration-specific files import what they need.

---

## Definition Uniqueness

All named definitions in a Satsuma workspace share a single namespace. You cannot have two definitions with the same name — even if they are different types:

```satsuma
// This is INVALID — two definitions named 'customers'
schema customers { ... }
fragment customers { ... }    // name collision!
```

This constraint exists because imports, spreads, and lineage queries all resolve by name. If two things share a name, the resolution is ambiguous.

If you need to distinguish similar concepts, use descriptive names:

```satsuma
schema crm_customers { ... }
schema warehouse_customers { ... }
fragment `customer fields` { ... }
```

---

## The Platform Entry Point

For large multi-file workspaces, a **platform entry point** file imports key definitions from across the platform and makes them available for lineage traversal:

```satsuma
// platform.stm — the entry point for platform-wide lineage
import { crm_customers, crm_orders } from "crm/pipeline.stm"
import { billing_invoices } from "billing/pipeline.stm"
import { warehouse_inventory } from "warehouse/ingest.stm"
```

This file serves two purposes:

1. **Documentation** — it shows the full scope of the platform at a glance.
2. **Lineage** — tools can start here and trace data flow through the entire platform using `satsuma lineage --from <schema> <dir>`.

---

## How the Agent Helps with Multi-File Workspaces

When working across multiple files, the agent's role is to:

- **Identify reuse opportunities** — "These five schemas all have the same address fields. Should we extract a fragment?"
- **Keep cross-file references consistent** — "This import references `` `audit columns` `` from `common.stm`, but I see the fragment was renamed to `` `audit fields` ``."
- **Navigate the workspace** — "Which schemas reference `crm_customers`? Let me check the import graph."
- **Draft imports** — "You need the `` `address fields` `` fragment in this new file. I'll add the import statement."

The CLI supports this with commands like `where-used`, `lineage`, and `summary` that work across the full workspace — not just individual files.

---

## Exercise: Building a Common Library

Suppose you're building the Acme Corp migration workspace. You notice these fields appear in multiple schemas:

- `created_at TIMESTAMPTZ (required)` and `updated_at TIMESTAMPTZ` — in every target schema
- `line1 STRING(200) (required)`, `city STRING(100) (required)`, etc. — in customer and supplier schemas

**Step 1:** Create a `lib/common.stm` file with the shared fragments:

```satsuma
// lib/common.stm — Shared fragments for the Acme Corp migration

fragment `audit timestamps` {
  created_at   TIMESTAMPTZ  (required)
  updated_at   TIMESTAMPTZ
}

fragment `address fields` {
  line1        STRING(200)  (required)
  line2        STRING(200)
  city         STRING(100)  (required)
  state        STRING(50)
  postal_code  STRING(20)   (required)
  country      ISO-3166-a2  (required)
}
```

**Step 2:** Import and use them in your integration file:

```satsuma
import { `audit timestamps`, `address fields` } from "lib/common.stm"

schema customer_target (note "Normalized customer table") {
  customer_id  UUID         (pk, required)
  name         VARCHAR(200) (required)
  ...`address fields`
  ...`audit timestamps`
}
```

Now, if the address format changes (say, `postal_code` needs to be `STRING(30)` for international codes), you change it once in `common.stm` and every schema that spreads `` `address fields` `` picks up the change.

---

## Key Takeaways

1. **Fragments** define reusable field groups, spread with `...`. Extract them when 3+ fields repeat across 2+ schemas.
2. **Named transforms** define reusable transformation logic, also spread with `...`.
3. **Imports** pull named definitions from other files — any named definition can be imported.
4. **Definition names must be unique** across the entire workspace, even across types.
5. A **platform entry point** file imports key definitions for platform-wide lineage traversal.
6. The agent helps identify reuse opportunities, maintain cross-file consistency, and navigate the workspace.

---

## Hands-On Check

Use the corpus files that actually ship with the repo:

1. Open `examples/lib/common.stm` and identify the reusable fragments.
2. Open `examples/namespaces/ns-platform.stm` and look for where shared definitions are reused.
3. Notice that the file also contains namespace-qualified references. Treat those as an advanced extension on top of the same core ideas: named definitions, imports, reuse, and lineage.

The goal here is not to master namespaces yet. The goal is to recognize reuse patterns in real files.

---

**Next:** [Lesson 05 — Mapping Blocks: Declaring Flow, Not Writing Code](05-mappings.md) — the heart of Satsuma: expressing how data moves from source to target.
