# T4 answer key — Impact analysis

> **Authored before any episode runs.** PRD line 820: "Write the T4 and T5
> answer keys AT AUTHORING TIME, before any episode runs." This file is that
> key. Grading is deterministic — set-F1 against the true downstream set — so
> no judge is involved.

## The task given to the agent

> If the type of `claim_header.loss_amount` changes from `DECIMAL(14,2)` to a
> `STRING`, which downstream target fields are affected and would need to be
> reviewed?

## The true downstream set

Computed by hand from the lineage in `meridian-claims.stm`:

1. `claim_header.loss_amount` → `claim_fact.loss_usd` (mapping `claim_normalisation`, via the "Convert to USD … then round" arrow)
2. `claim_header.loss_amount` → `claim_fact.loss_source` (mapping `claim_normalisation`, via `coalesce 0`)
3. `claim_fact.loss_usd` → `claim_status_snapshot.total_exposure` (mapping `status_snapshot`, via "Sum exposure across all open claims")
4. `claim_fact.loss_usd` → `payment_fact.paid_amount` (mapping `payment_extract`, via `round 2`)

So the true downstream target-field set is:

```
{ claim_fact.loss_usd, claim_fact.loss_source,
  claim_status_snapshot.total_exposure, payment_fact.paid_amount }
```

## Grading

**Set-F1**, treating the agent's predicted set and this true set:

- Precision = |predicted ∩ true| / |predicted|
- Recall = |predicted ∩ true| / |true| = |predicted ∩ true| / 4
- F1 = harmonic mean

### Why this field

`loss_amount` is chosen because it exercises a **transitive hop** through an
intermediate target (`claim_fact`), not just a direct arrow — and through two
different downstream mappings (`status_snapshot` and `payment_extract`), so
the chain branches. The interesting failure mode is stopping at the first hop
— predicting only {`claim_fact.loss_usd`, `claim_fact.loss_source`} and
missing both transitive dependencies (`total_exposure` and `paid_amount`).
That gives recall 0.5 and looks complete to a casual reader, which is exactly
the kind of error an oracle (`satsuma field-lineage` / `satsuma where-used`)
should catch and a free-form reader (markdown, a spreadsheet) is likelier to
miss, because the downstream mappings live on different tabs/sections.

### Expected arm separation

Arm S+ should reach for `satsuma field-lineage claim_header.loss_amount <file>`
or `satsuma where-used`, which returns the transitive set deterministically.
Arm X (Excel) and arm M (markdown) must reconstruct the chain by reading the
whole spec — `loss_amount` appears in two mappings, and the second hop
(`loss_usd` → `total_exposure`) requires noticing that `claim_fact` is a
*source* of `status_snapshot`, not just a target. A reader who treats each
mapping tab as self-contained misses the cross-mapping hop.
