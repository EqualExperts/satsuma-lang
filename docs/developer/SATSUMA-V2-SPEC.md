# Satsuma v2 — Language Specification

**Version:** 2.0.0-draft
**Date:** 2026-03-18

---

## 1. Design Philosophy

Satsuma is a concise notation for describing data schemas, mappings, and transformations. It is designed to be read and written by both humans and LLMs.

### Principles

1. **The parser is an LLM.** Structure exists to delineate intent and scope — not to be exhaustively parseable by a formal grammar. Ambiguity that a competent human can resolve is acceptable.
2. **Natural language is a first-class citizen.** Complex transform logic belongs in quoted English, not in a pseudo-programming language.
3. **Three delimiters, three jobs.** `( )` for metadata, `{ }` for structural content, `" "` for natural language. Every use of a delimiter should fit exactly one of these roles.
4. **Token-efficient.** Eliminate ceremony. If something can be inferred, don't require it.
5. **Extensible without grammar changes.** New vocabulary tokens (like `scd`, `datavault`, `hub`) are interpreted by the LLM, not reserved by the language.

---

## 2. Lexical Rules

### 2.1 Delimiters

| Delimiter | Role | Contains |
|-----------|------|----------|
| `( )` | Metadata / annotations | Key-value pairs, flags, notes about the preceding element |
| `{ }` | Structural content | Fields, arrows, map entries, pipe chains, child blocks |
| `" "` | Natural language | Human-readable descriptions, transform logic, documentation |

These roles are **mutually exclusive**. Metadata never appears in `{ }`. Structural children never appear in `( )`. Natural language always uses `" "`.

Metadata blocks `( )` may span multiple lines for readability — especially when they contain long notes or many tokens.

#### Comma policy

All comma-separated list constructs follow one rule: **a trailing comma after the last entry is allowed; a comma with nothing before it is an error.** This applies uniformly to metadata entries, `enum { }` and `slice { }` bodies, `map { }` entries, `import { }` name lists, and `source`/`target` entries. So `(pk, required,)` and `import { a, b, } from "x"` are valid, while `(,)` and `import { } from "x"` are errors. `source` and `map` blocks additionally allow the separating commas to be omitted between entries (entries are newline-separated in practice); metadata, `enum`, `slice`, and `import` lists require them.

### 2.2 Strings and Quoting

- **Double quotes** `" "` — natural language strings. Always double quotes. Escape inner double quotes with `\"`.
- **Triple double quotes** `""" """` — multiline natural language with Markdown support. No escaping needed for inner `"`, including at the end of the content (`"""He said "hi""""` is valid). The one limitation: content cannot *end* with three or more consecutive quotes, since that run is indistinguishable from the closing delimiter. Use for notes with headings, bold, lists, or multi-paragraph content. Leading indentation from the content is preserved as-is.
- **Backticks** `` ` ` `` — identifiers and names that aren't bare-safe. Used for block labels containing special characters (spaces, dots, hyphens) and for field identifiers with special characters.
- **`@` prefix** — structural cross-references in NL text. `@customers.email` references a schema field. Required inside NL strings for tooling to detect refs; optional but allowed everywhere else.

**Two quoting rules:**
- Backticks for names: bare names work when matching `[a-zA-Z_][a-zA-Z0-9_-]*`, except that a bare name may not *end* with a hyphen (so `a->b` always reads as an arrow, never as the name `a-` followed by `>`). Everything else gets backticks.
- Double quotes for prose: NL content uses `"..."` or `"""..."""`.

```
schema `My Schema` { ... }           // backtick for name with spaces
`Lead_Source_Detail__c` STRING       // backtick for special-char field identifier
"Look up @customer_id in the dim"    // @ref inside NL string
"Short note — single line"           // single-line string
"""                                  // multiline string with Markdown
# Heading
Some **bold** text and a list:
- Item one
- Item two
"""
```

### 2.3 Block Labels

Block labels (the name after a keyword) use **backticks** when they contain special characters, or are bare identifiers otherwise:

```
schema customers { ... }
schema `order-headers-parquet` { ... }
fragment `US Address` { ... }
```

### 2.4 Comments

| Syntax | Meaning | Behaviour |
|--------|---------|-----------|
| `//` | Comment | Author-side. Stripped by tooling. Not exported. |
| `//!` | Warning | Flags a known issue or risk. May be surfaced by tooling. |
| `//?` | Question/TODO | Open question. May be surfaced by tooling. |

Comments run to end of line. There are no block comments.

### 2.5 Operators

Whitespace around `->` is optional: `a->b`, `a-> b`, `a ->b`, and `a -> b` are all the same arrow.

| Operator | Meaning |
|----------|---------|
| `->` | Maps source to target |
| `->` (no left side) | Computed/derived target field |
| `\|` | Pipeline step separator |
| `...` | Spread/expand a fragment or named transform |
| `:` | Separator in map entries |

### 2.6 Reserved Keywords

These keywords introduce structural blocks and are strongly discouraged as bare identifiers:

`schema` `fragment` `mapping` `transform` `source` `target` `map` `record` `list_of` `each` `flatten` `note` `import`

`each` and `flatten` are only valid inside mapping bodies. `record` and `list_of` are type keywords used in field declarations.

**Parser enforcement note (sl-kh05):** The tree-sitter grammar enforces keyword exclusion only where structural ambiguity would arise. In practice, `note` is rejected as a field name (because the grammar interprets it as the start of a note block), but most other keywords are currently accepted as schema names and field names. Using reserved keywords as identifiers is strongly discouraged because it produces confusing output and may be rejected in future parser versions. Tooling should treat keyword identifiers as user errors.

### 2.7 Vocabulary Tokens

These are **not reserved** — they are context-dependent tokens interpreted by the LLM. They can appear in `( )` metadata or as pipeline steps. This list is open-ended:

- **Constraints:** `pk`, `required`, `unique`, `indexed`, `pii`, `encrypt`
- **Types/formats:** `enum`, `default`, `format`, `ref`
- **Operations:** `filter`, `join`, `coalesce`, `trim`, `lowercase`, `uppercase`, `round`
- **Domain:** `xpath`, `namespace`, `datavault`, `scd`, `hub`, `satellite`

New vocabulary tokens can be introduced at any time without language changes.

### 2.8 Definition Uniqueness

All named definitions — `schema`, `mapping`, `fragment`, and `transform` — share a single name space. **No two definitions of any kind may have the same name**, even if they are different entity types. For example, a schema named `customer` and a mapping named `customer` is an error.

This rule applies across files: when multiple `.stm` files are validated together, all names across all files must be unique.

Anonymous mappings (those without a name) are exempt from this rule.

> **Future**: The `namespace` block (see `features/15-namespaces/PRD.md`) will scope definitions so that the same base name can exist in different namespaces. Uniqueness will then be enforced per-namespace rather than globally.

---

## 3. Schema Blocks

