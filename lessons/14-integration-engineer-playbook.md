# Lesson 14 — The Integration Engineer's Playbook

> **Personas:** Integration Engineer, Solution Architect

## Your Role in the Satsuma Model

As an integration engineer, you work across **APIs, files, XML, EDI, events, and heterogeneous enterprise platforms**. Your challenges are:

- Source and target formats are wildly different (XML with namespaces, fixed-length EDI, Protobuf, COBOL copybooks).
- Nesting depths vary — flat files feed into deeply nested JSON APIs, or deeply nested XML gets flattened to Parquet rows.
- Multi-source joins aggregate data from three or four independent systems.
- Business rules are buried in legacy documentation, SME conversations, or existing code.

Satsuma handles all of these with the same structural model. Format-specific details go in metadata. The mapping structure stays consistent regardless of the source and target formats.

---

## Format-Specific Schemas

### XML with Namespaces and XPath

```satsuma
schema commerce_order (
  format xml,
  namespace ord "http://example.com/commerce/order/v2",
  namespace com "http://example.com/common/v1",
  note "Canonical commerce order message"
) {
  Order record (xpath "/ord:OrderMessage/ord:Order") {
    OrderId        STRING   (xpath "ord:OrderId")
    Channel        STRING   (xpath "ord:Channel")

    Customer record {
      CustomerId   STRING   (xpath "ord:CustomerId")
      Email        STRING   (xpath "ord:Email")
    }

    LineItems list_of record (xpath "ord:LineItems/ord:LineItem") {
      LineNumber   INT32    (xpath "ord:LineNumber")
      SKU          STRING   (xpath "ord:SKU")
      Quantity     INT32    (xpath "ord:Quantity")
    }
  }
}
```

Key points:
- **`namespace`** metadata declares XML namespace prefixes and URIs.
- **`xpath`** metadata on records, lists, and fields captures the XPath expression.
- The Satsuma structure (record/list) mirrors the XML structure independently of the XPath details.

### EDI with Fixed-Length Records and Filters

```satsuma
schema edi_desadv (
  format fixed-length,
  note "EDI 856 Despatch Advice — Fixed Length Format"
) {
  BeginningOfMessage record {
    DOCNUM      CHAR(35)
    MESSGFUN    CHAR(3)              // message function: 9 = Original
  }

  POReferences list_of record (filter REFQUAL == "ON") {
    REFQUAL     CHAR(3)
    REFNUM      CHAR(35)             // PO Number + "/" + Dissection No
  }

  Quantities list_of record (filter QUANTQUAL == "12") {
    QUANTQUAL   CHAR(3)
    QUANTITY    NUMBER(15)           //! 4 implied decimal places
  }
}
```

Key points:
- **`filter`** on lists captures EDI segment qualification — only segments matching the filter condition are included.
- **Implied decimal places** are documented as warnings (`//!`) because the source format doesn't carry them explicitly.
- Fixed-length format metadata helps implementers know they're dealing with positional parsing, not delimited data.

### COBOL Copybooks

```satsuma
schema mainframe_policy (
  format copybook,
  encoding ebcdic,
  note "POLICY-MASTER copybook — IBM z/OS VSAM"
) {
  POLICY_ID     INTEGER       (pic "9(10)", offset 1, pk)
  HOLDER_NAME   STRING        (pic "X(40)", offset 11)
  PREMIUM_AMT   DECIMAL(9,2)  (pic "S9(7)V99", encoding comp-3, offset 51)   // packed decimal
  COVERAGE_TYPE STRING        (pic "X(2)", offset 56, enum {LF, HE, AU, HO})
  BENE_COUNT    INTEGER       (pic "9(1)", offset 58)

  BENEFICIARIES list_of record (offset 59, occurs 5, depends_on BENE_COUNT) {
    BENE_NAME   STRING        (pic "X(30)")
    BENE_PCT    DECIMAL(4,1)  (pic "9(3)V9")   // percentage, 1 decimal
  }
}
```

