# Lesson 06 — Natural Language Transforms and Agent Reasoning

## Why Natural Language Is a Feature

Most data mapping languages force you to express everything in code or pseudo-code. But real business rules are often too complex, too context-dependent, or too ambiguous to formalize cleanly:

- *"If the customer type is null or 'R', concat first name and last name. Otherwise, use company name."*
- *"Extract digits. If 10 digits, assume US +1. Format as E.164."*
- *"Derive health score from multiple signals: activity, ticket volume, CSAT, contract status."*

Forcing these into pseudo-code produces brittle, hard-to-read specifications that nobody trusts. Satsuma takes a different approach: **natural language is a first-class transform type, bounded by structural delimiters**.

The `" "` delimiters tell the parser "this is natural language." The parser doesn't interpret the content — it extracts it verbatim. The agent interprets the meaning. The human approves the interpretation.

---

## Transform Classification

The CLI classifies every arrow's transform into one of five types:

| Classification | What it means | Example |
|---|---|---|
| `[structural]` | Deterministic pipeline — fully machine-interpretable | `{ trim \| lowercase }` |
| `[nl]` | Natural language — requires agent interpretation | `{ "Format as E.164" }` |
| `[mixed]` | Both pipeline steps and NL in the same transform | `{ "Extract digits" \| warn_if_invalid }` |
| `[none]` | Direct mapping, no transform | `Id -> id` |
| `[nl-derived]` | Implicit arrow from an `@ref` inside NL | `@FIRST_NM` referenced in an NL block |

This classification matters because:
- **Structural** transforms can be validated and tested mechanically.
- **NL** transforms require human review and agent reasoning.
- **Mixed** transforms need both — the structural part is exact, the NL part is interpreted.

---

## Structural Pipelines

Structural transforms chain operations with `|`:

```satsuma
EMAIL_ADDR -> email { trim | lowercase | validate_email | null_if_invalid }
```

Each step is a deterministic operation from Satsuma's vocabulary:

- **String operations:** `trim`, `lowercase`, `uppercase`, `title_case`, `max_length(n)`, `replace(old, new)`
- **Null handling:** `null_if_empty`, `null_if_invalid`, `coalesce(value)`
- **Error handling:** `drop_if_invalid`, `warn_if_invalid`, `error_if_null`
- **Type conversion:** `to_string`, `to_number`, `to_boolean`, `to_iso8601`, `to_utc`
- **Formatting:** `validate_email`, `to_e164`, `pad_left(n, c)`, `escape_html`
- **Arithmetic:** `* N`, `/ N`, `+ N`, `- N`, `round(n)`
- **Parsing:** `parse(fmt)`, `split("x") | first | last`
- **Security:** `encrypt(algo, key)`, `hash(algo)`, `uuid_v5(ns, name)`

These are **vocabulary conventions**, not executable code. They specify intent precisely enough that an implementer knows exactly what to build, but they don't run anywhere.

---

## Natural Language Transforms

NL transforms express intent in prose:

```satsuma
-> display_name {
  "If @CUST_TYPE is null or 'R', trim and concat @FIRST_NM + ' ' + @LAST_NM.
   Otherwise, trim @COMPANY_NM."
}
```

### @ref inside NL

Notice the `@ref` markers: `@CUST_TYPE`, `@FIRST_NM`, `@LAST_NM`, `@COMPANY_NM`. These create **traceable references** inside natural language. The parser extracts them as `[nl-derived]` arrows, so lineage tools can trace which source fields feed into this computed field — even though the logic is expressed in prose.

### When the CLI encounters NL

The CLI extracts NL content verbatim with `satsuma nl`. It does not interpret it. If you ask "what does the `display_name` transform do?", the CLI returns the exact text. The agent then interprets that text in context.

---

## Mixed Transforms

Mixed transforms combine structural steps with NL:

```satsuma
PHONE_NBR -> phone {
  "Extract all digits. If 11 digits starting with 1, treat as US.
   If 10 digits, assume US country code +1. Format as E.164.
   For other patterns, attempt to determine country from @COUNTRY_CD."
  | warn_if_invalid
}
```

Here, the NL describes the extraction logic, and `warn_if_invalid` adds a deterministic error-handling step at the end. Read the transform top-to-bottom: the prose states the intended logic, then the structural step states an exact post-processing or validation action.