A schema block declares the structure of a data source or target. Satsuma v2 uses a single `schema` keyword — there is no `table`, `message`, `source`, or `target` distinction at the schema level.

### 3.1 Basic Structure

```
schema <name> (<metadata>) {
  <field declarations>
}
```

Example:

```
schema customers (format parquet) {
  customer_id    UUID       (pk)
  name           VARCHAR(200) (required)
  email          VARCHAR(255) (format email, pii)
  status         VARCHAR(20)  (enum {active, suspended, closed})
  created_at     TIMESTAMPTZ  (required)
}
```

### 3.2 Field Declarations

A field is declared as:

```
<name>  <type>  (<metadata>)
```

- **Name** — bare identifier or backtick-quoted.
- **Type** — a vocabulary token (interpreted by the LLM, not formally validated). Common types: `STRING`, `VARCHAR(n)`, `INT`, `DECIMAL(p,s)`, `BOOLEAN`, `DATE`, `TIMESTAMPTZ`, `UUID`, `JSON`, `TEXT`.
- **Metadata** — optional `( )` block with flags and key-value pairs.

**Type arguments vs metadata.** Parentheses attached *directly* to the type name (no whitespace) are type arguments and belong to the type: `DECIMAL(12,2)`, `VARCHAR(MAX)`. Parentheses separated from the type by whitespace are the field's metadata block: `UUID (pk)`. The two are easy to mix up:

- `customer_id UUID(pk)` parses cleanly but means "a type called `UUID(pk)`" — the `pk` constraint is *not* metadata. Tooling flags known constraint tokens inside type arguments (`constraint-in-type-args` warning).
- `amount DECIMAL (12,2)` is a parse error — numeric type arguments must attach to the type with no space.

### 3.3 Nested Structures: `record` and `list_of`

Use `record` for a single nested structure and `list_of record` for a repeated nested structure. The unified field declaration pattern is:

```
NAME [TYPE] [(metadata)] [{body}]
```

Where TYPE can be:
- A scalar type: `STRING`, `DECIMAL(12,2)`, etc.
- `record` — single nested structure
- `list_of record` — list of structured elements
- `list_of TYPE` — scalar list (list of primitives)

```
schema order {
  order_id     STRING (pk)
  customer record {
    id           STRING
    email        STRING (pii)
  }
  line_items list_of record {
    sku          STRING (required)
    quantity     INT
    unit_price   DECIMAL(12,2)
  }
}
```

`record` and `list_of record` can be nested to any depth. Metadata goes in `( )` between the type (or name) and `{ }`.

**Line and omission rules.** The unified pattern is positional, so three constraints keep it unambiguous:

- The TYPE (and `record` / `list_of`) must appear on the **same line** as the field name. A bare name on one line followed by a word on the next line is two (invalid) fields, never one field whose type wrapped.
- TYPE may be omitted only when a metadata block is present (`legacy_flag (deprecated)`). A bare name with neither type nor metadata is an error.
- A braced body always requires `record` or `list_of record` before it; `customer { ... }` without the keyword is an error.

**Scalar lists** — When a list contains primitives rather than structures, use `list_of TYPE` with no braces:

```
schema order {
  order_id     STRING (pk)
  promo_codes  list_of STRING
  tag_ids      list_of INT (classification "INTERNAL")
}
```

This keeps `list_of` as the single way to express repeated data. Scalar lists need no braces because there are no subfields to declare.

### 3.4 Notes

Notes are persistent documentation — they travel with the spec (exported to docs, Excel, etc.), unlike `//` comments which are stripped by tooling.

**On schemas and fields:** notes are metadata, so they go in `( )`. Use `"` for short notes, `"""` when you need Markdown:

```
schema legacy_customers (note "Primary customer store from 2005-2024.") {
  PHONE_NBR  VARCHAR(50) (
    note """
    No consistent format across the dataset:
    - **42%** `(555) 123-4567` — US with parentheses
    - **31%** `555.123.4567` — dot-separated
    - **15%** `+15551234567` — already E.164
    - **8%** `5551234567` — raw 10-digit
    - **4%** other (international, extensions, garbage)
    """
  )
}
```

**At top level or inside mapping blocks:** use `note { }` as a structural block. These often benefit from `"""` for rich Markdown content:

```
note {
  """
  # Legacy Customer Migration

  Part of **Project Phoenix** — decommissioning the legacy SQL Server 2008
  instance by Q2 2026.

  ## Constraints
  - Runs in **batches of 10,000** to prevent memory issues
  - Target enforces referential integrity — addresses created *before* customers
  """
}
```

This distinction follows the three-delimiter rule: `( )` for metadata *about* an element, `{ }` for standalone structural content.

### 3.5 Format-Specific Metadata

Format details go in `( )` on the schema or field:

```
schema commerce_order (format xml, namespace ord "http://example.com/commerce/order/v2", namespace com "http://example.com/common/v1") {
  Order record (xpath "/ord:OrderMessage/ord:Order") {
    OrderId    STRING (xpath "ord:OrderId")
    Channel    STRING (xpath "ord:Channel")
  }
}
```

### 3.6 Fragments

A fragment is a reusable set of field declarations. Fragments are structural templates — they stamp out their fields wherever they are spread.

```
fragment `address fields` {
  street_line_1   VARCHAR(200)
  street_line_2   VARCHAR(200)
  city            VARCHAR(100)
  state_province  VARCHAR(50)
  postal_code     VARCHAR(20)
  country_code    CHAR(2)
}

schema customers {
  customer_id   UUID (pk)
  ...address fields
}
```

The spread `...address fields` inlines all fields from the fragment into the schema.

---

## 4. Mapping Blocks

A mapping block describes how data flows from one or more sources to a target.

### 4.1 Basic Structure

```
mapping <name> {
  source { <schema references> }
  target { <schema reference> }

  <arrow declarations>
}
```

The `source` and `target` sub-blocks reference previously declared schemas by name (optionally backtick-quoted when the name contains special characters). The mapping name is optional.

An empty mapping body (`mapping m { }`) is valid — like an empty schema or transform, it is a legal skeleton while a spec is being authored.

### 4.2 Arrow Declarations

An arrow maps one or more source fields to a target field:

```
source_field -> target_field
source_a, source_b -> target_field
```

#### Multi-source arrows

When a target field derives from multiple source fields, list the sources separated by commas:

```
first_name, last_name -> full_name { "Concatenate with space" }
city, state, zip -> address { "Format as city, state zip" }
orders.amount, orders.tax -> total (derived) { "Sum amount and tax" }
```

Each source is a standard source path (bare field, schema-qualified, or namespace-qualified). The comma separator is unambiguous because metadata uses `( )` delimiters, not commas at the arrow level.

Multi-source arrows appear in lineage as one edge per source field, all pointing to the same target.

#### Direct mapping (no transform)

```
Id -> opp_key
AccountId -> account_key
```

