
### Conventions & Rules

The EBNF tells you *what parses*. This section tells you **how to use it well**.

```markdown
# Satsuma Conventions

## Three delimiters, three jobs
( ) = metadata      { } = structural content      " " = natural language

## Metadata tokens (in parens)
pk, required, unique, indexed, pii, encrypt, encrypt AES-256-GCM,
default val, enum {a, b, c}, format email, ref table.field,
note "...", xpath "...", namespace prefix "uri", filter COND

## Reserved keywords
schema, fragment, mapping, transform, note,
source, target, import, from, record, list_of, each, flatten, namespace

## Naming convention
Prefer lowercase snake_case for schemas, namespaces, and fields.
This avoids backtick quoting: `order_headers` not `order-headers`.
Backticks are only needed when a name contains characters outside [a-z0-9_-]:
  schema `order-headers` { ... }       // kebab-case — needs backticks
  source { `raw::crm-contacts` }       // backtick the unsafe segment only

## Path syntax — :: vs .
:: separates namespace from schema. . separates schema from field.
Never use :: to join schema to field. Namespaces are optional.
  namespace::schema                      // schema in a namespace
  namespace::schema.field                // field on a namespaced schema
  namespace::schema.field.nested_child   // nested record field
  schema.field                           // field (no namespace)
  .field                                 // relative field inside each/flatten
  ^.field                                // parent escape inside each/flatten (ADR-053)
  $.field                                // absolute from schema root inside each/flatten (ADR-053)

Cross-namespace references:
  source { raw::customers }
  target { mart::dim_customer }
  import { raw::customers, mart::dim_customer } from "platform.stm"
  schema mrr (metric, metric_name "MRR", source raw::orders, grain monthly) { ... }

## Import reachability
Imports are selective, not whole-file:
  import { customers } from "crm.stm"
brings `customers` into scope together with only the exact transitive
dependencies `customers` requires. It does NOT bring every other
definition from `crm.stm` into scope.

Workspace scope is also file-based everywhere:
  - CLI commands operate on entry files, not directories
  - IDE/LSP features for an open file use only that file's import-reachable graph
  - the surrounding folder is never an implicit merged scope

## Fragment spreads in a schema body
A spread contributes only the names the body has not already declared. An
explicit declaration shadows the fragment's field of the same name — the
body's type, constraints and note stand, and the field exists once, not twice:
  fragment meta { load_ts TIMESTAMPTZ  batch_id STRING(36) }
  schema contact {
    id       STRING(10)
    load_ts  TIMESTAMPTZ (pk)   // this one stands
    ...meta                     // contributes batch_id only
  }
`contact` has three fields. Where two spreads declare a name, the first wins.
Shadowing is whole-field, never a merge of record children.

## Source blocks — not just schema names
  source {
    schema_ref
    other_source (filter "status = completed")
    "Join @schema_ref to @other_source on @customer_id = @customer_id"
  }

## Transform bodies (combine with | inside { })
Pipe steps are natural-language instructions. Quotes are optional:
  trim | lowercase | validate_email | null_if_invalid
  "Trim" | "Lowercase" | "Validate email; if invalid, set null"
Both forms mean the same thing to tooling: they are NL for a human or agent to interpret.

Two special forms exist inside transform bodies:
  ...named_transform   (spread a named transform)
  map { src: "tgt", null: "default", _: "fallback" }   (discrete value mapping)
  map { < 1000: "low", < 5000: "mid", default: "high" }

Vocabulary conventions are concise shorthand for common operations:
  trim, lowercase, uppercase, title_case, null_if_empty, null_if_invalid
  drop_if_invalid, drop_if_null, warn_if_invalid, warn_if_null
  error_if_invalid, error_if_null
  coalesce(val), round(n), truncate(n), max_length(n)
  prepend("x"), append("x"), split("x") | first | last
  validate_email, to_e164, to_iso8601, to_utc, now_utc()
  pad_left(n, c), pad_right(n, c), replace(old, new), escape_html
  to_string, to_number, to_boolean, uuid_v5(ns, name)
  encrypt(algo, key), hash(algo), parse(fmt)
  "NL description — use @field_name for refs"

## Metric rules
  - A metric is a `schema` block with `(metric, ...)` metadata — NOT a separate block type
  - metric_name "..." carries the human-readable display name
  - source, grain, slice, filter are metric-specific metadata tags
  - Metric schemas are valid mapping sources and targets: a metric can feed a report or ML model
  - Complex computation logic goes in note { } as natural language inside the schema body
  - Measure additivity: additive (sum all dims), non_additive (never sum),
    semi_additive (sum across some dims only, e.g. balances)

## Consumer conventions
Reports and ML models are consumer schemas, not new block types:
  schema customer_dashboard (report, source {fact_orders, dim_customer}, tool looker) { ... }
  schema churn_model (model, source {training_set}) { ... }

## @ref in NL strings (CRITICAL)
ALWAYS use @ref for field and schema names inside "..." NL strings:
  -> total { "Sum @line_amount grouped by @order_id" }
  (note "Derived from @customer.email after dedup")
  "Join @crm_customers to @orders on @crm_customers.customer_id = @orders.customer_id"
This is NOT optional — tooling extracts @ref references for
deterministic lineage tracing. Bare names in NL are invisible to tools.

Backtick only the unsafe segments:
  "Look up @`order-headers`.status in the dim table"
  "Join @raw::`crm-contacts`.`customer-id` to @mart::dim_customer.customer_id"
@ref schemas are structural sources; lint --fix auto-adds undeclared
@ref schemas to the mapping source list.

## Comments
// info   //! warning   //? question/todo
(note "inline on a field or schema")  // in metadata parens
note { "standalone block" }           // top-level or in namespace
note { """multiline **Markdown**""" } // triple-quoted
```

---
