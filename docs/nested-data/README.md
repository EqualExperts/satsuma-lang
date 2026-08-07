# Nested and Repeated Data in Satsuma

Hierarchy is where mapping specifications usually go vague. A spreadsheet row can
say `order.customer.email → customer_email`, but it has nowhere to say _what
happens to the list of line items_, _which list the target rows come from_, or
_whether the two arrays that arrived side by side line up_. Those are exactly the
questions that break a pipeline in production.

Satsuma answers them with a small vocabulary:

| Concern                                    | Construct                |
| ------------------------------------------ | ------------------------ |
| A single nested structure                  | `record { }`             |
| A repeated structure                       | `list_of record { }`     |
| A repeated primitive                       | `list_of TYPE`           |
| Map a list, keeping the hierarchy          | `each src -> tgt { }`    |
| Map a list, one output row per element     | `flatten src -> tgt { }` |
| Address a field inside the current element | `.field`                 |

This guide walks that vocabulary from a two-field record up to a three-level XML
hierarchy, then explains **how nesting changes what `satsuma coverage` counts** —
the part that decides whether a partially mapped record shows up as a gap or
silently passes a CI gate.

Every Satsuma block in this guide is a real file that parses, validates,
formats, and (where it contains a mapping) produces the coverage output quoted
beneath it.

**Running scenario.** Rangers at the Puffin Point seabird colony walk fixed
_transects_, recording _sightings_ of each species, and read the _rings_ on
birds they catch. A field tablet emits the survey; a science portal wants a
nested JSON document; the analytics lake wants one flat row per sighting.

---

## 1. Three shapes, one declaration syntax

Every field — scalar, record, or list — is declared the same way:

```
NAME [TYPE] [(metadata)] [{ body }]
```

`record` and `list_of record` occupy the TYPE slot, so nesting needs no new
syntax:

```satsuma
schema colony_survey (format json) {
  survey_id     UUID            (pk, required)
  surveyed_at   TIMESTAMPTZ     (required)

  observer record {
    ranger_id  STRING(12)  (required)
    email      STRING      (pii)
  }

  weather_tags  list_of STRING

  sightings list_of record {
    species_code  STRING(6)  (required)
    adults        INT
    chicks        INT
  }
}
```

Three things about this are worth stating explicitly, because each one is a
mistake people make on their first nested schema:

- **`list_of STRING` needs no braces.** A list of primitives has no subfields to
  declare. `weather_tags` is one field, whether it holds zero tags or nine.
- **A braced body always needs `record` or `list_of record` in front of it.**
  `observer { ... }` without the keyword is a parse error — Satsuma will not
  guess that you meant a record.
- **The type stays on the field's line.** A name on one line and `record` on the
  next is two invalid fields, not one wrapped field.

Metadata goes between the type and the body, so a list can carry governance,
format, or filter tokens of its own:

```satsuma
sightings list_of record (filter species_code != "UNK", note "Confirmed identifications only") {
  species_code  STRING(6)  (required)
}
```

Records nest to any depth. The full survey schema used for the rest of this
guide is four levels deep — survey → transects → sightings → rings:

```satsuma
schema colony_survey (format json) {
  survey_id     UUID            (pk, required)
  surveyed_at   TIMESTAMPTZ     (required)

  observer record {
    ranger_id  STRING(12)  (required)
    email      STRING      (pii)
  }

  weather_tags  list_of STRING

  transects list_of record {
    transect_ref  STRING(8)  (required)
    length_m      INT

    sightings list_of record {
      species_code  STRING(6)  (required)
      adults        INT
      chicks        INT

      rings list_of record {
        ring_id    STRING(16)  (required)
        condition  STRING
      }
    }
  }
}
```

---

## 2. Addressing a nested field

A field's path is its ancestors joined with dots:
`transects.sightings.species_code`.