#### With transform pipeline

```
EMAIL_ADDR -> email { trim | lowercase | validate_email | null_if_invalid }
```

#### With natural language transform

```
PHONE_NBR -> phone {
  "Extract digits. If 10 digits assume US +1. Format as E.164.
   If unparseable, set null and log warning."
}
```

#### Mixed pipeline (mechanical + NL)

```
Amount -> amount_usd {
  "Multiply by rate from currency_rates lookup using CurrencyIsoCode"
  | round(2)
}
```

The **first `"..."` in an arrow's `{ }`** is implicitly the transform description. Additional NL strings can appear after pipes.

#### Computed/derived fields (no source)

When the target field has no single source field, omit the left side of the arrow:

```
-> display_name {
  "If CUST_TYPE is null or 'R', concat and trim FIRST_NM + LAST_NM.
   Otherwise use COMPANY_NM."
}

-> migration_timestamp { now_utc() }
```

#### Arrow metadata

Use `( )` on an arrow for metadata (notes, conditions, flags):

```
CUST_ID -> customer_id (note "Deterministic UUID from legacy ID") {
  uuid_v5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", CUST_ID)
}
```

### 4.3 Value Maps

Use `map { }` for discrete value mappings. The `:` separates input from output. Output values are usually quoted; a bare (unquoted) value extends to the end of its line, so entries can be newline-separated without commas. Two entries on the *same* line must be comma-separated — `R: retail B: biz` without a comma is an error.

```
CUST_TYPE -> customer_type {
  map {
    R: "retail"
    B: "business"
    G: "government"
    null: "retail"
  }
}
```

#### Conditional maps

```
LOYALTY_POINTS -> loyalty_tier {
  map {
    < 1000: "bronze"
    < 5000: "silver"
    < 10000: "gold"
    default: "platinum"
  }
}
```

#### Wildcard default

Use `default` or `_` for the catch-all entry:

```
StageName -> pipeline_stage {
  map {
    Prospecting: "top_funnel"
    Qualification: "mid_funnel"
    "Value Prop": "mid_funnel"
    Closed_Won: "closed_won"
    Closed_Lost: "closed_lost"
    _: "unknown"
  }
}
```

### 4.4 Nested Mappings

When source and target have nested/repeated structures, use `each` blocks to iterate lists and nest the arrows:

```
each POReferences -> ShipmentHeader.asnDetails (
  note "Each PO reference generates one asnDetails entry.
        Line items and quantities correlated by position."
) {
  .REFNUM -> .orderNo { split("/") | first | to_number }

  each LineItems -> .items {
    .ITEMNO -> .item { trim | "Resolve via MFCS supplier item cross-reference" }
    Quantities.QUANTITY -> .unitQuantity {
      "Divide by 10000 (4 implied decimals), multiply by PO pack size from MFCS"
    }
  }
}
```

The `.` prefix indicates a field relative to the current nesting context. The `each` keyword introduces an iteration over a source list, producing elements in the target list.

**Where nested arrows are valid.** Arrows nest inside `each`/`flatten` blocks and inside the braced body of a plain `src -> tgt` arrow. The bodies of *computed* arrows (`-> tgt { ... }`) and *multi-source* arrows (`a, b -> tgt { ... }`) are transform pipelines, not nesting scopes — an arrow written there is a parse error, never silently treated as pipeline prose (it would otherwise vanish from lineage).

### 4.5 Fallback Sources

When a primary source may be null, specify a fallback within the transform:

```
LAST_MOD_DATE -> updated_at {
  parse("MM/DD/YYYY hh:mm:ss a") | to_utc
  | "If null, fall back to CREATED_DATE parsed as MM/DD/YYYY in UTC"
}
```

### 4.6 Flattening

Use a `flatten` block inside a mapping to lift each element of a source list into its own output row:

```
mapping `order lines` {
  source { `commerce_order` }
  target { `order_lines_parquet` }

  flatten Order.LineItems -> order_lines_parquet {
    .LineNumber -> line_number
    .SKU -> sku { trim | uppercase }
  }

  Order.OrderId -> order_id
  // ...
}
```

The `flatten` block iterates the source list and produces one target row per element. Fields outside the `flatten` block (like `Order.OrderId`) are repeated on every output row. Fields inside the block use `.` prefix to reference the current list element.

### 4.7 Multi-Source Joins

Describe joins in natural language within the source block or as a top-level NL string:

```
mapping `opportunity enrichment` {
  source {
    `sfdc_opportunity`,
    `sfdc_account`,
    "Join on sfdc_opportunity.AccountId = sfdc_account.Id"
  }
  target { `snowflake_opps` }
  // ...
}
```

### 4.8 Note Blocks

Use `note { }` at file top level or inside mapping blocks for contextual documentation:

```
mapping `customer migration` {
  note {
    "All timestamps assumed US Eastern unless otherwise noted.
     NULL handling: source NULLs preserved unless target has a stated default.
     Names are title-cased on migration."
  }

  source { `legacy_sqlserver` }
  target { `postgres_db` }
  // ...
}
```

---

## 5. Reusability

### 5.1 Fragments

Fragments declare reusable field sets for schemas. Like every definition block, a fragment (and a named transform, §5.2) accepts an optional `( )` metadata block between its label and body:

```
fragment `audit fields` {
  created_at    TIMESTAMPTZ (required)
  updated_at    TIMESTAMPTZ
  created_by    VARCHAR(100)
}
```

Spread into schemas with `...`:

```
schema users {
  user_id  UUID (pk)
  name     VARCHAR(200)
  ...audit fields
}
```

### 5.2 Named Transforms

Named transforms declare reusable transform logic for mapping pipelines:

```
transform `clean email` {
  "Trim whitespace, lowercase, validate RFC 5322 format, return null if invalid"
}

transform `to utc date` {
  parse("MM/DD/YYYY") | assume_utc | to_iso8601
}
```

Spread into pipelines with `...`:

```
EMAIL_ADDR -> email { ...clean email }
CREATED_DATE -> created_at { ...to utc date }
```

### 5.3 Imports

Import fragments, transforms, or schemas from other files:

```
import { `address fields`, `audit fields` } from "lib/common.stm"
import { `currency rates` } from "lookups/finance.stm"
```

Import syntax follows the pattern `import { <names> } from "<path>"`. Paths are resolved relative to the importing file. Importing `X` from another file brings `X` into scope together with the exact transitive dependencies `X` requires. It does **not** bring every other definition from that file into scope.

#### Import Scoping

Satsuma uses **explicit import scoping**: a symbol is only in scope within a file if it appears in that file's import graph (directly imported or transitively reachable via imported symbols' own dependencies). Symbols that exist in the same workspace directory but are not reachable via imports are **not** in scope. Importing one symbol from a file does **not** bring every other definition from that file into scope.

