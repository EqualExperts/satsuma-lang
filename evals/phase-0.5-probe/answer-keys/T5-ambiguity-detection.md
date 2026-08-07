# T5 answer key — Ambiguity detection

> **Authored before any episode runs.** Grading is deterministic — recall/
> precision over planted ambiguity sites, plus a false-positive rate over
> unambiguous fields — so no judge is involved.

## The task given to the agent

> List every field in this spec where the transformation is ambiguous or
> underspecified, and flag it rather than guess. For each, say what is
> underspecified.

## Grading unit: sites, not ambiguity IDs

The spec has **31 leaf arrow targets** (verified via `satsuma graph --json`).
**6** are planted ambiguity sites; **25** are unambiguous. Every metric below is
graded over that same unit — an arrow target the agent did or did not flag — so
numerators and denominators are always counts of the same kind of thing.

- **Recall** = |flagged ∩ 6 planted sites| / 6
- **Precision** = |flagged ∩ 6 planted sites| / |all flagged sites|
- **False-positive rate** = |flagged ∩ 25 unambiguous sites| / 25

An arm that flags everything scores recall 1.0, **precision 6/31**, FPR 1.0.
Precision and FPR are jointly what make that not a winning strategy: precision
punishes the volume of the over-flagging, FPR punishes its reach across the
unambiguous set.

**Why sites and not ambiguity IDs.** A1 is one underspecification with three
sites (`loss_usd`, `total_exposure`, `paid_amount`). Grading over IDs would
need a rule for what to do with an agent that flags one site but not the other
two, and any such rule makes recall and precision count different things —
which is how the metric stops being computable. Grading over sites needs no
such rule. The cost is that partial credit is genuinely partial: an agent that
spots the rounding gap on `loss_usd` alone scores 1/6 recall, not 1/4. That is
the intended reading — the other two sites are separate places an implementer
must still guess, so missing them is a real miss.

**When reporting, state per-ambiguity coverage alongside the three metrics** —
which of A1–A4 were hit at all, and at how many of their sites. Site-level
recall alone cannot distinguish "found three of the four ambiguities" from
"found A1 everywhere and nothing else", and that distinction is what the
per-arm predictions below are about.

## The planted ambiguities (4 ambiguities, 6 sites)

Each is a genuine underspecification, not a typo (PRD acceptance: underspecified
rounding, target with no stated source, value map missing a case, implicit
timezone/country).

| ID | Sites | Kind | What an agent should flag |
|---|---|---|---|
| **A1** | `claim_normalisation.loss_usd`, `status_snapshot.total_exposure`, `payment_extract.paid_amount` | underspecified rounding | Every `round 2` step says nothing about the rounding mode (half-up vs bankers). An SQL implementation of any of the three must guess. |
| **A2** | `claim_normalisation.is_open` | target with no stated source | `is_open` is a computed arrow with no `from`. Its rule references `@claim_header.status`, but the binding is inferred, not declared. An agent should flag that the source is implied by prose, not wired structurally. |
| **A3** | `vehicle_extract.damage_class` | value map missing a case | The damage_class map covers none/minor/moderate/severe/total, but the source enum on `vehicles.damage_extent` also allows `scratch` (see the schema declaration). A value arriving as `scratch` is unhandled. |
| **A4** | `party_extract.phone_e164` | implicit timezone / country | The phone formatting rule assumes US country code if no `+` prefix. The country is left implicit in the data; an agent should flag the assumption rather than silently apply it. |

## The unambiguous fields (false-positive denominator = 25)

These carry a fully-determined transform. An agent that flags any of these is
over-flagging, and the false-positive rate is what stops "flag everything"
from being a winning strategy. Every leaf arrow target across all six
mappings is classified here or in the planted set above — the denominator is
exhaustive (31 leaf targets = 6 planted + 25 unambiguous).

```
claim_normalisation.claim_key
claim_normalisation.policy_ref
claim_normalisation.claim_type_code
claim_normalisation.reported_date
claim_normalisation.loss_source
claim_normalisation.vehicle_count
claim_normalisation.party_count
claim_normalisation.max_damage
claim_normalisation.photos.photo_ref
claim_normalisation.photos.view
claim_normalisation.adjuster_ref
party_extract.claim_key
party_extract.role
party_extract.display_name
vehicle_extract.claim_key
vehicle_extract.vin
vehicle_extract.description
vehicle_extract.estimate_usd
status_snapshot.claim_key
status_snapshot.open_flag
payment_extract.claim_key
payment_extract.paid_at
fraud_assessment.claim_key
fraud_assessment.risk_score
fraud_assessment.is_flagged
```

Note: `fraud_assessment.is_flagged` is structurally similar to A2 (a boolean
derived from a source field via a quoted rule) but is *not* planted —
`party_count > 7` is a fully-determined threshold, so flagging it is a false
positive. An arm that treats "any quoted-rule arrow" as ambiguous will rack up
FPR here. `fraud_assessment.risk_score` (`multiply 10`) is also deterministic
and unambiguous.

## Why these four, and the per-arm visibility

- **A1 (rounding)** is equally visible in `.stm`, markdown and Excel — the
  text `round 2` carries no rounding mode in any of them. This is the
  baseline case: if arms differ here, the difference is attention, not
  representation.
- **A2 (no source)** is most visible in `.stm`, where a computed arrow is a
  syntactically distinct shape (`-> is_open { "…" }` with no LHS source
  path). In the markdown table it is a row with an empty source cell. In
  Excel it is a row whose Source Field column says "(computed — no source)".
  The `.stm` grammar makes it structural; the others make it textual.
- **A3 (missing case)** requires cross-referencing the schema declaration
  against the value map. In `.stm` both live in the same file. In markdown
  they live in the same document. In Excel they live on *different tabs*
  (the schema tab vs the mapping tab), so this is where the spreadsheet arm
  should lose recall.
- **A4 (implicit country)** is a prose rule that states an assumption. It is
  equally visible in all arms as text, but the `.stm` arm carries it as a
  natural-language transform body — the deterministic/NL split the site
  claim is built on. An agent that treats it as deterministic (and silently
  applies US formatting) is exactly the failure the claim predicts.