**Paths never contain indices.** `transects[0].sightings` is a parse error, and
so is `transects[*]`. Repetition is expressed by the iteration keywords, never by
the path — which is why a single path can describe every element of every transect
at once. (Format-specific addresses such as JSONPath's `[*]` do appear, but only
inside quoted metadata — see [section 6](#6-hierarchies-anchored-to-xml-or-json).)

Inside an `each` or `flatten` block, a leading `.` marks a path as relative to
the element currently being iterated:

```satsuma
each transects -> transects {
  .transect_ref -> .ref        // transects.transect_ref -> transects.ref
}
```

### The resolution rule

Every path written inside a block is prefixed with that block's own path. This
applies whether or not you wrote the leading dot — the dot documents the intent,
it does not change the result:

| Inside                                         | Written                  | Resolves to                                     |
| ---------------------------------------------- | ------------------------ | ----------------------------------------------- |
| `each transects -> transects`                  | `.transect_ref`          | `transects.transect_ref`                        |
| `each transects` → `each sightings -> .counts` | `.adults`                | `transects.sightings.adults`                    |
| `flatten transects.sightings -> rows`          | `.species_code`          | `transects.sightings.species_code`              |
| `flatten transects.sightings -> rows`          | `transects.transect_ref` | `transects.sightings.transects.transect_ref` ❌ |

That last row is the trap. **There is no notation for escaping outward to an
ancestor.** A parent field referenced from inside a block gets the block's prefix
like everything else, producing a path that does not exist:

```
warning [field-not-in-schema] Arrow source
'transects.sightings.transects.transect_ref' not declared in schema 'colony_survey'
```

Write the arrow _outside_ the block instead — where its path is already absolute:

```satsuma
transects.transect_ref -> transect_ref     // ✅ outside the block

flatten transects.sightings -> sighting_rows_parquet {
  .species_code -> species_code
}
```

For `flatten` this reads naturally: fields outside the block are the row's
context and repeat on every output row. For a nested `each` it is a real
limitation — you cannot state "the parent's transect ref populates a field on
each child element". Say it in a `note` until the grammar grows an escape.

---

## 3. `each` — iterate a list, keep the hierarchy

`each` maps one list onto another: one target element per source element,
structure preserved. The science portal wants exactly that.

```satsuma
// --- Target: science portal document ---
schema colony_report_json (format json) {
  report_id   UUID         (required)
  counted_at  TIMESTAMPTZ  (required)

  recorder record {
    code  STRING(12)  (required)
  }

  transects list_of record {
    ref  STRING(8)

    counts list_of record {
      species  STRING(6)
      birds    INT
    }

    ringed_birds list_of record {
      ring       STRING(16)
      condition  STRING
    }
  }
}

mapping `colony report` {
  source { colony_survey }
  target { colony_report_json }

  survey_id -> report_id
  surveyed_at -> counted_at
  observer.ranger_id -> recorder.code

  each transects -> transects (note "One report transect per surveyed transect.") {
    .transect_ref -> .ref

    each sightings -> .counts {
      .species_code -> .species
      .adults, .chicks -> .birds { "Sum adults and chicks" }
    }

    flatten sightings.rings -> .ringed_birds {
      .ring_id -> .ring
      .condition -> .condition
    }
  }
}
```

Three levels of nesting in nine lines of mapping, and each construct is doing
something the others cannot:

- **`each transects -> transects`** — one report transect per surveyed transect.
- **`each sightings -> .counts`** (nested) — the second level of hierarchy is
  preserved; each transect keeps its own list of species counts.
- **`flatten sightings.rings -> .ringed_birds`** (nested) — `rings` is _doubly_
  nested under a transect (one list per sighting). Flattening lifts every ring
  from every sighting into a single per-transect list.

A record on both sides needs no iteration at all: `observer.ranger_id ->
recorder.code` addresses the leaf directly. Reach for `each` when a _list_ is
involved, not merely because something is nested.

```
$ satsuma coverage colony-report.stm

  source  colony_survey          9/12   75%
  target  colony_report_json      8/8  100%
    uncovered in colony_survey (source): 3 fields
      observer.email, weather_tags, transects.length_m
```

Every target field is populated; three source fields were not consumed. That
asymmetry is normal and is the reason coverage reports the two roles separately.

---

## 4. `flatten` — one output row per element

The analytics lake wants a table, not a document: one row per sighting, with the
survey and transect identifiers repeated on every row.

```satsuma
// --- Target: analytics lake, one row per sighting ---
schema sighting_rows_parquet (format parquet) {
  survey_id     UUID
  transect_ref  STRING(8)
  species_code  STRING(6)
  total_birds   INT
}

mapping `sighting rows` {
  source { colony_survey }
  target { sighting_rows_parquet }

  survey_id -> survey_id
  transects.transect_ref -> transect_ref

  flatten transects.sightings -> sighting_rows_parquet {
    .species_code -> species_code
    .adults, .chicks -> total_birds { "Sum adults and chicks" }
  }
}
```

- The `flatten` header names the list that determines **row cardinality** — one
  output row per sighting, across all transects.
- Arrows **inside** the block address the current element (`.species_code`).
- Arrows **outside** the block are context and are **repeated on every row**.
  `survey_id` is constant for the file; `transects.transect_ref` varies per row,
  because the flattened path runs through `transects`.

```
$ satsuma coverage sighting-rows.stm

  source  colony_survey             5/12   41%
  target  sighting_rows_parquet      4/4  100%
    uncovered in colony_survey (source): 7 fields
      surveyed_at, observer.ranger_id, observer.email, weather_tags,
      transects.length_m, transects.sightings.rings.ring_id,
      transects.sightings.rings.condition
```

A flattening mapping consumes a _slice_ of a hierarchy, so a low source
percentage here is expected — the same schema reaches 75% under the document
mapping in section 3, and the fields neither one touches are the real gaps. That
is what the **aggregate** section of a multi-mapping report exists to tell you.

### Choosing between them

|                                  | `each`                                 | `flatten`                                    |
| -------------------------------- | -------------------------------------- | -------------------------------------------- |
| Target shape                     | a list, nested where the source was    | rows (or a flat list)                        |
| Cardinality                      | one target element per source element  | one output row per element of the named list |
| Typical use                      | JSON/XML document to JSON/XML document | hierarchy to warehouse table                 |
| Sibling arrows outside the block | populate the enclosing level           | repeat on every output row                   |

Both can nest inside each other, in any combination — `flatten` inside `each` (as
in section 3) lifts a deep list into a shallower one without abandoning the
hierarchy above it.

---

## 5. Two parallel lists — the "zip" question

Legacy exports love to send data as parallel arrays: a list of birds and a list
of weights, correlated only by position. Satsuma has **no `zip` operator**, and
no way to bind the current element of a _scalar_ list — `each species_codes ->
observations { . -> .species }` is a parse error (`unexpected '.'`). Positional
correlation is expressed by arrows plus a stated rule.

### Lists of records — two `each` blocks over one target list

```satsuma
// Ringing station tablet: two parallel lists, correlated by position
schema ringing_tablet (format json) {
  session_id  STRING  (pk)

  birds list_of record (jsonpath "$.birds[*]") {
    ring_id  STRING  (jsonpath ".ring")
  }

  weights list_of record (jsonpath "$.weights[*]") {
    mass_g  DECIMAL(6,1)  (jsonpath ".mass")
  }
}

schema ringing_records (format parquet) {
  session_id  STRING

  captures list_of record {
    ring    STRING
    mass_g  DECIMAL(6,1)
  }
}

mapping `ringing capture records` {
  note {
    "The tablet emits birds and weights as two positionally-correlated lists:
     weights[i] is the mass of birds[i]. Reject the batch if the two lists
     differ in length — there is no key to re-align them on."
  }

  source { ringing_tablet }
  target { ringing_records }

  session_id -> session_id

  each birds -> captures (note "One capture per ringed bird, in tablet order.") {
    .ring_id -> .ring
  }

  each weights -> captures (
    note "Positional join to @birds — weights[i] belongs to birds[i]."
  ) {
    .mass_g -> .mass_g
  }
}
```

Two `each` blocks write into the same target list, each contributing its own
columns. The correlation rule lives in a `note` on the second block — and the
`@birds` reference makes it traceable, not merely readable. Coverage: **3/3
source, 3/3 target**.

### Scalar lists — address the target leaves directly

With `list_of STRING` there is no element to bind, so map each list onto the
target leaf it fills:

```satsuma
// Older tablet firmware: two parallel *scalar* lists
schema tablet_v1_export (format json) {
  transect_ref   STRING(8)       (pk)
  species_codes  list_of STRING
  counts         list_of INT
}

schema portal_transect (format json) {
  ref  STRING(8)

  observations list_of record {
    species  STRING
    birds    INT
  }
}

mapping `v1 transect observations` {
  note {
    "Firmware 1.x emits species_codes and counts as positionally-correlated
     scalar lists: counts[i] is the tally for species_codes[i]. There is no
     element key, so the two arrows below are the only way to state the
     correspondence — reject the file if the lengths differ."
  }

  source { tablet_v1_export }
  target { portal_transect }

  transect_ref -> ref
  species_codes -> observations.species
  counts -> observations.birds
}
```

Coverage: **3/3 source, 3/3 target**. Note that `species_codes` counts as _one_
field however many elements it holds — a scalar list is a leaf.

### What not to write

The tempting shorthand is a multi-source arrow onto the list itself:

```satsuma
species_codes, counts -> observations {
  "Zip the two parallel lists by position."
}
```

It parses, but it costs you the coverage and earns a lint warning:

```
  source  tablet_v1_export      3/3  100%
  target  portal_transect       1/3   33%
    uncovered in portal_transect (target): 2 fields
      observations.species, observations.birds

warning [unenumerated-record-target] Arrow 'species_codes, counts -> observations'
targets a record, but no source is a record and the body lists no child arrows —
so which fields of 'observations' it populates is unstated, and coverage counts
them as gaps. A multi-source arrow's body is a transform pipeline, not a nesting
scope (§4.4), so it cannot enumerate children, and none of species_codes, counts
is a record either — write one arrow per target leaf instead (e.g.
'species_codes -> observations.<leaf>').
```

Which field receives the species and which receives the count is genuinely
unstated, so coverage is right to withhold it. The warning names the only
remedy that actually applies here — one arrow per target leaf, the form shown
above. (The other two remedies `lint` offers for a single-source arrow do not
apply to a multi-source one: enumerating children is a parse error, because a
multi-source arrow's body is a transform pipeline, not a nesting scope, and
there is no record among the sources to map from either.)

---

## 6. Hierarchies anchored to XML or JSON

When the source is XML or JSON, two addressing systems coexist, and keeping them
in their own lanes is what makes the spec readable:

- **The Satsuma path** — declared by the `record` / `list_of record` nesting,
  index-free, and what every tool (lineage, coverage, arrows) uses.
- **The extraction address** — the format's own idiom (`srv:Transect`, `@id`,
  `$.data.transects[*]`), living entirely inside quoted metadata.

### XML with namespaces and XPath

```satsuma
// Partner NGO submits the same survey as XML
schema colony_submission_xml (
  format xml,
  namespace srv "http://seabirds.example.org/survey/v3",
  namespace geo "http://seabirds.example.org/geo/v1"
) {
  Survey record (xpath "/srv:ColonySubmission/srv:Survey") {
    SurveyId  STRING  (xpath "@id", required)

    Colony record (xpath "srv:Colony") {
      Name     STRING  (xpath "srv:Name")
      GridRef  STRING  (xpath "geo:GridRef")
    }

    Transects list_of record (xpath "srv:Transects/srv:Transect") {
      Ref  STRING  (xpath "@ref")

      Sightings list_of record (xpath "srv:Sighting") {
        Species  STRING  (xpath "srv:Species/@code")
        Adults   INT     (xpath "srv:Count[@stage='adult']")
        Chicks   INT     (xpath "srv:Count[@stage='chick']")
      }
    }
  }
}

// The colony name lives above the flattened list, so it is a row-context field
schema colony_sighting_rows_parquet (format parquet) {
  survey_id     STRING
  colony_name   STRING
  transect_ref  STRING
  species_code  STRING
  total_birds   INT
}

mapping `xml sighting rows` {
  source { colony_submission_xml }
  target { colony_sighting_rows_parquet }

  Survey.SurveyId -> survey_id
  Survey.Colony.Name -> colony_name
  Survey.Transects.Ref -> transect_ref

  flatten Survey.Transects.Sightings -> colony_sighting_rows_parquet {
    .Species -> species_code { trim | uppercase }
    .Adults, .Chicks -> total_birds {
      "Sum adults and chicks; treat missing as 0"
    }
  }
}
```

The XPath on a record is the **context node** for its children, so child paths
stay relative (`srv:Name`, `@ref`) — the same containment the Satsuma nesting
expresses. A `flatten` header takes a full path of any depth
(`Survey.Transects.Sightings`), so an XML document three elements deep still
flattens in one block.

```
  source  colony_submission_xml             6/7   85%
  target  colony_sighting_rows_parquet      5/5  100%
    uncovered in colony_submission_xml (source): 1 field
      Survey.Colony.GridRef
```

### JSON with JSONPath

```satsuma
// Same hierarchy, arriving from a REST API instead of a tablet
schema colony_api_page (format json) {
  page record (jsonpath "$.meta") {
    number      INT     (jsonpath "$.meta.page")
    next_token  STRING  (jsonpath "$.meta.next")
  }

  transects list_of record (jsonpath "$.data.transects[*]") {
    ref          STRING  (jsonpath ".ref")

    sightings list_of record (jsonpath ".sightings[*]") {
      species  STRING  (jsonpath ".species.code")
      adults   INT     (jsonpath ".counts.adult")
      chicks   INT     (jsonpath ".counts.chick")
    }

    raw_payload  JSON    (jsonpath ".", note "Whole element kept for replay")
  }
}
```

Convention (see the [JSON path guide](../conventions-for-schema-formats/json/conventions.md)):
absolute `$.` paths on top-level and `record` fields, relative `.field` paths
inside a `list_of record` whose parent already declares the `[*]` iteration. A
subtree you want to keep intact is a `JSON`-typed leaf, not a record — and it
counts as one field.

---

## 7. What coverage counts

`satsuma coverage` answers "which declared fields is nothing mapping yet?".
Nesting changes the answer in four specific ways. All of them exist to stop a
percentage from either hiding real work or manufacturing false completeness.

### Only leaves are counted

A record and its children describe the same data, so counting both would count
it twice and let _nesting depth alone_ move a percentage. Records are therefore
excluded from the numerator and denominator ([ADR-034](../../adrs/adr-034-leaf-only-coverage-counting.md)).

In the survey schema, `observer` and `transects` are structure; the twelve
counted fields are the leaves beneath them (`weather_tags`, a scalar list,
included — it is a leaf).

Re-nesting a schema without changing a single arrow leaves every percentage
unchanged. That is the property the rule buys.

### A record's own state is derived from its leaves

Records still _have_ a coverage state, but it is computed bottom-up and has
three values ([ADR-037](../../adrs/adr-037-container-coverage-and-whole-structure-arrows.md)):

| State       | Meaning                          |
| ----------- | -------------------------------- |
| `covered`   | every descendant leaf is covered |
| `partial`   | at least one, but not all        |
| `uncovered` | none                             |

This is what the editor gutter and the viz overlay paint, and what the CLI shows
as a tree when you ask which fields a mapping missed:

```
$ satsuma fields colony_survey --unmapped-by "colony report" colony-report.stm

  observer      record
    email  STRING
  weather_tags  list_of STRING
  transects     list_of record
    length_m  INT
```

`observer` appears because one of its two leaves is a gap — a _partial_ record.
It contributes nothing to the count itself; the leaf beneath it does.

`satsuma coverage` does not yet print the states themselves (no
`records: {covered, partial, uncovered}` line, and `--json` lists leaves only) —
read the tree above, the editor gutter, or the viz card until `sl-lctd` lands.

### A whole-structure arrow covers its whole subtree

Copying a record wholesale is a legitimate mapping, and enumerating twelve
identical child arrows to prove it would be busywork. So an arrow onto a record
confers coverage on everything beneath it, provided:

1. **it states a correspondence, not an iteration** — a `map` or nested arrow;
   an `each`/`flatten` header asserts no field-by-field correspondence, and a
   computed arrow has no source at all; and
2. **its body enumerates no child arrows** — listing one child means you are
   claiming that child _and no others_.

For a **target-side** record there is a third condition: at least one source
path must itself name a declared record
([ADR-038](../../adrs/adr-038-whole-structure-expansion-requires-a-container-source.md)).
One scalar cannot fill twelve leaves, and a gate must not be passable by writing
a vaguer arrow.

Each row below is a real file; the numbers are its actual coverage. The record
`station`/`site` has three leaves, plus one scalar field each side, so 4 is a
full house.

| Arrow written                        | Source  | Target  | Why                                                                       |
| ------------------------------------ | ------- | ------- | ------------------------------------------------------------------------- |
| `station -> site`                    | **4/4** | **4/4** | whole-structure copy, both ends are records                               |
| `station -> site { }`                | **4/4** | **4/4** | an empty body enumerates nothing — still a whole-structure copy           |
| `station -> site { .code -> .code }` | 2/4     | 2/4     | enumerating one child claims that child only; `lat`/`lon` are gaps        |
| `each hops -> relays { }`            | 1/3     | 1/3     | an iteration header asserts nothing about fields; empty body maps nothing |
| `station -> id` (record → scalar)    | **4/4** | 1/4     | the whole record was _read_; one scalar target field was written          |
| `ping_id -> site` (scalar → record)  | 1/4     | 1/4     | + `lint` warns `unenumerated-record-target`                               |

Two of these are worth internalising because they look alike and behave
oppositely:

```satsuma
station -> site { }        // covers code, lat, lon  — "the whole record goes across"
each hops -> relays { }    // covers nothing         — "iterate, and map… nothing"
```

And adding the first child arrow to a whole-structure arrow **reduces** its
coverage, from the subtree to that one field. That is the correct reading of
what you wrote — but it surprises people, so it is worth knowing before you see
a percentage drop after adding a line.

### Natural-language `@refs` count — for leaves

A resolved `@ref` inside a transform is structural, not prose interpretation, so
it counts toward coverage as a distinct **NL tier**
([ADR-036](../../adrs/adr-036-nl-ref-coverage-tier.md)). Nested paths resolve
just as leaf paths do:

```satsuma
-> geohash { "Encode @station.lat and @station.lon to a 9-character geohash" }
```

```
  source  tablet_ping      3/4   75%  (1 declared, 2 nl)
    uncovered in tablet_ping (source): 1 field
      station.code
```

But an `@ref` to a _record_ confers nothing on its leaves — whole-structure
expansion applies to declared arrows only:

```satsuma
-> geohash { "Encode @station to a 9-character geohash" }
```

```
  source  tablet_ping      1/4   25%
    uncovered in tablet_ping (source): 3 fields
      station.code, station.lat, station.lon
```

If prose consumes a whole record, name the leaves you actually use, or state the
correspondence with an arrow.

### Worked example: one hierarchy, two mappings

Put the document mapping (section 3) and the flattening mapping (section 4) in
one workspace and the two sections of the report say different things — by
design:

```
$ satsuma coverage puffin-point.stm

mapping sighting rows
  source  colony_survey             5/12   41%
  target  sighting_rows_parquet      4/4  100%
    uncovered in colony_survey (source): 7 fields
      surveyed_at, observer.ranger_id, observer.email, weather_tags,
      transects.length_m, transects.sightings.rings.ring_id,
      transects.sightings.rings.condition

Aggregate — a field is uncovered here only when NO mapping in scope covers it
  source  colony_survey             9/12   75%
  target  colony_report_json         8/8  100%
  target  sighting_rows_parquet      4/4  100%
    covered by no mapping — colony_survey (source): 3 fields
      observer.email, weather_tags, transects.length_m

  workspace  source    9/12   75%   target   12/12  100%
```

Five of the seven fields the flattening mapping "misses" are read by the
document mapping — `rings.ring_id` among them. Only three fields are genuinely
untouched by anything, and those three are the review queue. Deleting a field on
the strength of the per-mapping section alone is how live data gets dropped.

### Gating nested specs in CI

```bash
satsuma coverage pipeline.stm --fail-under 90              # gates TARGET coverage
satsuma coverage pipeline.stm --fail-under 80 --role source
```

`--fail-under` gates the **target** role unless `--role` says otherwise, and
exits **3** when the threshold is missed (distinct from 1 for a bad
`--mapping`/`--schema` name, so CI can tell an incomplete spec from a broken
invocation).

**`--fail-under 100` means every leaf.** Percentages reserve 100% and 0% for the
exact endpoints and floor everything between, so a single unmapped leaf in a
201-leaf schema reports 99% and fails the gate rather than rounding up to a pass.
This matters most on nested schemas, because they are where leaf counts get large
enough for one field to disappear into a rounding.

For nested work specifically:

- Gate the target role first. An unfilled target leaf is a bug; an unconsumed
  source leaf is often a deliberate decision.
- Read the **aggregate** section, not the per-mapping one, before calling a
  field unmapped — a second mapping may populate it. In a nested workspace this
  is common: one mapping builds the document, another flattens it.
- Investigate a _drop_ after a purely additive change. Adding the first child
  arrow under a whole-structure arrow narrows its claim, as above.

---

## 8. Checklist

Before you commit a nested mapping:

- [ ] Every braced body has `record` or `list_of record` in front of it.
- [ ] Lists of primitives use `list_of TYPE` with no braces.
- [ ] `each` where the target keeps the hierarchy; `flatten` where the target is
      rows.
- [ ] No path inside a block reaches for an ancestor — those arrows live outside
      the block.
- [ ] Parallel lists carry a `note` stating the correlation rule and what
      happens when lengths differ.
- [ ] Format addresses (`xpath`, `jsonpath`) are in metadata; Satsuma paths carry
      no indices.
- [ ] `satsuma lint` is clean — `unenumerated-record-target` means a record whose
      contents nobody has stated.
- [ ] `satsuma coverage --uncovered` shows only gaps you can defend.

## 9. Known sharp edges

Honest limits of the current language and tooling, so you can recognise them
rather than debug them. Where a limit is tracked, the ticket is named.

| Limitation                                                                                            | Workaround                                                              | Tracked   |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------- |
| No way to reference an ancestor field from inside an `each`/`flatten` block                           | Put the arrow outside the block, or describe it in a `note`             | `sl-8vqk` |
| No way to bind the current element of a _scalar_ list (`each tags -> t { . -> .x }` is a parse error) | Map the list onto the target leaf directly (section 5)                  | `sl-kezo` |
| No `zip` construct for positionally-correlated lists                                                  | Sibling `each` blocks, or per-leaf arrows, plus a `note`                | `sl-kezo` |
| A multi-source arrow onto a record cannot enumerate children (its body is a pipeline)                 | Write one arrow per target leaf                                         | `sl-3fou` |
| A scalar-to-record arrow reports the record's leaves as gaps                                          | Enumerate the leaves; `lint` flags this as `unenumerated-record-target` | by design |
| An `@ref` to a record in prose confers no coverage on its leaves, and nothing warns                   | Reference the leaves, or add declared arrows                            | `sl-lnbt` |

---

## See also

- [Language specification §3.3, §4.4, §4.6](../developer/SATSUMA-V2-SPEC.md) — the
  normative rules for `record`, `list_of`, `each`, and `flatten`
- [`satsuma coverage` reference](../../SATSUMA-CLI.md#coverage) — flags, JSON
  contract, exit codes
- [JSON path conventions](../conventions-for-schema-formats/json/conventions.md)
  and the [schema format guides](../conventions-for-schema-formats/README.md)
- [`examples/nested-iteration/`](../../examples/nested-iteration/) and
  [`examples/edi-to-json/`](../../examples/edi-to-json/) — nested iteration and
  positional correlation in the canonical corpus
- ADRs [034](../../adrs/adr-034-leaf-only-coverage-counting.md),
  [036](../../adrs/adr-036-nl-ref-coverage-tier.md),
  [037](../../adrs/adr-037-container-coverage-and-whole-structure-arrows.md),
  [038](../../adrs/adr-038-whole-structure-expansion-requires-a-container-source.md)
  — why coverage counts nested data the way it does