Tooling must respect this boundary:
- Navigation features (go-to-definition, find-references, completions, rename) resolve symbols only within the import-reachable file set of the active file.
- Editor diagnostics and semantic analysis use the same import-reachable file set; they do not treat the surrounding directory or workspace folder as an implicit merged scope.
- A reference to a symbol that exists in the workspace but is not reachable via imports is a semantic error. Tooling should suggest the exact `import` statement needed to bring the symbol into scope.
- The workspace visualisation and field-lineage traces start from a specific entry file and follow its import graph, not the entire directory tree.

The entry file for platform-wide lineage analysis is the file that imports from all top-level pipeline files (see `CLAUDE.md` for the platform entry point pattern).

---

## 6. Metric Schemas

A metric schema declares a business metric: what it measures, where the data comes from, and how it can be sliced. Metrics are consumers of schemas — they appear at the end of a lineage graph, not in the middle.

Metrics are `schema` blocks decorated with the `metric` vocabulary token in the metadata block. This is consistent with how `report` and `ml_model` schemas are declared — there is no separate `metric` keyword. Data flow *into* a metric is expressed via `mapping` blocks, not embedded in the schema declaration.

### 6.1 Basic Structure

```
schema <name> (
  metric,
  metric_name <display_label>?,
  <additional metadata tokens>
) {
  <field declarations>
  <note blocks>
}
```

- **name** — bare identifier or backtick-quoted string.
- **`metric`** — vocabulary token in the metadata block that marks this schema as a metric.
- **`metric_name`** — optional `tag_with_value` token providing the short business label (e.g. `metric_name "MRR"`). This is the label shown in dashboards and documentation.
- **additional metadata** — `grain`, `source`, `slice`, and `filter` tokens (all optional).
- **body** — measure field declarations and notes. No arrows.

The data pipeline that populates the metric is expressed as a separate `mapping` block targeting the metric schema — not embedded in the metric declaration itself.

### 6.2 Metric Metadata Tokens

These vocabulary tokens go in the `( )` metadata block alongside `metric`:

| Token | Meaning | Example |
|-------|---------|---------|
| `metric` | Marks this schema as a business metric | `metric` |
| `metric_name` | Short business display label | `metric_name "MRR"` |
| `source` | Schema(s) the metric is derived from | `source fact_orders` or `source {fact_orders, dim_customer}` |
| `grain` | The time or dimensional grain | `grain monthly`, `grain daily` |
| `slice` | Dimensions the metric can be cut by | `slice {region, product_line, segment}` |
| `filter` | Row-level filter applied before aggregation | `filter "status = 'active'"` |

### 6.3 Measure Fields

Fields inside a metric body declare the numeric values the metric produces. The `measure` vocabulary token describes aggregation behaviour:

| Token | Meaning |
|-------|---------|
| `measure additive` | Can be summed across all dimensions |
| `measure non_additive` | Cannot be summed (e.g. ratios, averages) |
| `measure semi_additive` | Can be summed across some dimensions but not others (e.g. balance at a point in time) |

### 6.4 Examples

**Simple revenue metric:**

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
    "Sum of active subscription amounts, normalized to monthly.
     Annual subscriptions divided by 12. Quarterly by 3.
     Excludes trials and churned subscriptions."
  }
}

mapping _mrr_pipeline {
  source { fact_subscriptions }
  target { monthly_recurring_revenue }

  Amount -> value { to_decimal(14,2) | "Normalize to monthly" }
}
```

**Multi-source metric with multiple measures:**

```satsuma
schema customer_lifetime_value (
  metric,
  metric_name "CLV",
  source {fact_orders, dim_customer},
  slice {acquisition_channel, segment, cohort_year}
) {
  value              DECIMAL(14,2)  (measure non_additive)
  order_count        INTEGER        (measure additive)
  avg_order_value    DECIMAL(12,2)  (measure non_additive)

  note {
    """
    Average revenue per customer over their entire tenure.
    Calculated as: total_revenue / months_active * expected_lifetime_months.
    Expected lifetime derived from cohort survival curves.
    """
  }
}
```

**Metric with no display label:**

```satsuma
schema churn_rate (
  metric,
  grain monthly,
  slice {segment, region}
) {
  value  DECIMAL(5,4)  (measure non_additive)
}
```

### 6.5 Metric Schemas vs Regular Schemas

- Metric schemas **are schemas** — they share the definition namespace with all other schemas and can appear as `target` in mapping blocks.
- Metric schemas are **not valid sources** — mapping blocks should not use a metric schema as a `source`. By convention, data flows *into* metrics; nothing flows *out*.
- The `source`, `grain`, `slice`, and `filter` tokens are vocabulary tokens interpreted by the LLM or downstream tooling — the parser captures them structurally but does not enforce them.
- The `satsuma metric <name>` command identifies schemas decorated with the `metric` metadata token. It is not a distinct block type.

---

## 7. Vocabulary Conventions

Vocabulary tokens are **not keywords** — they are interpreted by the LLM based on context. This section documents common conventions.

### 7.1 Field Metadata Tokens (used in `( )`)

| Token | Meaning | Example |
|-------|---------|---------|
| `pk` | Primary key | `(pk)` |
| `required` | Must not be null | `(required)` |
| `unique` | Values must be unique | `(unique)` |
| `indexed` | Should have an index | `(indexed)` |
| `pii` | Personally identifiable information | `(pii)` |
| `encrypt` | Must be encrypted | `(encrypt AES-256-GCM)` |
| `enum` | Restricted value set | `(enum {a, b, c})` |
| `default` | Default value | `(default 0)` |
| `format` | Data format constraint | `(format email)` |
| `ref` | Foreign key reference | `(ref addresses.id)` |
| `xpath` | XML path expression | `(xpath "ord:OrderId")` |
| `namespace` | XML namespace declaration | `(namespace ord "http://...")` |
| `filter` | Row-level filter condition | `(filter QUAL == "ON")` |
| `note` | Persistent documentation | `(note "Converted at daily spot rate")` |

**Tag value boundaries.** A bare (unquoted) tag value extends along the tag's line only, and never includes the structural entry keywords (`note`, `enum`, `slice`) or the constraint flag tokens (`pk`, `required`, `unique`, `indexed`, `pii`, `encrypt`). This makes a forgotten comma a parse error rather than a silent misread: `(pk note "x")`, `(required pii)`, and a flag starting the next line all fail loudly instead of folding the flag into the previous value. To use a constraint flag word *as* a value, quote it: `(classification "pii")`.

### 7.2 Vocabulary Conventions (pipe step shorthand)

All pipe step content — bare tokens, quoted strings, and map literals — is natural language interpreted by a human or LLM. The following table lists **vocabulary conventions**: commonly used bare tokens that teams adopt as shorthand for well-understood operations. They are not keywords or reserved words; the parser treats them identically to any other bare token. Their meaning is defined by convention and by the implementing system, not by the Satsuma grammar.

| Token | Conventional meaning |
|-------|---------------------|
| `trim` | Strip whitespace |
| `lowercase` / `uppercase` | Case conversion |
| `coalesce(val)` | Replace null with val |
| `round(n)` | Round to n decimal places |
| `split(sep)` | Split string on separator |
| `first` / `last` | Take first/last element |
| `to_utc` | Convert to UTC |
| `to_iso8601` | Format as ISO 8601 |
| `parse(fmt)` | Parse string with format |
| `null_if_empty` | Convert empty string to null |
| `null_if_invalid` | Convert invalid value to null |
| `drop_if_invalid` | Drop the record if value is invalid |
| `drop_if_null` | Drop the record if value is null |
| `warn_if_invalid` | Log a warning if value is invalid |
| `warn_if_null` | Log a warning if value is null |
| `error_if_invalid` | Fail the pipeline if value is invalid |
| `error_if_null` | Fail the pipeline if value is null |
| `validate_email` | Validate email format |
| `now_utc()` | Current UTC timestamp |
| `title_case` | Convert to title case |
| `escape_html` | Escape HTML entities |
| `truncate(n)` | Truncate to n characters |
| `to_number` | Convert to numeric type |
| `prepend(str)` | Prefix a string |
| `max_length(n)` | Enforce maximum length |

#### Error-handling convention

The `null_if_*`, `drop_if_*`, `warn_if_*`, and `error_if_*` tokens follow a consistent `<action>_if_<condition>` pattern for expressing fallback and error-handling intent in pipelines:

- **`null_if_*`** — replace the value with null (record survives).
- **`drop_if_*`** — discard the entire record.
- **`warn_if_*`** — log a warning and pass the value through.
- **`error_if_*`** — halt the pipeline (fail loudly).

These are vocabulary tokens, not reserved keywords. Implementations decide what "log a warning" or "halt" means concretely. Common conditions include `null`, `invalid`, and `empty`, but the pattern is open — e.g. `drop_if_duplicate` or `warn_if_stale` are valid by convention.

```
EMAIL_ADDR -> email { trim | lowercase | validate_email | drop_if_invalid }
TAX_ID -> tax_id { error_if_null }
PHONE_NBR -> phone { "Parse as E.164" | warn_if_invalid }
```

### 7.3 Domain Tokens

These are freely extensible. Common domain-specific tokens:

- **Data Vault:** `datavault`, `hub`, `satellite`, `link`, `scd`, `hashkey`
- **Streaming:** `watermark`, `late_arrival`, `dedup`
- **Governance:** `classification`, `retention`, `lineage`

---

## 8. Complete Examples

### 8.1 Database to Database — Legacy Customer Migration

```
// Satsuma v2 — Legacy Customer Migration

