---
name: satsuma-explainer
description: >
  Explain Satsuma (.stm) data mapping files in plain English for business stakeholders,
  analysts, and non-technical reviewers. Use this skill whenever the user asks to explain,
  summarize, review, walk through, or describe a Satsuma file or workspace — including
  requests like "what does this mapping do", "explain this to my PM", "review this spec",
  "what are the risks", "is anything missing", "onboarding summary", or "walk me through
  this". Also trigger when users ask for a data quality assessment, PII audit summary,
  coverage check, or impact analysis of a .stm file. This skill requires the `satsuma` CLI
  to be installed and available on PATH.
---

# Satsuma Explainer

Produce clear, jargon-free explanations of Satsuma mapping specs for non-technical
audiences, plus actionable risk/coverage/quality assessments for technical reviewers.

## Prerequisites

- The `satsuma` CLI must be installed and on PATH.
- The user must provide or reference one or more `.stm` files.

## Workflow

### 1. Gather structural context via CLI (do NOT read raw files yet)

Run these commands to build your understanding. Use `--json` for all calls so you
can process the output programmatically.

```bash
# a) Workspace overview — schemas, mappings, metrics, counts
satsuma summary <file>.stm --json

# b) Full workspace graph for topology and field-level flow
satsuma graph <file>.stm --json --no-nl

# c) All warnings and open questions
satsuma warnings <file>.stm --json

# d) Detect data modelling conventions
satsuma find --tag dimension --json 2>/dev/null
satsuma find --tag fact --json 2>/dev/null
satsuma find --tag hub --json 2>/dev/null
satsuma find --tag satellite --json 2>/dev/null
satsuma find --tag link --json 2>/dev/null

# e) Detect consumer schemas
satsuma find --tag report --json 2>/dev/null
satsuma find --tag model --json 2>/dev/null

# f) Check governance coverage
satsuma find --tag pii --json
satsuma find --tag classification --json 2>/dev/null
satsuma find --tag encrypt --json 2>/dev/null
satsuma find --tag retention --json 2>/dev/null
```

Use the results from (d) to determine whether the workspace follows Kimball,
Data Vault, or flat modelling conventions. This changes how you explain the
architecture — see `references/conventions-guide.md` for the full token
dictionaries and how to explain each pattern to different audiences.

### 2. Drill into each mapping

For every mapping found in the summary:

```bash
# Full mapping with arrows and transforms (an arrow's `srcs` lists every
# input of a multi-source arrow; `src` is only the first)
satsuma mapping "<mapping-name>" --json

# Target fields not covered by this mapping
satsuma fields <target-schema> --unmapped-by "<mapping-name>" --json

# NL content in this mapping (transforms, notes, comments)
satsuma nl "<mapping-name>"
```

### 3. Check for PII and governance concerns

```bash
# All PII-tagged fields
satsuma find --tag pii --json

# For each PII field, trace downstream
satsuma field-lineage <schema.field> --downstream --json
```

### 4. Read the raw file only if needed

Only read the `.stm` file directly if you need full context that the CLI
commands above didn't provide (e.g., note blocks with rich markdown, or
to quote a specific section back to the user).

### 5. Produce the explanation

Generate output following the format in `references/output-format.md`.
Adapt the depth and tone to the audience — see the audience guide below.

## Audience adaptation

| Audience | Tone | Focus | Skip |
|---|---|---|---|
| Product owner / BA | Conversational, no jargon | What data moves where, business rules, what's ambiguous | Types, pipe syntax, metadata tokens |
| Data engineer | Technical but concise | Transform logic, edge cases, unmapped fields, PII lineage | Basic "what is a schema" framing |
| Governance / audit | Formal, thorough | PII flow, encryption, data quality warnings, open questions | Implementation details |
| General / unknown | Friendly, mid-level | Everything at moderate depth, flag risks clearly | Nothing — cover all sections |

When unsure of the audience, default to "General / unknown".

## Key interpretation rules

1. **Arrow syntax**: `src -> tgt` means source feeds target. `a, b -> tgt` means
   multi-source. `-> tgt` (no left side) means computed/derived — flag these as
   needing human-defined logic.

2. **Transform classification**:
   - `[none]` — direct copy, no transformation. Safe and deterministic.
   - `[nl]` — natural language transform. Explain what it says; flag if ambiguous.
   - `[nl-derived]` — implicit dependency found in NL text via `@ref`. Flag as
     "inferred, not explicitly declared" so reviewers can verify.

3. **Comments matter**:
   - `//!` = known data quality warning. Always surface these prominently.
   - `//?` = open question or ambiguity. Always surface these as "needs decision".
   - `(note "...")` = documentation. Use to enrich your explanation.