Key points:
- **Fields use ordinary Satsuma types**; the original PIC clause is kept verbatim in `pic "..."`, and `encoding comp-3` marks packed decimals. See the [COBOL copybook conventions](../docs/conventions-for-schema-formats/cobol-copybook/conventions.md).
- **`offset`** metadata captures the 1-based byte position in the record.
- **`occurs` / `depends_on`** captures COBOL repeating groups with variable length; the count field must itself be declared.
- **`encoding ebcdic`** on the schema documents the character encoding — critical for mainframe integrations.

### Protobuf with Schema Registry

```satsuma
schema commerce_event (
  format protobuf,
  registry "https://schema-registry.prod.internal/subjects/commerce.events/versions/latest",
  note "Commerce event stream — protobuf-encoded Kafka messages"
) {
  event_id        STRING       (tag 1, required)
  event_type      STRING       (tag 2, enum {page_view, add_to_cart, checkout, purchase})
  timestamp_ms    INT64        (tag 3, required)
  session_id      STRING       (tag 4)
  user_id         STRING       (tag 5, pii)

  product_detail record (tag 6) {
    sku           STRING       (tag 1)
    category      STRING       (tag 2)
    price_cents   INT64        (tag 3)
    quantity      INT32        (tag 4)
  }
}
```

Key points:
- **`tag N`** metadata captures protobuf field numbers.
- **`registry`** metadata points to the schema registry for version management.
- The structural model (record/list) is the same regardless of the serialization format.

---

## Nested Structure Mapping Across Formats

Integration engineering often involves mapping between formats with different nesting models. Satsuma handles this uniformly:

### Nested source to flat target (flattening)

<!-- satsuma-check: schemas from examples/xml-to-parquet/pipeline.stm -->
```satsuma
mapping `order lines` {
  source { `commerce_order` }
  target { `order_lines_parquet` }

  flatten Order.LineItems -> order_lines_parquet {
    ^.OrderId -> order_id
    .LineNumber -> line_number
    .SKU -> sku { trim | uppercase }
    ^.CurrencyCode -> currency_code { trim | uppercase }
  }
}
```

Paths inside the block are relative to the line item, so order-level fields (`OrderId`, `CurrencyCode`) are reached one level up with `^.` and denormalised onto every output row. Writing `Order.OrderId` inside the block would resolve to `Order.LineItems.Order.OrderId` and fail validation.

### Flat source to nested target

```satsuma
each POReferences -> ShipmentHeader.asnDetails {
  .REFNUM -> .orderNo { split("/") | first | to_number }

  each LineItems -> .items {
    .ITEMNO -> .item { trim }
    .QUANTITY -> .unitQuantity {
      "Divide by 10000 for 4 implied decimal places."
    }
  }
}
```

Nested arrow blocks build up the target structure from flat or differently-structured source data.

### Cross-format concerns

| Concern | How Satsuma handles it |
|---|---|
| Character encoding | `encoding EBCDIC` on schema, NL transform for conversion |
| Byte offsets vs. named fields | `offset N` metadata on COBOL fields |
| Implied decimals | `//!` warning + NL transform for decimal adjustment |
| Namespace-qualified names | `namespace` + `xpath` metadata |
| Schema evolution (Protobuf, Avro) | `registry` metadata + `tag` numbers |
| Segment qualification (EDI) | `filter` metadata on lists |

---

## Multi-Source Joins

Enterprise integrations frequently join data from multiple independent systems:

```satsuma
mapping `customer 360` {
  source {
    `crm_customers`       (filter "email NOT LIKE '%@test.internal'")
    `order_transactions`   (filter "status IN ('completed', 'refunded')")
    `support_tickets`      (filter "created_at >= date_sub(now(), interval 12 month)")
    "Join @crm_customers to @order_transactions on customer_id (left join).
     Join @crm_customers to @support_tickets on customer_id (left join)."
  }
  target { `customer_360` }

  // Profile from CRM
  crm_customers.customer_id -> customer_id
  crm_customers.email -> email { trim | lowercase }

  // Aggregated from orders
  -> total_orders { "Count of @order_transactions where status = 'completed'." }
  -> total_revenue { "Sum @order_transactions.total where status = 'completed'." | coalesce(0) | round(2) }

  // Aggregated from support
  -> tickets_last_12m { "Count of @support_tickets." | coalesce(0) }
  -> avg_csat_score { "Average @support_tickets.csat_score where not null." | round(1) }
}
```

