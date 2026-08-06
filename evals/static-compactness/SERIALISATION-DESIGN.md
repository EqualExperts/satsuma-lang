# The "equivalent YAML" design — Feature 44, arms Y and J

**Status: committed 2026-08-06, before the measurement was run.**

This document defines what "the same mapping expressed as YAML" means, so that
`reference/static-compactness.md` measures something a sceptic can check.

Read this first. The design decides the answer, and saying so plainly is the
only way the resulting number means anything.

## Why this document has to exist

The site claims Satsuma is "40–60% smaller than YAML" in seven places.
`docs/product-owner/PROJECT-OVERVIEW.md:202` attributes the figure to "our v3",
a YAML design that predates this repository. **There is no YAML mapping spec
anywhere in this repo.** So "equivalent YAML" is not something we can look up;
it has to be designed, and whoever designs it sets the answer.

Feature 44's PRD names this hazard for spreadsheets: the four serialisation
choices "span more than an order of magnitude", and picking the biggest "would
not be a measurement, it would be a rhetorical device". YAML has exactly the
same exposure. A naive dump of the parser's projection measures **1,602 tokens**
on `examples/sfdc-to-snowflake/pipeline.stm`; the design below measures **814**
for the same facts. Choosing the first would have "proved" a 49% reduction.

## The governing principle: charitable to YAML

**Where two encodings are equally faithful, take the shorter one.** The measured
ratio is then a *lower bound* on Satsuma's advantage, which is the only kind of
number worth publishing about your own product.

This mirrors the PRD's logic for spreadsheet profile P0 being "adversarially
favourable to Excel": bound the claim by the case that flatters it least.

The counterweight is **totality**. Every fact in the `.stm` must be present, or
the arms are not paired: a fact dropped from YAML makes YAML smaller and
Satsuma's advantage larger. Savings bought by dropping information are the one
failure mode that invalidates the whole exercise.