4. **Metadata tokens**: Explain `(pii)`, `(required)`, `(encrypt ...)`,
   `(enum {...})`, `(format ...)`, `(default ...)` in plain English. Don't just
   list them — say what they *mean* for the data.

5. **Unmapped fields**: If `satsuma fields --unmapped-by` returns results, this is
   a gap. Explain which target fields have no source and what that implies.

6. **Data modelling conventions** (see `references/conventions-guide.md` for details):

   **Kimball** — When you see `(dimension)`, `(fact)`, `(grain ...)`, `(scd N)`:
   - Explain the star schema architecture: facts hold measurements, dimensions
     provide context for filtering and grouping.
   - For SCD 2 dimensions, explain that changes create new versions (history is
     preserved) and mention which fields trigger versioning (`track`) vs. which
     don't (`ignore`). Explain to non-technical audiences as: "When a customer's
     email changes, a new version of their record is created so we can see what
     it was before."
   - For facts, explain the grain in plain English: "One row per transaction line
     item" not "grain {transaction_id, line_number}."
   - Mention conformed dimensions: "This customer dimension is shared across
     multiple reports — a single source of truth."
   - Explain measure additivity when relevant: additive measures can be summed
     freely, semi-additive measures (like balances) can't be summed over time,
     non-additive measures (like percentages) can't be summed at all.
   - **Mechanical columns are inferred, not written.** Surrogate keys,
     valid_from/to, is_current, row_hash, etl_batch_id, loaded_at, and dimension
     foreign keys on facts are implied by the tokens. Mention them in technical
     explanations but don't flag their absence as a gap.

   **Data Vault** — When you see `(hub)`, `(satellite)`, `(link)`:
   - Explain the three-entity architecture: hubs store business keys, satellites
     store descriptive attributes that change over time, links capture
     relationships between hubs.
   - For non-technical audiences: "The hub is the master list of customers (just
     IDs). The satellite holds the details (name, email, etc.) and tracks every
     change. The link records which customers bought which products."
   - Mention effectivity satellites and driving keys when present.
   - **Mechanical columns are inferred.** Hash keys, load_date, load_end_date,
     record_source, and hash_diff are implied. Don't flag their absence.

7. **Merge strategy** — When mappings carry `(merge ...)` tokens:
   - `merge upsert` — "New records are inserted; existing records (matched by
     [match_on field]) are updated."
   - `merge append` — "Every record is inserted as a new row. No updates, no
     deletes. Used for event logs and audit trails."
   - `merge soft_delete` — "Records are never physically deleted. Instead, a
     [delete_flag] is set to true. This preserves history for audit."
   - `merge full_refresh` — "The entire target is wiped and reloaded from
     scratch. If the source is incomplete, data is lost." Flag safety notes.
   - Explain `on_match` and `on_no_match` overrides if present.
   - Flag SCD + merge conflicts: `merge full_refresh` + `scd 2` destroys
     history — always call this out as a risk.

8. **Governance metadata** — Beyond `pii` and `encrypt`, also explain:
   - `(classification "LEVEL")` — the sensitivity tier. Explain what access
     restrictions this implies. Flag if `pii` is present without `classification`
     as a governance gap.
   - `(retention "Ny")` — how long data is kept. Mention field-level overrides
     (e.g., email at 3 years inside a 7-year schema).
   - `(mask <strategy>)` — how the field is displayed to restricted users. Explain
     the masking approach (e.g., "only the last four digits are shown").
   - `(owner "...")` / `(steward "...")` — who is responsible.
   - `(compliance {GDPR, SOX})` — which regulations apply. Mention the
     obligations each framework implies.
   - Run a governance completeness check: every PII field should have
     classification, every classified field should have encryption or a note
     explaining why not, every schema with PII should have an owner.

9. **Consumer schemas** — When you see `(report)` or `(model)`:
   - These are the end-points — dashboards, reports, ML models that people
     actually use. They consume data but don't produce it.
   - Explain `(source {schemas})` as the upstream dependencies: "This dashboard
     reads from the orders fact table and the customer dimension."
   - Mention `(tool looker)`, `(refresh schedule "...")`, `(registry mlflow)`,
     and similar operational metadata.
   - For impact analysis: trace from upstream changes through to which consumers
     are affected.
   - Fields on a report = visible measures and dimensions. Fields on a model =
     input features and prediction outputs.

## What NOT to do

- Do not attempt to validate whether NL transforms are *correct* — you can only
  report what they say and flag ambiguity.
- Do not invent field mappings that aren't in the spec.
- Do not assume the audience knows what Satsuma is — briefly introduce it if the
  explanation will be shared outside the team.
- Do not reproduce the `.stm` syntax verbatim in explanations for non-technical
  audiences. Translate everything to prose.