Another example:

```satsuma
Amount -> amount_usd {
  "Multiply by rate from @fx_spot_rates using @CurrencyIsoCode"
  | round(2)
}
```

The NL describes a lookup operation. The `round(2)` is a structural post-processing step.

---

## When to Formalize vs. When to Keep It Natural

This is a judgment call. Here are guidelines:

### Formalize when:
- The logic is a simple value mapping → use `map { }`
- The logic is a deterministic pipeline → use `trim | lowercase | ...`
- The logic can be expressed with existing vocabulary tokens
- You want the transform to be mechanically testable

### Keep it natural when:
- The logic involves conditional branching across multiple fields
- The logic references external systems or lookups
- The business rule is genuinely complex or ambiguous
- Formalizing would require inventing new syntax that nobody understands
- You're still figuring out what the rule should be

### Example: the right choice

```satsuma
// GOOD — formalize a simple enum mapping
CUST_TYPE -> customer_type {
  map { R: "retail", B: "business", G: "government", null: "retail" }
}

// GOOD — keep complex conditional logic natural
-> health_score {
  """
  Derive customer health based on multiple signals:
  - **healthy**: is_active = true AND (last_order_date within 90 days
    OR annual_contract_value > 0) AND open_tickets < 3
  - **churning**: is_active = false OR last_order_date > 180 days ago
  - **at_risk**: everything else
  """
}

// BAD — inventing pseudo-code nobody can parse
-> health_score {
  IF(is_active AND (DATEDIFF(last_order_date, NOW()) < 90 OR acv > 0) AND open_tickets < 3,
     "healthy",
     IF(NOT is_active OR DATEDIFF(last_order_date, NOW()) > 180, "churning", "at_risk"))
}
```

The NL version is longer but clearer. Anyone can read it. The pseudo-code version looks precise but is actually ambiguous — what dialect of SQL is `DATEDIFF`? What does `acv` refer to? The NL version is honest about being a specification, not executable code.

---

## How Agents Reason About NL Transforms

When the agent encounters an NL transform, it:

1. **Reads the NL content** extracted by the CLI (via `satsuma nl`).
2. **Identifies referenced fields** from `@ref` markers.
3. **Interprets the business intent** in context (what schemas are involved, what the mapping does).
4. **Can explain the logic** in business terms to the human.
5. **Can draft implementation code** in SQL, Python, or another language — but that's outside Satsuma.

The key insight: **the agent interprets NL while the CLI only extracts it verbatim**. This separation means:
- The CLI gives you exact structural facts about what NL exists and where.
- The agent gives you interpretation and reasoning about what the NL means.
- You decide whether the agent's interpretation is correct.

---

## Review Techniques for Ambiguous Business Rules

When reviewing NL transforms, ask:

1. **Is the intent clear?** Could two reasonable people interpret this differently?
2. **Are all inputs referenced?** Does the NL mention every source field it depends on (using `@ref` markers)?
3. **Are edge cases covered?** What happens with nulls, empty strings, unexpected values?
4. **Is the output specified?** Does the NL say what the result should look like?
5. **Could this be formalized?** If the logic is actually simple, a `map { }` or pipeline might be clearer.

If the answer to question 1 is "yes, this is ambiguous," that's valuable information. Add a `//?` comment:

```satsuma
-> discount_total {
  "Sum @DiscountAmount across order discount entries."
}                                                          //? should refunds reduce discount_total?
```

The ambiguity is now tracked and discoverable.

---

## Key Takeaways

1. Natural language in transforms is a deliberate design choice — it handles complexity that pseudo-code would make worse.
2. Transforms are classified as `[structural]`, `[nl]`, `[mixed]`, or `[none]` by syntax, and the CLI may also surface synthetic `[nl-derived]` lineage edges from `@ref` markers in NL.
3. `@ref` markers inside NL (e.g. `@field_name`) create traceable lineage connections.
4. The CLI extracts NL verbatim. The agent interprets it. The human approves the interpretation.
5. Formalize when you can. Keep it natural when formalization would obscure meaning or force false precision.

---

**Next:** [Lesson 07 — Nested Data, Arrays, and Complex Shapes](07-nested-mappings.md) — extending the mapping model to real nested payloads and repeated structures.
