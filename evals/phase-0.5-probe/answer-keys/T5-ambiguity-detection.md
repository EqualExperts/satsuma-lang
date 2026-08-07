# T5 answer key — Ambiguity detection

> **Authored before any episode runs.** PRD line 820. Grading is deterministic
> — recall/precision over planted ambiguities, plus a false-positive rate over
> unambiguous fields — so no judge is involved.

## The task given to the agent

> List every field in this spec where the transformation is ambiguous or
> underspecified, and flag it rather than guess. For each, say what is
> underspecified.

## The planted ambiguities (K = 4)

Each is a genuine underspecification, not a typo (PRD acceptance: underspecified
rounding, target with no stated source, value map missing a case, implicit
timezone/country).

| ID | Location | Kind | What an agent should flag |
|---|---|---|---|
| **A1** | `claim_normalisation.loss_usd` | underspecified rounding | The transform says `round 2` but does not state the rounding mode (half-up vs bankers). An SQL implementation must guess. |
| **A2** | `claim_normalisation.is_open` | target with no stated source | `is_open` is a computed arrow with no `from`. Its rule references `@claim_header.status`, but the binding is inferred, not declared. An agent should flag that the source is implied by prose, not wired structurally. |
| **A3** | `vehicle_extract.damage_class` | value map missing a case | The damage_class map covers none/minor/moderate/severe/total, but the source enum on `vehicles.damage_extent` also allows `scratch` (see the schema declaration). A value arriving as `scratch` is unhandled. |
| **A4** | `party_extract.phone_e164` | implicit timezone / country | The phone formatting rule assumes US country code if no `+` prefix. The country is left implicit in the data; an agent should flag the assumption rather than silently apply it. |

## The unambiguous fields (false-positive denominator = 17)

These carry a fully-determined transform. An agent that flags any of these is
over-flagging, and the false-positive rate is what stops "flag everything"
from being a winning strategy.

```
claim_normalisation.claim_key
claim_normalisation.policy_ref
claim_normalisation.claim_type_code
claim_normalisation.reported_date
claim_normalisation.loss_source
claim_normalisation.vehicle_count
claim_normalisation.party_count
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
```

## Grading

- **Recall** = |flagged ∩ {A1,A2,A3,A4}| / 4
- **Precision** = |flagged ∩ {A1,A2,A3,A4}| / |all flagged|
- **False-positive rate** = |flagged unambiguous| / 17

An arm that flags everything scores recall 1.0, precision 4/21, FPR 17/17.
The FPR is the metric that makes that not-a-win, and it is the one a
"flag-everything" agent would rack up fastest on the spreadsheet arm (whose
free-text Notes column invites suspicion) and slowest on the `.stm` arm
(whose grammar-fixed shape makes the four planted gaps structurally visible).

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