### Key patterns:

- **Filters on each source** — `(filter "condition")` restricts which records participate.
- **Join logic as NL** — the join strategy is described in natural language in the source block because it often involves complex conditions.
- **Prefix source fields** — `crm_customers.email` disambiguates when multiple sources have fields with the same name.
- **Aggregated computed fields** — `-> total_orders { "Count of..." }` uses NL because aggregation logic depends on the join context.

---

## Cross-Reference Lookups

Enterprise mappings frequently need to look up reference data:

```satsuma
PHONE_NBR -> phone {
  "Extract all digits. If 10 digits, assume US (+1).
   Validate country code against @country_codes lookup using @COUNTRY_CD."
  | warn_if_invalid
}

.ITEMNO -> .item {
  trim
  | "Retrieve MFCS item number using the supplier's traded code
     from the MFCS supplier item cross-reference."
}
```

Cross-reference lookups are expressed as NL transforms because:
- The lookup logic varies by source system and reference table.
- The lookup might involve fuzzy matching, fallback logic, or multiple steps.
- The reference data might not exist in the Satsuma workspace.

If the lookup is simple enough, reference the lookup schema and let the implementer decide the mechanism.

---

## Data Gaps and Missing Source Data

Enterprise integrations inevitably have gaps — target fields that have no source:

```satsuma
//! DATA GAP: containers required but no source data
-> ShipmentHeader.asnDetails.containers {
  "Required by MFCS schema but no source data available in EDI 856.
   Options under discussion:
   1. Populate with a single placeholder container per order
   2. Request EDI 856 extension from suppliers
   3. Derive from warehouse receiving logic
   Blocked on: MFCS-2847"
}
```

Document data gaps explicitly:
- **`//!` warning** — makes the gap discoverable.
- **NL transform body** — describes the options being considered.
- **Jira/ticket reference** — links to the resolution tracker.

This is much better than leaving a target field unmapped and hoping someone notices.

---

## Using the Agent to Turn Messy Integration Knowledge into Satsuma

As an integration engineer, your deepest value is **knowing how the systems actually work** — beyond what the documentation says. The agent helps you capture that knowledge efficiently:

| You know | How to capture it |
|---|---|
| "This EDI segment only matters when the qualifier is ON" | `POReferences list_of record (filter REFQUAL == "ON")` |
| "The quantity field has 4 implied decimal places" | `//! 4 implied decimal places` + NL transform |
| "These two systems join on customer_id, but support stores it as a string" | Join description in source block + `//! stored as string, must cast to UUID` |
| "The date format depends on which upstream system sent the message" | NL transform: "Parse format depends on @Channel field" |
| "Nobody documented the status codes, but I found these in production" | `note "Values observed: AP, RJ, PN, CL. Meanings not documented."` + `//?` |

The agent turns your knowledge into well-formed Satsuma. You don't need to know the exact syntax — describe what you know, and the agent structures it correctly.

---

## Key Takeaways

1. Satsuma uses the same structural model (schema, record, list, mapping, arrow) regardless of source/target format. Format-specific details go in metadata.
2. XML (namespace, xpath), EDI (filter, fixed-length), COBOL (PIC, offset, COMP-3), and Protobuf (tag, registry) are all supported through metadata conventions.
3. Multi-source joins list all sources with filters and describe join logic as NL in the source block.
4. Cross-reference lookups are expressed as NL transforms because the logic varies too much to standardize.
5. Document data gaps explicitly with `//!` warnings, NL transforms describing options, and ticket references.
6. The agent captures your integration knowledge as well-formed Satsuma — you provide the expertise, it provides the structure.

---

This concludes the Satsuma curriculum. Return to the [lesson plan](README.md) for reading paths and learning objectives.
