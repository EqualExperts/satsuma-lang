# Apache Avro Conventions

## Why This Format Needs Special Handling

Apache Avro is a modern, well-specified serialisation framework widely used in Kafka-based event streaming pipelines and Hadoop ecosystems. Unlike legacy formats, the difficulty is not missing specification but structural mismatches with Satsuma's type system, and the operational coupling between schema definitions and runtime infrastructure:

- **Union types for nullability** — Avro has no optional keyword. An optional field is expressed as a union: `["null", "string"]`. The null variant must be first, and a `default: null` is required for backward compatibility. Satsuma's `required`/absence model does not capture the union structure directly.
- **Logical types** — `decimal`, `date`, `timestamp-millis`, `uuid`, and similar types are Avro annotations on underlying primitives (`bytes`, `int`, `long`). Without explicit tokens, the logical semantics are lost when a Satsuma schema is converted back to Avro.
- **Schema evolution and defaults** — Avro backward compatibility requires that every newly added field carry a `default`. A missing default is a silent breaking change that only surfaces when an old consumer reads a new message.
- **Schema Registry coupling** — In practice, every Avro schema lives in a Schema Registry (Confluent, AWS Glue, Apicurio). The subject name, compatibility mode, and version are operationally load-bearing and should be captured in the schema metadata.
- **Fixed and map types** — `fixed` (exact-length byte sequences) and `map` (string-keyed dictionaries) have no direct Satsuma equivalents and require workarounds with explanatory notes.
- **Namespace and fullname resolution** — Avro's dot-separated namespaces and fullname concatenation rules govern how named types (`record`, `enum`, `fixed`) are referenced across schemas. The namespace declared at the top level is inherited by all nested types unless overridden.

## Metadata Conventions

### Schema-level

| Token | Usage | Example |
|-------|-------|---------|
| `format` | Always `avro` | `format avro` |
| `namespace` | Avro namespace for all named types in this schema | `namespace "com.example.orders"` |
| `evolution` | Schema Registry compatibility mode | `evolution backward` |
| `schema_registry` | URL of the Schema Registry instance | `schema_registry "https://registry.example.com"` |
| `schema_subject` | Subject name in the registry | `schema_subject "orders-value"` |

Valid `evolution` values: `backward`, `forward`, `full`, `backward_transitive`,
`forward_transitive`, `full_transitive`, `none`.

### Field-level

| Token | Usage | Example |
|-------|-------|---------|
| `avro_type` | Original Avro primitive when no clean Satsuma equivalent exists | `avro_type bytes` |
| `logical_type` | Avro logical type annotation on the underlying primitive | `logical_type "timestamp-millis"` |
| `default` | Default value for schema evolution safety | `default null` |
| `avro_order` | Sort order hint used during Avro sort operations | `avro_order ascending` |
| `aliases` | Alternative names for safe field renaming across schema versions | `aliases ["orderId"]` |
| `fixed_size` | Byte count for fields of Avro `fixed` type | `fixed_size 16` |

### Guidelines

- Always include `default` on every field that is not `required`. Avro backward compatibility
  requires a default when new fields are added, and `null` is the conventional default for
  optional fields.
- Use `required` only on fields that map to a non-null Avro type with no null union. If the
  Avro schema has `["null", T]`, the field is not required.
- Include `schema_subject` even when its value appears derivable from the topic name. Implicit
  naming conventions drift; make it explicit.
- Represent Avro `map<V>` as a `record` with a `note` explaining the key semantics. Do not
  invent a map syntax — the existing `record` block is the closest structural equivalent.
- For multi-variant non-null unions (uncommon but valid in Avro), use `choice` on each variant
  `record` and describe the discriminator rule in a `note`.
- The `namespace` declared at schema level is inherited by all nested named types. Only add a
  namespace override at field level when a nested type intentionally belongs to a different namespace.
- Carry `aliases` on fields when the Avro source schema includes them; they document the safe
  rename history and are required by consumers during schema evolution transitions.

## Type Mapping: Avro → Satsuma

### Primitive and complex types

| Avro type | Satsuma type | Notes |
|-----------|-------------|-------|
| `null` | — | Absence only; never a standalone field type |
| `boolean` | `BOOLEAN` | |
| `int` | `INT32` | |
| `long` | `INT64` | |
| `float` | `FLOAT` | |
| `double` | `DOUBLE` | |
| `bytes` | `BYTES` | Use `DECIMAL(p,s)` when `logical_type decimal` is present |
| `string` | `STRING` | |
| `record` | `record { }` | |
| `array` | `list_of record` or `list_of <type>` | |
| `map` | `record` with `note "Avro map — keys are arbitrary strings"` | No direct equivalent |
| `enum` | `STRING (enum {...})` | Add `default` to document the unknown-symbol fallback |
| `fixed` | `BYTES (fixed_size N, avro_type fixed)` | |
| `["null", T]` | Field without `required` + `default null` | Avro nullable idiom |
| `[T1, T2, ...]` (non-null union) | `record (choice)` per variant + `note` | Rare; discriminator logic in `note` |