These two pull against each other, and that tension is the design work. It is
also, as it turns out, a *small* tension — see [How much the design choice can
possibly matter](#how-much-the-design-choice-can-possibly-matter).

## How the design was produced

Three independent designs were commissioned from deliberately different angles —
terse-maximalist, idiomatic-conventional (dbt/JSON-Schema style), and
flat-relational — and each was scored by three judges applying one lens each:
totality, terseness, and author plausibility. The final design takes the
name-keyed design as its basis and grafts every improvement that survived
scrutiny.

The flat-relational design was rejected as a basis despite being smallest,
because its positional tuples bought their size by dropping facts in four
places. The idiomatic design was rejected because its `- name:` / `type:` record
scaffolding costs about 14% for no gain in fidelity — a lower-bound arm cannot
carry that.

## The design

### Three rules that cover everything

**The open rule.** Reserved keys are listed per level below. Any other key is a
Satsuma vocabulary token, spelled verbatim. Satsuma's vocabulary is open-ended
(spec §2.7), so a fixed key list could never be total. A token's value shape
mirrors its Satsuma argument shape:

| Satsuma | YAML |
|---|---|
| `(pk)` `(required)` | `pk: true` `required: true` |
| `(default USD)` `(ref a.b)` | `default: USD` `ref: a.b` |
| `(enum {a, b})` | `enum: [a, b]` |

**The escape rule.** Any name-keyed collection may repeat a key by giving it a
sequence of the values it would otherwise hold. This is the single mechanism for
everything Satsuma permits and YAML does not: several `//!` comments in one
schema, two arrows into one target, repeated metadata tokens. It costs 2 tokens
at the colliding key and nothing anywhere else.

**The two quoting rules.**

- **Q1** — prose is *always* double-quoted (`note`, `doc`, `rule`, `nl`,
  `filter`, `"!"`, `"?"`, and any value containing an `@ref`). Unquoted plain
  scalars truncate silently at ` #` and fail hard on `: `, `{`, `[` and a
  leading `@` — all of which occur in `examples/`. This costs tokens and is
  paid because silent truncation is a fact loss.
- **Q2** — every other scalar is bare unless it contains `,` in flow context,
  begins with a YAML indicator, or would resolve to a non-string type. So
  `STRING(120)` is bare in block context and `"CURRENCY(18,2)"` is quoted inside
  `{ }`.

**Not used anywhere:** anchors, aliases, merge keys, custom tags. They would save
about 6 tokens, and they assert a shared type node the `.stm` does not have.
Refusing them is also what lets the JSON arm be a pure mechanical lowering of the
same tree rather than a second design.

### Structure

```text
DOCUMENT   reserved: imports doc schemas fragments transforms mappings "!" "?"
  imports:    {<path>: [<name>, …]}    several imports of one path merge
  doc:        |block                   the file's own note { } block
  schemas:    {<name>: SCHEMA}
  fragments:  {<name>: SCHEMA}
  transforms: {<name>: BODY}
  mappings:   {<name>: MAPPING}        an anonymous mapping is keyed ""

SCHEMA     reserved: fields doc namespace "..." "!" "?"
  note/namespace/<token>: …            block metadata, per the open rule
  "...":   [<fragment>, …]             a fragment spread
  fields:  {<name>: FIELD, …}          declaration order preserved

FIELD      reserved: type fields "..." "!" "?"
  <scalar>                             SHORTHAND: the type expression verbatim
| {type: <scalar>, <token>: …,         type plus metadata
   fields: {…}}                        a record / list_of record body

MAPPING    reserved: source target arrows namespace "!" "?"
  source: <ref> | [<ref>, …]
  target: <ref> | [<ref>, …]
  arrows: {<target path>: ARROW, …}    arrow order preserved

ARROW      reserved: from each flatten steps rule values enumerates "!" "?"
  <scalar>                             SHORTHAND: the source path (`a -> b`)
| {from:  <path> | [<path>, …],        absent = a computed arrow (`-> tgt`)
   each/flatten: <src list path>,      replaces `from` on an iterating arrow
   rule:  "prose",                     a leading natural-language step
   steps: STEP | [STEP, …],            the mechanical pipe chain, in order
   values: {<in>: <out>, …}}           a map { } literal, `_` an ordinary key

STEP
  <scalar>                             a vocabulary token, verbatim
| {nl: "prose"}                        a natural-language step
```

### Worked example

`examples/sfdc-to-snowflake/pipeline.stm` (103 lines, 812 tokens as authored)
renders to 814 tokens of YAML. This output is produced mechanically by
`scripts/static-compactness-render.mjs`, not written by hand:

```yaml
imports:
  ../lib/sfdc_fragments.stm: [sfdc standard types]
  ../lookups/finance.stm: [fx_spot_rates]
doc: |-
  # Salesforce to Snowflake Pipeline

    Maps Sales Cloud `Opportunity` and `Account` objects into the
    `ANALYTICS.RAW_SFDC` schema.

    ## Sync Strategy
    - **Incremental:** Uses `SystemModStamp` to pull changes every 15 minutes.
    - **Hard Deletes:** Captured via the `isDeleted` flag in SFDC.
schemas:
  sfdc_opportunity:
    note: "SFDC Opportunity Object"
    "!": "manual override used by Finance"
    fields:
      Id: {type: ID, pk: true}
      Name: {type: STRING(120), required: true}
      AccountId: {type: ID, ref: sfdc_account.Id}
      Amount: CURRENCY(18,2)
      CurrencyIsoCode: {type: STRING(3), default: USD}
      StageName: {type: PICKLIST, enum: [Prospecting, Qualification, Value Prop, Closed_Won, Closed_Lost]}
      CloseDate: {type: DATE, required: true}
      Probability: PERCENT(3,0)
      Lead_Source_Detail__c: STRING(255)
      ARR_Override__c: CURRENCY(18,2)
      SystemModStamp: {type: DATETIME, required: true}
mappings:
  opportunity ingestion:
    source: [sfdc_opportunity, fx_spot_rates]
    target: snowflake_opps
    arrows:
      opp_key: Id
      amount_raw: {from: Amount, steps: coalesce 0}
      amount_usd: {from: Amount, rule: "Multiply by rate from @fx_spot_rates lookup using CurrencyIsoCode", steps: round 2}
      pipeline_stage:
        from: StageName
        values: {Prospecting: top_funnel, Qualification: mid_funnel, Value Prop: mid_funnel, Closed_Won: closed_won, Closed_Lost: closed_lost, _: unknown}
      is_closed: {rule: "True if @StageName is Closed_Won or Closed_Lost, false otherwise."}
      ingested_at: {from: SystemModStamp, steps: to_utc}
```

(Two schemas and four arrows elided for length; the full rendering is what the
measurement counts.)

## Savings taken, and savings declined

**Taken, because they measured free or nearly free:**

- Collections keyed by name rather than `- name:` records — worth about 14%, and
  safe because `validate.ts` already makes a duplicate schema name an error.
- The scalar shorthand for a field that is only a type, and for an arrow that is
  only a source path.
- Full key names, having verified they cost nothing: `type:` and `t:` are both
  2 tokens, and `target:` is *cheaper* than `tgt:`.
- Flow style for fields and arrows, which measured 1–4 tokens cheaper per
  construct than block style.

**Declined, and priced, so the choice is auditable:**

| Declined | Worth | Why |
|---|---|---|
| Bare null-valued flags (`{type: ID, pk}`) | ~2% | Needs a schema-aware loader; diverges from JSON |
| Positional tails (`Name: [STRING(120), required]`) | ~4% | Unreviewable |
| Anchors and merge keys | ~0.7% | Assert structure the `.stm` does not; JSON cannot express them |

Taking all of them would move the flagship example to roughly parity. That is
the lower bound of the lower bound, and it is stated here rather than buried.

## Known asymmetries, stated rather than hidden

**Comments.** The projection has no comment construct, so the YAML arm carries
no `#` comments while a `.stm` carries `//` ones. The measurement therefore
reports the **comment-free** comparison as its like-for-like figure, stripping
`//` comments from the `.stm` via the CST (never by regex — `//` occurs inside
natural-language transform bodies throughout the corpus). The file *as authored*
is reported alongside, and the gap between the two columns is large: about 8
points of median. Neither figure is hidden.

**Warning granularity.** `extractWarnings` reports a `//!` comment's parent as
the enclosing *schema*, not the field it was written on, so the YAML attaches it
at schema level. The `.stm` reader gets slightly better placement than the YAML
reader here — an asymmetry that costs YAML nothing and Satsuma nothing.

**Order.** Neither a YAML mapping nor a JSON object is ordered by specification,
yet field and arrow order are facts. Every mainstream parser preserves insertion
order and both arms rely on that equally, so the assumption cannot bias the
comparison. It is named here rather than left implicit.

**Prose versus token is lexical in Satsuma and structural in YAML.** Bare `trim`
is a vocabulary token; `"trim"` is prose. YAML quoting carries no such meaning,
so the distinction moves into the key: a bare element of `steps:` is mechanical,
`{nl: "…"}` is prose. The residual is that a YAML author who writes
`steps: Multiply by the spot rate` produces a file that is total in bytes and
wrong in meaning, and nothing catches it. That is a **quality** finding, not a
size one, and it belongs in the write-up rather than the token count.

**JSON print style.** The JSON arm is emitted at 2-space indentation, because
the arm has to be an artifact a team would maintain and review. Minifying it
would shrink it by roughly a third with no change of information — the clearest
demonstration in the whole exercise that serialisation choice, not format,
decides the answer if you let it.

## How totality is enforced

Two independent guards run on every spec in the corpus, and both fail the
measurement rather than warn:

1. **`assertRoundTrips`** parses the emitted YAML back and diffs it against the
   tree it was built from. This proves the YAML *says* what the renderer meant,
   catching hand-rolled quoting bugs.
2. **`assertFactsPreserved`** walks the projection and requires every authored
   string to be reachable in the parsed YAML. This proves the renderer built
   everything the projection *found*.

The second guard is the one that protects the number, and it earned its place.
Every gap it caught when first written — dropped namespaces, metrics rendered
twice and losing their metadata in the collision, several `//!` comments
colliding on one key, `each`/`flatten` arrows silently becoming plain ones —
made the YAML arm smaller and Satsuma's advantage larger. Fixing them moved the
median reduction against YAML from **−1.7%** to **+9%**.

`assertTotality` covers the third direction: a future language construct
appearing in the projection with no rendering fails immediately rather than
dropping out of the arms unnoticed.

## How much the design choice can possibly matter

This is the argument that decides whether the measurement is worth anything.

On the flagship example, the design measures 814 tokens; the smallest defensible
YAML anyone produced measures about 810; the `.stm` is 812 (768 comment-free).
**The entire span of defensible YAML encodings is under 7% of the file.**

The published claim needs a ratio of 1.67×–2.50×. The measured range across 21
specs is 1.03×–1.28×. No resolution of the design questions gets from one to the
other, so the finding survives any reasonable disagreement about braces.

That is why the design is committed before the number is quoted, and why the
declined savings are priced rather than merely mentioned: the honest test of a
measurement like this is whether it would still hold if a hostile reviewer
re-made every judgement call. Here it would.

## Reproducing

```bash
npm run build:all
npm run measure:static-compactness   # rewrites reference/static-compactness.{json,md}
```

Change any rule above, rerun, and the committed report changes with it.