import { `address fields` } from "../lib/common.stm"

note {
  """
  # Legacy Customer Migration

  Part of **Project Phoenix** — decommissioning the legacy SQL Server 2008
  instance by Q2 2026. Migrates customer records to a normalized PostgreSQL
  schema with proper typing, encryption, and referential integrity.

  ## Constraints
  - Runs in **batches of 10,000** to prevent memory issues
  - Target enforces referential integrity — addresses created *before* customers
  - Estimated total: **2.4M records**, ~180 batches

  ## Dependencies
  - Address normalization service must be running
  - Secrets Manager: `tax_encryption_key` must be provisioned
  - Profanity filter word list v3.2 must be loaded
  """
}


// --- Source ---

schema legacy_sqlserver (
  note "CUSTOMER table — SQL Server 2008. No app-level validation until 2018."
) {
  CUST_ID         INT            (pk)                          // sequential, gaps from deletions
  CUST_TYPE       CHAR(1)        (enum {R, B, G}, default R)   //! some records have NULL
  FIRST_NM        VARCHAR(100)                                 // retail customers only
  LAST_NM         VARCHAR(100)                                 // retail customers only
  COMPANY_NM      VARCHAR(200)                                 // business/government only
  EMAIL_ADDR      VARCHAR(255)   (pii)                         //! not validated — contains garbage
  PHONE_NBR       VARCHAR(50) (
    note """
    No consistent format across the dataset:
    - **42%** `(555) 123-4567` — US with parentheses
    - **31%** `555.123.4567` — dot-separated
    - **15%** `+15551234567` — already E.164
    - **8%** `5551234567` — raw 10-digit
    - **4%** other (international, extensions, garbage)
    """
  )
  ADDR_LINE_1     VARCHAR(200)
  ADDR_LINE_2     VARCHAR(200)
  CITY            VARCHAR(100)
  STATE_PROV      VARCHAR(50)                                  //! full names AND 2-char codes mixed
  ZIP_POSTAL      VARCHAR(20)
  COUNTRY_CD      CHAR(2)        (default US)
  CREDIT_LIMIT    DECIMAL(12,2)                                // NULL = no credit extended
  ACCOUNT_STATUS  CHAR(1)        (enum {A, S, C, D}, default A)
  CREATED_DATE    VARCHAR(10)                                  //! stored as MM/DD/YYYY string
  LAST_MOD_DATE   VARCHAR(20)                                  //! MM/DD/YYYY HH:MM:SS AM/PM
  TAX_ID          VARCHAR(20)    (pii, encrypt)                //! plaintext in legacy — SSN or EIN
  LOYALTY_POINTS  INT            (default 0)
  PREF_CONTACT    CHAR(1)        (enum {E, P, M, N}, default E)
  NOTES           VARCHAR(MAX)                                 // free-text, may contain profanity
}


// --- Target ---

schema postgres_db (note "Normalized customer schema — PostgreSQL 16") {
  customer_id              UUID           (pk, required)
  legacy_customer_id       INTEGER        (unique, indexed)
  customer_type            VARCHAR(20)    (enum {retail, business, government}, required)
  display_name             VARCHAR(200)   (required)
  first_name               VARCHAR(100)
  last_name                VARCHAR(100)
  company_name             VARCHAR(200)
  email                    VARCHAR(255)   (format email, pii)
  phone                    VARCHAR(20)    (format E.164)
  address_id               UUID           (ref addresses.id)
  credit_limit_cents       BIGINT         (default 0)
  status                   VARCHAR(20)    (enum {active, suspended, closed, delinquent}, required)
  created_at               TIMESTAMPTZ    (required)
  updated_at               TIMESTAMPTZ
  tax_identifier_encrypted TEXT           (pii, encrypt AES-256-GCM)
  loyalty_tier             VARCHAR(20)    (enum {bronze, silver, gold, platinum})
  preferred_contact_method VARCHAR(20)    (enum {email, phone, mail, none})
  notes                    TEXT
  migration_timestamp      TIMESTAMPTZ
}


// --- Mapping ---