### Logical types

| Avro logical type | Underlying | Satsuma type | Additional tokens |
|-------------------|-----------|-------------|-------------------|
| `decimal` | `bytes` | `DECIMAL(p,s)` | `avro_type bytes, logical_type decimal` |
| `date` | `int` | `DATE` | `avro_type int, logical_type date` |
| `time-millis` | `int` | `TIME` | `avro_type int, logical_type time-millis` |
| `time-micros` | `long` | `TIME` | `avro_type long, logical_type time-micros` |
| `timestamp-millis` | `long` | `TIMESTAMP` | `avro_type long, logical_type timestamp-millis` |
| `timestamp-micros` | `long` | `TIMESTAMP` | `avro_type long, logical_type timestamp-micros` |
| `local-timestamp-millis` | `long` | `TIMESTAMP` | `avro_type long, logical_type local-timestamp-millis` |
| `local-timestamp-micros` | `long` | `TIMESTAMP` | `avro_type long, logical_type local-timestamp-micros` |
| `uuid` | `string` | `STRING` | `logical_type uuid` |
| `duration` | `fixed(12)` | `BYTES` | `avro_type fixed, fixed_size 12, logical_type duration` |

## How Natural Language Helps

Avro's operational context cannot be captured in metadata alone:

- **Evolution decisions** — "This field was added in schema v3; consumers on v2 will receive the
  default value `null` until they redeploy" — context that flags a migration window
- **Discriminated non-null unions** — When a union has more than two non-null variants, the rule
  for choosing which type is present is runtime logic. It belongs in a `" "` description on the
  mapping arrow, not forced into tokens.
- **Schema Registry workflow** — "Register under subject `orders-value` with BACKWARD_TRANSITIVE
  compatibility before deploying the producer. The first schema version must be registered manually
  via the registry API." — deployment-order constraints that aren't schema structure.
- **Partition key semantics** — "event_id is used as the Kafka message key; it must be
  deterministic for the same logical event to support idempotent producers" — constraints the
  target schema cannot express.
- **Avro `doc` attribute translation** — The `doc` string in the source Avro JSON schema carries
  intent that should be preserved as a `note` on the corresponding Satsuma field. Do not discard it
  during schema import.
- **Schema fingerprinting** — "Consumers identify schema versions by Rabin fingerprint of the
  parsing canonical form; aliases must be preserved to avoid fingerprint mismatches during renames."

## Example

