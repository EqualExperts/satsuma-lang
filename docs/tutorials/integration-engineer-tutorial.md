# Satsuma for Integration Engineers — A Practical Tutorial

## 1. The Problem Satsuma Solves for Integration Engineers

You know the drill. The mapping spec for a MuleSoft integration lives in a Confluence page. The Workato recipe was designed in a vendor UI that exports to... nothing portable. The EDI mapping is buried in a spreadsheet that three people edited, two people emailed, and nobody version-controlled. The Kafka event contract is documented in a Google Doc that links to an outdated OpenAPI spec. And when someone asks "what happens to the customer address between System A and System B?" you spend forty-five minutes tracing through four tools before you can answer.

This is the integration engineer's version of the "spreadsheet problem" that plagues every data team. The mapping logic — the part that actually matters — is scattered across vendor-specific formats, collaboration tools, and people's heads. None of it travels. None of it diffs cleanly. None of it is readable by an AI agent without heroic prompt engineering.

**Satsuma** is a plain-text language for source-to-target data mapping. It captures schemas, field-level mappings, transform logic, and integration metadata in a single `.stm` file that is:

- **Portable.** It doesn't belong to MuleSoft, or Workato, or any vendor. It's plain text.
- **Version-controlled.** `.stm` files live in Git. They diff, merge, blame, and review in PRs like any other code artifact.
- **AI-readable.** The structured syntax — schemas, arrows, metadata, natural language — gives LLMs unambiguous context for generating platform-specific implementation scaffolds.
- **Human-readable.** If you can read a field list and follow an arrow, you can read Satsuma. (If you haven't seen it before, the [BA Tutorial](ba-tutorial.md) walks through the syntax from scratch.)

The key insight: **Satsuma is the spec layer, not the implementation layer.** You write the mapping once in Satsuma, then use it to generate scaffolds for whatever platform you're deploying to — DataWeave, Workato formulas, Logic Apps JSON, Lambda handlers, Camel routes. The spec stays portable. The implementation is platform-specific but traceable back to the spec.

---

## 2. The Integration Landscape

Before we dive into syntax, here's a quick orientation on where Satsuma fits relative to the platforms you already use.

**ESBs and iPaaS** — MuleSoft, Boomi, Workato, Zapier, Make. These platforms have their own mapping UIs, expression languages, and connector abstractions. They're great for execution, but their mapping definitions are locked inside the platform. Satsuma documents the mapping intent *before* you build it in the vendor tool.

**Message queues** — Kafka, RabbitMQ, Azure Service Bus, Google Pub/Sub, AWS SQS/SNS. These carry the data. Satsuma describes what happens to the data as it moves between producers and consumers — the schema transformations, field mappings, and business logic that a stream processor or consumer service implements.

**API gateways** — REST, GraphQL, gRPC. These define contracts for individual systems. Satsuma describes the mapping *between* systems — how a field in System A's REST response becomes a field in System B's gRPC request.

**Legacy middleware** — webMethods, TIBCO, IBM MQ. Same story. The mapping logic is trapped in proprietary tooling. Satsuma extracts it into a portable, reviewable format.

The common thread: **Satsuma sits above all of these.** It's not a replacement for any platform — it's the specification layer that makes your mapping logic visible, portable, and AI-consumable regardless of which platform executes it.

---

## 3. The Satsuma + AI Workflow for Integrations

The core workflow has four steps:

### Step 1: Document source and target schemas with format metadata

```satsuma
schema commerce_event_pb (
  format protobuf,
  schema_registry "https://registry.example.com",
  namespace "com.example.commerce.events"
) {
  event_id    STRING  (tag 1)
  event_type  STRING  (tag 2)
  session_id  STRING  (tag 5)
}
```

The `format`, `schema_registry`, and `tag` metadata tell both humans and AI agents exactly what they're working with. No guessing whether it's JSON or protobuf or XML. See the full example in the [Protobuf-to-Parquet example](../../examples/protobuf-to-parquet/pipeline.stm).

### Step 2: Describe the mapping logic

```satsuma
mapping `event ingest` {
  source { `commerce_event_pb` }
  target { `event_store` }

  event_id -> id
  event_type -> type { trim | lowercase }
  session_id -> session_id
  -> ingested_at { now_utc() }
}
```

Arrows, pipe chains, value maps, natural-language transforms. The [BA Tutorial](ba-tutorial.md) covers all of these in detail.

### Step 3: Add integration metadata

```satsuma
note {
  """
  # Event Ingest Pipeline

  - **Platform:** Kafka consumer → PostgreSQL
  - **SLA:** < 500ms p99 end-to-end
  - **Error handling:** Dead-letter topic `events.dlq`
  - **Idempotency:** Deduplicate on `event_id` with 24h window
  """
}
```

This is the metadata that matters for scaffold generation — the deployment target, error handling strategy, performance constraints. It travels with the spec instead of living in a separate runbook.

### Step 4: Feed to an AI agent for scaffold generation

With the Satsuma spec as input, an AI agent can generate platform-specific implementation code. The structured format — schemas with types and metadata, explicit field mappings, annotated transform logic — gives the agent far more to work with than a free-text requirements document or a screenshot of a vendor UI.

You can do this with or without the Satsuma CLI. See [Using Satsuma without CLI](../using-satsuma-without-cli.md) for the web LLM workflow.

---

## 4. Format-Specific Metadata Conventions

One of Satsuma's strengths is that format-specific metadata lives right next to the fields it describes. The `( )` metadata blocks are extensible — you use whatever vocabulary tokens make sense for your format.

### XML with XPath and Namespaces

```satsuma
schema commerce_order (
  format xml,
  namespace ord "http://example.com/commerce/order/v2",
  namespace com "http://example.com/common/v1"
) {
  OrderId    STRING  (xpath "ord:OrderId")
  Currency   STRING  (xpath "ord:Currency/com:Code")
}
```

The `namespace` declarations on the schema and `xpath` annotations on each field give an AI agent everything it needs to generate XPath expressions for a MuleSoft DataWeave transform or an XSLT stylesheet. See the full [XML-to-Parquet example](../../examples/xml-to-parquet/pipeline.stm).

### JSON with JSONPath

```satsuma
schema webhook_payload (format json) {
  order_id  STRING  (jsonpath "$.order.id", required)
  items     list_of record (jsonpath "$.order.line_items[*]") {
    sku    STRING  (jsonpath "$.sku")
    qty    INT     (jsonpath "$.quantity")
  }
}
```

JSONPath annotations make nested JSON structures explicit. The AI agent doesn't have to guess the nesting — it's declared.

### COBOL Copybooks

```satsuma
schema customer_master (
  format copybook,
  encoding ebcdic
) {
  CUST_ID       INTEGER       (pic "9(10)", offset 1, length 10)
  CREDIT_LIMIT  DECIMAL(9,2)  (pic "S9(7)V99", encoding comp-3, offset 109, length 5)
}
```

Positional layout, PIC clauses, packed-decimal encoding — all the details that make mainframe integrations painful are captured as metadata. See the full [COBOL-to-Avro example](../../examples/cobol-to-avro/pipeline.stm).

### EDI with Segment Filters

```satsuma
schema edi_desadv (format fixed-length) {
  ShipmentRefs list_of record (filter SHPRFQUAL == "SRN") {
    SHPRFQUAL  CHAR(3)
    SHIPREF    CHAR(70)
  }
}
```

The `filter` metadata captures the qualifier-based segment selection that makes EDI mapping so tricky. See the full [EDI-to-JSON example](../../examples/edi-to-json/pipeline.stm).

### Protobuf with Tag-Based References

```satsuma
schema commerce_event_pb (format protobuf) {
  event_id    STRING  (tag 1)
  event_type  STRING  (tag 2)
  CartLines   list_of record (tag 10) {
    sku         STRING         (tag 1)
    unit_price  DECIMAL(12,2)  (tag 3)
  }
}
```

Protobuf field tags, schema registry references, and version metadata are all first-class. See the full [Protobuf-to-Parquet example](../../examples/protobuf-to-parquet/pipeline.stm).

The [schema format conventions](../conventions-for-schema-formats/README.md) directory documents conventions for dozens of additional formats — HL7, X12/HIPAA, ISO 8583, SWIFT MT, FIX Protocol, ASN.1, DICOM, and more.

---

## 5. Scaffold Generation Examples

This is where the integration engineer workflow pays off. You've written a clean Satsuma spec with schemas, mappings, and metadata. Now you hand it to an AI agent and ask for platform-specific scaffolding.

Here's what that looks like for each major platform.

### MuleSoft DataWeave

**What the AI reads:** Satsuma schemas with `format xml` and `xpath` annotations, mapping arrows with pipe chains, natural-language transforms.

**What it generates:** A `.dwl` DataWeave transform file with XPath-based source selectors, type coercions matching the target schema, and TODO comments for natural-language transforms that need manual implementation.

**What you verify:** Namespace handling is correct. Type coercions match MuleSoft's type system. The generated XPath expressions resolve against your actual XML samples.

### Workato Recipes / Connector Mappings

**What the AI reads:** Satsuma schemas with connector-relevant metadata (API endpoints, auth references in notes), mapping arrows, value maps.

**What it generates:** A recipe structure description with input/output field mappings, formula expressions for pipe chains, and lookup table definitions for value maps.

**What you verify:** Connector field names match the actual Workato connector schema. Rate limits and pagination are handled. Error paths cover the cases described in your notes.

### Zapier / Make Webhook + Transform Flows

**What the AI reads:** Satsuma schemas (typically `format json`), mapping arrows, simple transforms.

**What it generates:** A step-by-step flow description — webhook trigger configuration, field mappings for each action step, filter conditions, and formatter configurations.

**What you verify:** The webhook payload structure matches your source. Multi-step transforms are broken into the right number of Zapier/Make steps. Rate limits won't be a problem at your volume.

### Azure Logic Apps

**What the AI reads:** Satsuma schemas with format metadata, mapping arrows, integration notes describing the deployment target and error handling.

**What it generates:** A Logic Apps workflow definition (JSON) with connector actions, `@body()` and `@triggerBody()` expressions for field access, condition blocks for branching transforms, and error-handling scopes.

**What you verify:** Connector API versions are current. Expression syntax is valid. Retry policies and error scopes match your SLA requirements.

### AWS Step Functions + Lambda

**What the AI reads:** Satsuma schemas, mapping arrows, integration notes about error handling and idempotency.

**What it generates:** A Step Functions state machine definition (ASL JSON) with Lambda function stubs for each mapping block. Each Lambda stub includes the field-level mapping logic as code, with TODO markers for natural-language transforms.

**What you verify:** State machine flow matches your error handling strategy. Lambda memory/timeout settings are appropriate. IAM permissions cover the required service integrations.

### Apache Camel Route Definitions

**What the AI reads:** Satsuma schemas with format metadata (especially useful for EDI, XML, and fixed-length formats), mapping arrows, integration notes.

**What it generates:** Camel route definitions in Java DSL or XML DSL with `from()` and `to()` endpoints, data format declarations, processor beans for transform logic, and `onException` blocks.

**What you verify:** Endpoint URIs are correct. Data format configurations match your actual message formats. Error handling routes align with your messaging infrastructure.

### Spring Integration / Apache NiFi

**What the AI reads:** Satsuma schemas with format and connectivity metadata, mapping arrows, notes describing flow topology.

**What it generates:** Spring Integration flow configurations (Java DSL or XML) or NiFi flow templates with processor configurations, attribute mappings, and routing rules.

**What you verify:** Channel/queue names match your infrastructure. Processor configurations handle your data volumes. Back-pressure and error handling are appropriate.

---

In every case, the pattern is the same: **the Satsuma spec is the source of truth for mapping intent, and the generated scaffold is a starting point that you verify and refine.** The AI does the tedious structural translation; you bring the domain knowledge and platform expertise.

---

## 6. Message-Oriented Patterns

Integration work is fundamentally about messages — requests, responses, events, commands. Satsuma has patterns for all of them.

### Request/Response Pairs

When an integration involves a request to one system and a response that feeds another, model them as two separate mappings sharing a common schema:

```satsuma
schema api_request (format json) {
  customer_id  STRING  (required)
  query_type   STRING  (required)
}

schema api_response (format json) {
  customer_id  STRING
  credit_score INT
  risk_tier    STRING
}

mapping `build request` {
  source { `internal_record` }
  target { `api_request` }
  id -> customer_id
  -> query_type { "full_check" }
}

mapping `process response` {
  source { `api_response` }
  target { `enriched_record` }
  credit_score -> credit_score
  risk_tier -> risk_category { lowercase }
}
```

Two mappings, one for each direction of the conversation. The schemas make the API contract explicit. An AI agent generating the implementation knows exactly what to send and what to expect back.

### Event Schemas with Versioning Metadata

For event-driven architectures, capture schema evolution metadata alongside the structure:

```satsuma
schema customer_event (
  format avro,
  evolution backward,
  schema_registry "https://registry.example.com",
  namespace "com.example.customer.events"
) {
  event_id     STRING  (required)
  event_type   STRING  (required, enum {created, updated, deactivated})
  customer_id  STRING  (required)
}
```

The `evolution backward` and `schema_registry` metadata tell an AI agent — and your team — that this schema must maintain backward compatibility and is governed by a registry. That context shapes the generated code (e.g., using the registry client for serialization, validating compatibility before deployment).

### Dead-Letter and Error Annotations

Use `note { }` blocks to document error handling strategies directly in the spec:

```satsuma
mapping `ingest events` {
  source { `raw_event` }
  target { `processed_event` }

  note {
    """
    ## Error Handling
    - **Parse failures:** Route to `events.dlq` with original payload and error detail
    - **Schema validation failures:** Route to `events.dlq` with validation report
    - **Transform errors:** Log warning, emit record with null for failed field
    - **Retry policy:** 3 attempts with exponential backoff, then DLQ
    """
  }

  event_id -> id
  payload -> data { "Deserialize and validate against target schema" }
}
```

This is integration metadata that traditionally lives in a runbook or a Jira ticket. Embedding it in the spec means it's visible during code review and available to AI agents generating error-handling scaffolds.

### Idempotency Keys and Deduplication Hints

```satsuma
mapping `order ingest` (
  idempotency_key order_id,
  dedup_window "24h",
  note "Deduplicate on order_id within a 24-hour window. Late duplicates are logged and dropped."
) {
  source { `order_event` }
  target { `order_store` }

  order_id -> order_id
  // ... remaining arrows
}
```

The `idempotency_key` and `dedup_window` metadata on the mapping header signal to both humans and AI agents that deduplication is a first-class concern. A generated scaffold will include the dedup logic rather than leaving it as an afterthought.

---

## 7. API Contract Alignment

If you work with API integrations, you're already using OpenAPI (for REST) or AsyncAPI (for event-driven APIs). How does Satsuma relate to these?

**OpenAPI and AsyncAPI define the contract of a single system** — what endpoints exist, what payloads they accept, what responses they return. They answer: *"What does this system look like from the outside?"*

**Satsuma defines the mapping logic between systems** — how a field in System A becomes a field in System B, what transforms are applied, what business rules govern the translation. It answers: *"How does data flow from here to there?"*

They're complementary, not competing:

```
OpenAPI (System A) → Satsuma mapping → OpenAPI (System B)
AsyncAPI (Producer) → Satsuma mapping → AsyncAPI (Consumer)
```

In practice, you might derive your Satsuma source schema from an OpenAPI spec, write the mapping logic, and have an AI agent generate both the target system's OpenAPI spec updates and the integration code. The Satsuma spec is the bridge document that connects the two contracts.

When both exist, you can also ask an AI agent to validate consistency: *"Check that every field referenced in this Satsuma mapping exists in the corresponding OpenAPI schemas."* The structured format makes this kind of cross-validation reliable.

---

## 8. Why Satsuma Produces Better Results Than Vendor-Specific Tools

You might be thinking: *"My iPaaS already has a mapping UI. Why would I write a separate spec?"*

Four reasons:

**Portability.** When you switch from Workato to MuleSoft (or add a second platform), your mapping logic comes with you. Vendor UIs lock your specifications into their export format — if they export at all. Satsuma specs are plain text that any tool can read.

**AI readability.** Satsuma's structured syntax — schemas with typed fields and metadata, explicit arrows, pipe chains, natural-language transforms — gives an AI agent dramatically more context than a screenshot of a vendor UI or a free-text description. The result is better-quality generated code with fewer hallucinations.

**Natural language carries business context.** A MuleSoft DataWeave transform tells you *what* the code does, but not *why*. Satsuma's natural-language transforms and notes embed the business rationale right next to the technical mapping. When you ask an AI agent to modify the integration six months later, it has the full context.

**Version control and review.** `.stm` files diff cleanly, merge predictably, and support meaningful code review. Try doing a pull request review on a MuleSoft project export or a Workato recipe JSON. The format isn't designed for human review. Satsuma is.

None of this means you stop using your iPaaS. You still build and run integrations in MuleSoft or Workato or whatever platform you've chosen. Satsuma is the specification layer that sits above the implementation — portable, reviewable, and AI-consumable.

---

## 9. Human Verification and Testing Patterns

AI-generated scaffolds are a starting point, not a finished product. Here are patterns for verifying that the generated code matches the spec.

### Message-Level Test Data Generation

Ask an AI agent to generate test messages from your Satsuma schemas:

> "Generate 5 sample XML messages that conform to this source schema, including edge cases: null optional fields, maximum-length strings, boundary decimal values, and one message with an empty `LineItems` array."

The typed fields, constraints, and metadata in the schema give the AI enough context to produce realistic test data — not just syntactically valid payloads, but semantically meaningful ones.

### Contract Testing

Use the Satsuma spec as the contract for automated tests:

> "For each arrow in this mapping, generate a test case that sends a source message with a known value for the source field and asserts that the target field contains the expected transformed value."

The explicit arrow-by-arrow structure makes it straightforward to generate one test per mapping rule. Pipe chains translate to chained assertions. Value maps become parameterized test cases.

### LLM-as-Judge

For natural-language transforms that are hard to test deterministically, use a second AI pass:

> "Here is the Satsuma spec and the generated DataWeave code. For each natural-language transform, evaluate whether the generated implementation correctly captures the described intent. Flag any discrepancies."

The Satsuma NL transform is the acceptance criterion. The AI compares the implementation against the stated intent, which is far more reliable than having it evaluate code in isolation.

### Regression via Re-Generate and Diff

When a Satsuma spec changes, regenerate the scaffold and diff it against the previous version:

```bash
# Generate scaffold from updated spec
# (using your AI agent of choice)

# Diff against previous scaffold
diff previous-scaffold.dwl new-scaffold.dwl
```

If the diff is limited to the fields you changed in the spec, the regeneration is working correctly. If unexpected changes appear, the spec change had unintended consequences — and you caught it before deployment.

This pattern works particularly well with Satsuma because the spec-to-scaffold relationship is deterministic enough to produce stable diffs. Free-text requirements don't have this property.

---

## 10. Getting Started

Here's how to begin using Satsuma for your integration work.

**Pick one integration.** Don't try to convert everything at once. Choose a current project — ideally one that's still in design or early implementation. An API integration, an event pipeline, a legacy system migration. Something where the mapping logic isn't fully locked in yet.

**Write the schemas first.** Open a text editor and describe the source and target structures as Satsuma `schema` blocks. Include format metadata (`format json`, `format xml`, `format protobuf`), field types, and constraints. This alone is more precise than what's in your current spec document.

**Add the mapping.** Write a `mapping` block with arrows connecting source fields to target fields. Use pipe chains for simple transforms. Use natural-language transforms for complex business logic. Don't worry about getting every detail right — the goal is to capture the intent, not to write production code.

**Add integration notes.** Document error handling, SLA requirements, idempotency rules, and deployment targets in `note { }` blocks. This is the metadata that makes AI scaffold generation effective.

**Try scaffold generation.** Paste your `.stm` file into an AI agent (with the [AI Agent Reference](../../AI-AGENT-REFERENCE.md) for grammar context) and ask it to generate a scaffold for your target platform. See [Using Satsuma without CLI](../using-satsuma-without-cli.md) for tips on working with web LLMs.

**Review and iterate.** The first scaffold won't be perfect. Compare it against the spec, identify gaps, and refine both the spec and the generated code. Each iteration improves both artifacts.

**Version-control the spec.** Put the `.stm` file in Git alongside your integration code. Review spec changes in PRs. Use `//!` warnings for known issues and `//?` questions for open items.

The more integrations you document this way, the more value compounds. Your team builds a searchable, diffable, AI-readable library of integration specifications that outlives any single vendor platform.

---

## Further Reading

- [BA Tutorial](ba-tutorial.md) — full syntax walkthrough from scratch
- [Schema format conventions](../conventions-for-schema-formats/README.md) — metadata conventions for XML, JSON, COBOL, EDI, Protobuf, HL7, and more
- [Using Satsuma without CLI](../using-satsuma-without-cli.md) — workflow for web LLMs without tooling
- [CLI reference](../../SATSUMA-CLI.md) — the Satsuma CLI for validation, extraction, and lineage
- [XML-to-Parquet example](../../examples/xml-to-parquet/pipeline.stm) — XML with namespaces and XPath
- [EDI-to-JSON example](../../examples/edi-to-json/pipeline.stm) — EDI 856 with segment filters and data gaps
- [COBOL-to-Avro example](../../examples/cobol-to-avro/pipeline.stm) — mainframe copybook to Kafka events
- [Protobuf-to-Parquet example](../../examples/protobuf-to-parquet/pipeline.stm) — protobuf with schema registry and aggregation