mapping `customer migration` {
  note {
    "Mapping assumptions:
     - All timestamps assumed US Eastern unless otherwise noted
     - NULL handling: source NULLs preserved unless target has stated default
     - Names are title-cased on migration"
  }

  source { `legacy_sqlserver` }
  target { `postgres_db` }

  // --- Identifiers ---
  CUST_ID -> customer_id { uuid_v5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", CUST_ID) }
  CUST_ID -> legacy_customer_id

  // --- Customer Type ---
  CUST_TYPE -> customer_type {
    map {
      R: "retail"
      B: "business"
      G: "government"
      null: "retail"
    }
  }

  // --- Name Handling ---
  -> display_name {
    "If CUST_TYPE is null or 'R', trim and concat FIRST_NM + ' ' + LAST_NM.
     Otherwise, trim COMPANY_NM."
  }

  FIRST_NM   -> first_name    { trim | title_case | null_if_empty }
  LAST_NM    -> last_name     { trim | title_case | null_if_empty }
  COMPANY_NM -> company_name  { trim | null_if_empty }

  // --- Contact ---
  EMAIL_ADDR -> email { trim | lowercase | validate_email | null_if_invalid }

  PHONE_NBR -> phone {
    "Extract all digits. If 11 digits starting with 1, treat as US.
     If 10 digits, assume US country code +1. Format as E.164.
     For other patterns, attempt to determine country from COUNTRY_CD.
     If unparseable, set null and log warning with original value."
  }

  // --- Address (FK to separate table) ---
  -> address_id {
    "Create a record in the addresses table using ADDR_LINE_1, ADDR_LINE_2,
     CITY, STATE_PROV, ZIP_POSTAL, COUNTRY_CD. Normalize STATE_PROV to
     2-char code (handle full names). Deduplicate against existing addresses
     by normalized street + zip. Return the UUID of the new or existing record."
  }

  // --- Financial ---
  CREDIT_LIMIT -> credit_limit_cents { coalesce(0) | * 100 | round }

  // --- Status ---
  ACCOUNT_STATUS -> status {
    map { A: "active", S: "suspended", C: "closed", D: "delinquent" }
  }

  // --- Dates ---
  CREATED_DATE -> created_at { parse("MM/DD/YYYY") | assume_utc | to_iso8601 }

  LAST_MOD_DATE -> updated_at {
    parse("MM/DD/YYYY hh:mm:ss a") | to_utc | to_iso8601
    | "If null, fall back to CREATED_DATE parsed as MM/DD/YYYY in UTC"
  }

  // --- Security ---
  TAX_ID -> tax_identifier_encrypted { encrypt(AES-256-GCM, secrets.tax_encryption_key) }

  // --- Calculated ---
  LOYALTY_POINTS -> loyalty_tier {
    map {
      < 1000:  "bronze"
      < 5000:  "silver"
      < 10000: "gold"
      default: "platinum"
    }
  }

  PREF_CONTACT -> preferred_contact_method {
    map { E: "email", P: "phone", M: "mail", N: "none" }
  }

  // --- Text ---
  NOTES -> notes {
    "Filter profanity using corporate word list v3.2, replacing matches with asterisks"
    | escape_html
    | truncate(5000)
  }

  // --- Audit ---
  -> migration_timestamp { now_utc() }
}
```

### 8.2 EDI to JSON — ASN Shipment

```
// Satsuma v2 — EDI 856 → MFCS Shipment

note {
  """
  # EDI 856 → MFCS Shipment

  Transforms EDI 856 (DESADV) fixed-length ASN messages into
  MFCS JSON Shipment format for warehouse ingestion.
  Based on mapping specification v1.0 (18/11/2025).

  ## Open issues
  - `containers` array is **required** by MFCS schema but has
    **no source mapping** in the current EDI specification
  - `containerId` and `finalLocation` are required but unpopulated
  - Awaiting clarification from warehouse team (Jira: DWHT-2847)
  """
}


// --- Source ---

schema edi_desadv (
  format fixed-length,
  note "EDI 856 Despatch Advice — Fixed Length Format"
) {
  BeginningOfMessage record {
    DOCNUM      CHAR(35)                          // despatch advice number
    MESSGFUN    CHAR(3)                           // message function: 9 = Original
  }

  DateTime record {
    DATEQUAL    CHAR(3)                           // qualifier: 137 = document date/time
    DATETIME    CHAR(35)                          // date/time value
    DATEFMT     CHAR(3)                           // format: 102=CCYYMMDD, 203=CCYYMMDDHHMM
  }

  ShipmentRefs list_of record (filter SHPRFQUAL == "SRN") {
    SHPRFQUAL   CHAR(3)
    SHIPREF     CHAR(70)                          // shipment reference number
  }

  POReferences list_of record (filter REFQUAL == "ON") {
    REFQUAL     CHAR(3)
    REFNUM      CHAR(35)                          // PO Number + "/" + Dissection No
  }

  NameAddress record {
    PARTYQUAL   CHAR(3)                           // BY=Buyer, SU=Supplier
    PARTYID     CHAR(35)                          // 13-digit ANA number
  }

  LineItems list_of record {
    LINENUM     NUMBER(6)
    ITEMNO      CHAR(35)                          // product identifier
    ITEMTYPE    CHAR(3)                           // EN=EAN, UP=UPC12
  }

  Quantities list_of record (filter QUANTQUAL == "12") {    // only despatch quantities
    QUANTQUAL   CHAR(3)
    QUANTITY    NUMBER(15)                         //! 4 implied decimal places
  }
}


// --- Target ---

schema mfcs_json (format json, note "MFCS Shipment Ingestion Format") {
  ShipmentHeader record {
    toLocation            NUMBER(10)
    asnNo                 STRING(30)   (required)
    shipDate              DATE         (required)
    estimatedArrivalDate  DATE
    comments              STRING(2000)
    carrierCode           STRING(4)
    asnType               STRING(1)    (required)     // C=UCC-128, 0=ASN Shipment
    supplier              NUMBER(10)   (required)
    shipPayMethod         STRING(2)

    asnDetails list_of record {
      orderNo             NUMBER(12)   (required)
      notAfterDate        DATE

      containers list_of record (
        note """
        ## DATA GAP
        This entire array is **required** by the MFCS schema but has
        **no source data** in the current EDI 856 mapping.
        See Jira: DWHT-2847 for resolution status.
        """
      ) {
        containerId       STRING(30)   (required)     //! no source mapping
        finalLocation     NUMBER(10)   (required)     //! no source mapping
        items list_of record {
          item            STRING(25)
          unitQuantity    NUMBER(12,4)                 //! no source mapping
        }
      }

      items list_of record {
        item              STRING(25)
        unitQuantity      NUMBER(12,4)  (required)
        vpn               STRING(30)
        referenceItem     STRING(25)
      }
    }
  }
}


// --- Mapping ---

mapping `edi to mfcs` {
  source { `edi_desadv` }
  target { `mfcs_json` }

  // --- Header ---
  BeginningOfMessage.DOCNUM -> ShipmentHeader.asnNo { trim | max_length(30) }

  DateTime.DATETIME -> ShipmentHeader.shipDate {
    "Parse using sibling field DATEFMT: if 102 parse as CCYYMMDD,
     if 203 parse as CCYYMMDDHHMM. Output format: YYYY-MM-DD."
  }

  -> ShipmentHeader.asnType { "0" }    // default: ASN Shipment

  POReferences.REFNUM -> ShipmentHeader.toLocation {
    "Extract PO number from REFNUM (digits before '/').
     Look up the PO in MFCS to determine the delivery location."
  }

  POReferences.REFNUM -> ShipmentHeader.supplier {
    split("/") | first | to_number
    | "Validate supplier exists in MFCS PO table."
  }

  ShipmentRefs.SHIPREF -> ShipmentHeader.comments { prepend("Shipment reference number: ") }

  // --- Detail lines grouped by PO ---
  each POReferences -> ShipmentHeader.asnDetails (
    note "Each PO reference generates one asnDetails entry.
          Line items and quantities are correlated by position."
  ) {
    .REFNUM -> .orderNo { split("/") | first | to_number }

    each LineItems -> .items {
      .ITEMNO -> .item {
        trim
        | "Retrieve MFCS item number using the supplier's traded code
           from the MFCS supplier item cross-reference."
      }

      Quantities.QUANTITY -> .unitQuantity {
        "Divide by 10000 to account for 4 implied decimal places.
         Then multiply by PO pack size from MFCS (Action A-504).
         Pack size retrieved from MFCS PO line matching this item."
      }
    }
  }

  //! DATA GAP: containers required but no source data
  -> ShipmentHeader.asnDetails.containers {
    "Required by MFCS schema but no source data available in EDI 856.
     Options under discussion:
     1. Populate with a single placeholder container per order
     2. Request EDI 856 extension from suppliers
     3. Derive from warehouse receiving logic
     Blocked on: MFCS-2847"
  }
}
```

### 8.3 XML to Parquet — Commerce Orders

```
// Satsuma v2 — Order XML to Lakehouse Parquet

note {
  """
  # Order XML to Lakehouse Parquet

  Ingests canonical commerce order XML messages from the integration bus
  and lands two curated Parquet datasets:
  - `order_headers_parquet` at one row per order
  - `order_lines_parquet` at one row per line item

  The source XML is namespace-qualified and contains repeated discount
  fragments, optional loyalty identifiers, and mixed timestamp formats
  depending on upstream channel.
  """
}


// --- Source ---

schema commerce_order (
  format xml,
  namespace ord "http://example.com/commerce/order/v2",
  namespace com "http://example.com/common/v1",
  note "Canonical commerce order message"
) {
  Order record (xpath "/ord:OrderMessage/ord:Order") {
    OrderId           STRING       (xpath "ord:OrderId")
    Channel           STRING       (xpath "ord:Channel")
    OrderTimestamp    STRING       (xpath "ord:OrderTimestamp")
    CurrencyCode      STRING       (xpath "ord:Currency/com:Code")

    Customer record {
      CustomerId      STRING       (xpath "ord:CustomerId")
      Email           STRING       (xpath "ord:Email")
      LoyaltyTier     STRING       (xpath "ord:LoyaltyTier")
    }

    ShippingAddress record {
      CountryCode     STRING       (xpath "ord:CountryCode")
      RegionCode      STRING       (xpath "ord:RegionCode")
      PostalCode      STRING       (xpath "ord:PostalCode")
    }

    Totals record {
      SubtotalAmount  DECIMAL(12,2)  (xpath "ord:SubtotalAmount")
      TaxAmount       DECIMAL(12,2)  (xpath "ord:TaxAmount")
      TotalAmount     DECIMAL(12,2)  (xpath "ord:TotalAmount")
    }

    Discounts list_of record (xpath "ord:Discounts/ord:Discount") {
      DiscountCode    STRING       (xpath "ord:Code")
      DiscountAmount  DECIMAL(12,2) (xpath "ord:Amount")
      DiscountType    STRING       (xpath "ord:Type")
    }

    LineItems list_of record (xpath "ord:LineItems/ord:LineItem") {
      LineNumber      INT32        (xpath "ord:LineNumber")
      SKU             STRING       (xpath "ord:SKU")
      FulfillmentType STRING       (xpath "ord:FulfillmentType")
      Quantity        INT32        (xpath "ord:Quantity")
      UnitPrice       DECIMAL(12,2) (xpath "ord:UnitPrice")
      ExtendedAmount  DECIMAL(12,2) (xpath "ord:ExtendedAmount")
      TaxAmount       DECIMAL(12,2) (xpath "ord:TaxAmount")
      IsGift          BOOLEAN      (xpath "ord:IsGift")
    }
  }
}


// --- Targets ---

schema order_headers_parquet (format parquet, note "Curated order header dataset") {
  order_id             STRING         (pk)
  order_channel        STRING         (enum {web, mobile, store, marketplace}, required)
  order_timestamp_utc  TIMESTAMPTZ    (required)
  customer_id          STRING
  customer_email       STRING         (format email, pii)
  loyalty_tier         STRING         (enum {bronze, silver, gold, platinum})
  ship_country         STRING         (required)
  ship_region          STRING
  ship_postal_code     STRING
  currency_code        STRING         (required)
  subtotal_amount      DECIMAL(12,2)
  tax_amount           DECIMAL(12,2)
  total_amount         DECIMAL(12,2)  (required)
  discount_codes       JSON
  discount_total       DECIMAL(12,2)
  line_count           INT32
  ingest_date          DATE           (required)
}

schema order_lines_parquet (format parquet, note "Curated order line dataset") {
  order_id             STRING         (required)
  line_number          INT32          (required)
  sku                  STRING         (required)
  fulfillment_type     STRING         (enum {ship, pickup, digital, service})
  quantity             INT32          (required)
  unit_price           DECIMAL(12,2)
  extended_amount      DECIMAL(12,2)  (required)
  line_tax_amount      DECIMAL(12,2)
  is_gift              BOOLEAN
  currency_code        STRING         (required)
  order_channel        STRING         (required)
  customer_id          STRING
  ship_country         STRING
  ingest_date          DATE           (required)
}


// --- Mapping: Order Headers ---

mapping `order headers` {
  source { `commerce_order` }
  target { `order_headers_parquet` }

  Order.OrderId -> order_id
  Order.Channel -> order_channel { trim | lowercase }

  Order.OrderTimestamp -> order_timestamp_utc {
    "Parse either ISO-8601 with timezone or local store time in
     America/New_York depending on channel. Output UTC timestamp."
  }

  Order.Customer.CustomerId -> customer_id
  Order.Customer.Email -> customer_email { trim | lowercase | validate_email | null_if_invalid }
  Order.Customer.LoyaltyTier -> loyalty_tier { trim | lowercase | null_if_empty }

  Order.ShippingAddress.CountryCode -> ship_country { trim | uppercase }
  Order.ShippingAddress.RegionCode -> ship_region { trim | uppercase | null_if_empty }
  Order.ShippingAddress.PostalCode -> ship_postal_code { trim | null_if_empty }

  Order.CurrencyCode -> currency_code { trim | uppercase }

  Order.Totals.SubtotalAmount -> subtotal_amount
  Order.Totals.TaxAmount -> tax_amount
  Order.Totals.TotalAmount -> total_amount

  -> discount_codes {
    "Collect DiscountCode values from Order.Discounts preserving source order.
     Emit as a JSON array string. If no discounts, emit empty array."
  }

  -> discount_total {
    "Sum DiscountAmount across Order.Discounts for the current order.
     If no discounts, emit 0.00."
  }

  -> line_count {
    "Count Order.LineItems elements for the current order."
  }

  -> ingest_date { now_utc() | "Truncate to UTC calendar date YYYY-MM-DD." }
}


// --- Mapping: Order Lines (flattened) ---

mapping `order lines` {
  source { `commerce_order` }
  target { `order_lines_parquet` }

  flatten Order.LineItems -> order_lines_parquet {
    .LineNumber -> line_number
    .SKU -> sku { trim | uppercase }
    .FulfillmentType -> fulfillment_type { trim | lowercase }
    .Quantity -> quantity
    .UnitPrice -> unit_price
    .ExtendedAmount -> extended_amount
    .TaxAmount -> line_tax_amount
    .IsGift -> is_gift
  }

  Order.OrderId -> order_id
  Order.CurrencyCode -> currency_code { trim | uppercase }
  Order.Channel -> order_channel { trim | lowercase }
  Order.Customer.CustomerId -> customer_id
  Order.ShippingAddress.CountryCode -> ship_country { trim | uppercase }

  -> ingest_date { now_utc() | "Truncate to UTC calendar date YYYY-MM-DD." }
}
```

### 8.4 Salesforce to Snowflake — Opportunity Ingestion

```
// Satsuma v2 — Salesforce to Snowflake Pipeline

import { `sfdc standard types` } from "lib/sfdc_fragments.stm"
import { `currency rates` } from "lookups/finance.stm"

note {
  """
  # Salesforce to Snowflake Pipeline

  Maps Sales Cloud `Opportunity` and `Account` objects into the
  `ANALYTICS.RAW_SFDC` schema.

  ## Sync Strategy
  - **Incremental:** Uses `SystemModStamp` to pull changes every 15 minutes.
  - **Hard Deletes:** Captured via the `isDeleted` flag in SFDC.
  """
}


// --- Sources ---

schema sfdc_opportunity (note "SFDC Opportunity Object") {
  Id                          ID             (pk)
  Name                        STRING(120)    (required)
  AccountId                   ID             (ref sfdc_account.Id)
  Amount                      CURRENCY(18,2)
  CurrencyIsoCode             STRING(3)      (default "USD")
  StageName                   PICKLIST       (enum {Prospecting, Qualification, "Value Prop", Closed_Won, Closed_Lost})
  CloseDate                   DATE           (required)
  Probability                 PERCENT(3,0)
  `Lead_Source_Detail__c`     STRING(255)
  `ARR_Override__c`           CURRENCY(18,2)  //! manual override used by Finance
  SystemModStamp              DATETIME       (required)
}

schema sfdc_account (note "SFDC Account Object") {
  Id              ID             (pk)
  Name            STRING(255)    (required)
  Type            PICKLIST       (enum {Customer, Prospect, Partner, Competitor})
  BillingCountry  STRING(80)
}


// --- Target ---

schema snowflake_opps (note "FACT_OPPORTUNITIES — Snowflake Analytics") {
  opp_key          VARCHAR(18)    (pk)
  account_key      VARCHAR(18)    (indexed)
  opportunity_name VARCHAR(120)
  amount_raw       NUMBER(18,2)
  amount_usd       NUMBER(18,2)   (note "Converted at daily spot rate")
  arr_value        NUMBER(18,2)   (required)
  pipeline_stage   VARCHAR(50)    (enum {top_funnel, mid_funnel, closed_won, closed_lost})
  is_closed        BOOLEAN
  close_date       DATE
  source_system    VARCHAR(10)    (default "SFDC")
  ingested_at      TIMESTAMP_NTZ
}


// --- Mapping ---

mapping `opportunity ingestion` {
  source { `sfdc_opportunity` }
  target { `snowflake_opps` }

  // --- Direct identifiers ---
  Id -> opp_key
  AccountId -> account_key
  Name -> opportunity_name

  // --- Financial ---
  Amount -> amount_raw { coalesce(0) }

  Amount -> amount_usd {
    "Multiply by rate from `currency rates` lookup using CurrencyIsoCode"
    | round(2)
  }

  `ARR_Override__c` -> arr_value {
    "Use ARR_Override__c if not null, otherwise fall back to Amount"
    | coalesce(0)
  }

  // --- Stage normalization ---
  StageName -> pipeline_stage {
    map {
      Prospecting:  "top_funnel"
      Qualification: "mid_funnel"
      "Value Prop":  "mid_funnel"
      Closed_Won:    "closed_won"
      Closed_Lost:   "closed_lost"
      _:             "unknown"
    }
  }

  -> is_closed {
    "True if StageName is 'Closed_Won' or 'Closed_Lost', false otherwise."
  }

  CloseDate -> close_date

  // --- Metadata ---
  SystemModStamp -> ingested_at { to_utc }
}
```

---

## 8. Summary of Changes from v1

| v1 | v2 | Rationale |
|----|-----|-----------|
| `[pk, required]` bracket tags | `(pk, required)` parentheses | `()` = metadata, `[]` freed |
| `@xpath(...)`, `@format(...)` annotations | `(xpath ..., format ...)` in metadata | Unified in `()` |
| `table`, `message`, `source`, `target` keywords | Single `schema` keyword | Simpler — role is contextual |
| `STRUCT { }` / `ARRAY { }` | `Name record { }` / `Name list_of record { }` | Unified field syntax: `NAME TYPE (meta) {body}` |
| `nl("...")` function | Bare `"..."` in `{ }` | NL is first-class |
| `: transform` after arrow | `{ transform }` after arrow | Consistent — `{}` holds content |
| `when/else` clauses | `map { }` with conditions or NL | Simpler, more flexible |
| `fallback` keyword | NL fallback description | Let the LLM interpret |
| `[enum: {a, b}]` | `(enum {a, b})` | Braces for value sets, parens for metadata |
| `note '''...`''` triple-quoted | `(note "...")` or `(note """...""")` | Notes are metadata; `"""` for Markdown |
| `integration { }` block | `note { """...""" }` block | Structured, consistent with delimiter rules |
| `=> target` computed fields | `-> target` (no left side) | Consistent arrow syntax |