```satsuma
// Satsuma v2 — Apache Avro CustomerOrderEvent schema
//
// Published to Kafka topic `orders` as the value payload.
// Schema registered in Confluent Schema Registry under subject `orders-value`.

schema customer_order_event (
  format avro,
  namespace "com.example.orders",
  evolution backward_transitive,
  schema_registry "https://registry.example.com",
  schema_subject "orders-value",
  note """
  Customer order event published when an order is created, updated, or cancelled.
  All monetary amounts are in the currency specified by currency_code.
  Schema is registered as BACKWARD_TRANSITIVE — every new version must be
  readable by all prior consumer versions. Always include defaults on new fields.
  """
) {
  // --- Identity ---

  event_id        STRING         (required, logical_type uuid,
    note "UUID v4 — used as the Kafka message key for idempotent producers"
  )
  schema_version  INT32          (required, default 1,
    note "Incremented each time a schema-breaking migration is applied"
  )
  event_type      STRING         (required,
    enum {order_created, order_updated, order_cancelled, order_shipped},
    default "order_created"
  )
  event_timestamp TIMESTAMP      (required,
    avro_type long, logical_type timestamp-millis,
    note "Epoch milliseconds UTC — set by the producing service at emission time"
  )

  // --- Order ---

  order_id        STRING         (required)
  order_date      DATE           (required, avro_type int, logical_type date)
  currency_code   STRING         (required, note "ISO 4217 three-letter code e.g. USD, GBP, EUR")

  order_total     DECIMAL(18,4)  (required,
    avro_type bytes, logical_type decimal,
    note "Precision 18, scale 4 — sum of all line item totals including tax"
  )

  // Optional discount applied at order level — nullable in Avro: ["null", "bytes"]
  discount_amount DECIMAL(18,4)  (
    default null,
    avro_type bytes, logical_type decimal
  )

  status          STRING         (required,
    enum {pending, confirmed, processing, shipped, delivered, cancelled},
    default "pending"
  )

  // --- Customer ---

  CUSTOMER record {
    customer_id   STRING         (required)
    email         STRING         (required, pii)
    full_name     STRING         (required, pii)
    tier          STRING         (
      enum {standard, silver, gold, platinum},
      default "standard",
      note "Loyalty tier at time of order — may differ from current tier"
    )
  }

  // --- Shipping address ---
  // Optional — absent on digital-only orders. Avro: ["null", ShippingAddress record]

  SHIPPING_ADDRESS record (
    default null,
    note "Absent for digital-only orders (software licences, gift cards)"
  ) {
    street_line1  STRING         (required)
    street_line2  STRING         (default null)
    city          STRING         (required)
    region        STRING         (default null, note "State, province, or county")
    postal_code   STRING         (required)
    country_code  STRING         (required, note "ISO 3166-1 alpha-2")
  }

  // --- Line items (Avro array of LineItem record) ---

  LINE_ITEMS list_of record (
    note "At least one item is always present; Avro schema enforces minItems via producer validation"
  ) {
    line_id       STRING         (required)
    sku           STRING         (required)
    product_name  STRING         (required)
    quantity      INT32          (required)
    unit_price    DECIMAL(18,4)  (required, avro_type bytes, logical_type decimal)
    line_total    DECIMAL(18,4)  (required, avro_type bytes, logical_type decimal)
    tax_rate      DECIMAL(5,4)   (
      default null,
      avro_type bytes, logical_type decimal,
      note "Tax rate as a fraction e.g. 0.2000 = 20% VAT. Null if tax-exempt."
    )
  }

  // --- Custom attributes (Avro map<string>) ---
  // No Satsuma equivalent for Avro map — represented as a record with note.

  CUSTOM_ATTRIBUTES record (
    default null,
    note """
    Avro map<string> — keys are arbitrary application-defined attribute names,
    values are string-encoded. Common keys: promo_code, affiliate_id, ab_variant.
    Decompose specific known keys in downstream mappings; preserve the rest as JSON.
    """
  ) {
    promo_code    STRING  (default null)
    affiliate_id  STRING  (default null)
  }

  // --- Idempotency key (Avro fixed<16>) ---

  idempotency_key BYTES  (
    required,
    avro_type fixed, fixed_size 16,
    note "128-bit idempotency key — 16 raw bytes, not UUID-formatted"
  )
}
```

### Key patterns

- **Backward-compatible defaults.** Every optional field carries `default null`. A consumer on an
  older schema version can read new messages safely; the new fields arrive as their defaults.
- **Logical types preserved.** `DECIMAL`, `DATE`, and `TIMESTAMP` fields carry `avro_type` and
  `logical_type` tokens so the Avro-level encoding (e.g. `bytes` with precision/scale) survives
  round-trips through Satsuma tooling.
- **Nullable via absence of `required`.** `discount_amount` and `SHIPPING_ADDRESS` are optional in
  the Avro schema via a `["null", T]` union. In Satsuma, the absence of `required` and the
  presence of `default null` express the same semantics without inventing a union syntax.
- **Map workaround.** `CUSTOM_ATTRIBUTES` is an Avro `map<string>`. It is represented as a record
  with a `note` explaining the true Avro structure. Known keys are broken out as named fields;
  the `note` instructs downstream consumers how to handle unknown keys.
- **Fixed type.** `idempotency_key` uses `avro_type fixed, fixed_size 16` to document that the
  Avro schema uses a fixed-length byte type, not a variable-length `bytes` field.
- **Schema Registry metadata on the schema.** `schema_registry`, `schema_subject`, and `evolution`
  appear at schema level so the deployment contract — what to register, where, and with what
  compatibility rule — is readable alongside the structure itself.

## Relationship to the COBOL-to-Avro Example

[`examples/cobol-to-avro/pipeline.stm`](../../../examples/cobol-to-avro/pipeline.stm) shows Avro
as a mapping **target**. It demonstrates the common `format avro` tokens (`namespace`, `evolution`,
`schema_registry`) and the standard `record`/`list_of record` nesting pattern. The conventions in
this document extend that baseline with logical type tokens, the nullable-field idiom, and the map
workaround, which are needed when Avro is a mapping **source** or when schemas must survive
round-trips through a Schema Registry.
