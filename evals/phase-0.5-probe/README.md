# Feature 44 — Phase 0.5 probe

> **Status: artifacts authored (sl-jdho), episodes not yet run (sl-x9m1).**
> This directory holds the hand-authored scenario and its answer keys —
> everything needed to run the probe, nothing produced by running it.

The cheap, hand-graded probe that decides whether building Phases 1–3
(`MappingIntent`, three renderers, totality test, blind pairing audit,
deterministic graders) is worth it. See
[`features/44-token-and-task-eval/PRD.md`](../../features/44-token-and-task-eval/PRD.md)
§"Phase 0.5 — the probe that decides whether to build the machinery".

Budget ~$8. Results are explicitly **non-publishable** — not evidence, not
pre-registered, never quoted on the site or in `RESULTS.md`. That limitation is
why it is cheap, and why it must not be allowed to grow.

## What is in here

### `scenario/` — the five arms + the 1-mapping crossover cell

The arms are paired to *each other* by construction (they render from one
hand-authored intent), which is the best control available for ~$8. They are
**not** paired to the Phase 1 registered standard — the probe has no totality
test, and its markdown arm in particular is at risk of the summary drift the
PRD documents.

- `mapping-intent.json` — the one source of truth. A minimal hand-authored
  intent record (not the Phase 1 `MappingIntent` schema) carrying every schema,
  mapping, arrow and the four planted ambiguities. Every arm below was derived
  from this.
- `meridian-claims.stm` — arm S/S+. The Satsuma source. **Note: this arm is two files** — the spec imports `fx_rates` from `lookups/claims_fx.stm`, so `sl-x9m1`'s token accounting for arms S/S+ includes both.
- `meridian-claims.md` — arm M0. A tidy field-level markdown table.
- `meridian-claims-P0.xlsx` — arm X-P0. Tidy, adversarially favourable to Excel.
- `meridian-claims-P2.xlsx` — arm X-P2. P0 plus the messiness primitives:
  a free-text Notes column, merged headers, **semantics in cell fill colour
  with no legend**, a multi-row title block, and a stale "Archived" tab. P2 is
  where fill colour (invisible to `pandas.read_excel`) carries meaning a human
  sees and an agent misses.
- `meridian-claims-1-mapping.stm` — the crossover cell. One mapping, one
  minimal claim. The 6813-token agent reference plus per-call CLI round-trips
  are unamortised, so S+ should lose here. Confirming that is the single most
  credible thing the write-up can contain (PRD §Phase 0.5, “Include a cell designed to lose”).
- `generate_probe_spreadsheets.py` — regenerates both `.xlsx` files. Reuses the
  styling primitives from
  `archive/features/04-excel-to-stm-skill/test-data/generate_test_spreadsheets.py`.

### `answer-keys/` — authored before any episode runs

- `T4-impact-analysis.md` — the true downstream set for `claim_header.loss_amount`,
  graded by set-F1. Chosen to exercise a transitive hop through an intermediate
  target, so the interesting failure is stopping at the first hop.
- `T5-ambiguity-detection.md` — the four planted ambiguities (K=4) and the
  seventeen unambiguous fields (FPR denominator). Each ambiguity is a genuine
  underspecification, not a typo.

## The four planted ambiguities

| ID | Location | Kind |
|---|---|---|
| A1 | `claim_normalisation.loss_usd` | underspecified rounding |
| A2 | `claim_normalisation.is_open` | target with no stated source |
| A3 | `vehicle_extract.damage_class` | value map missing a case (`scratch`) |
| A4 | `party_extract.phone_e164` | implicit timezone / country |

## Contamination control

Meridian Mutual, the claims domain, and every entity name are invented for this
probe and absent from `examples/` and from the training data of any model run.
The canary probe (PRD §Training-data contamination) asks each model to reproduce
the scenario without being shown it; any model that can is disqualified.

## What is NOT in here

- **Episode transcripts and usage.** Those are `sl-x9m1`, which runs the five
  arms plus the 1-mapping cell at n=2, one model, one harness.
- **The go/no-go decision.** That is `sl-3yzd`, which grades the episodes by
  hand against these answer keys and evaluates against the PRD's pre-committed
  kill thresholds (pinned to arm X, the anchor).
- **Anything publishable.** Probe numbers must never appear on the site or in
  `RESULTS.md`.

## Regenerating the workbooks

```bash
cd evals/phase-0.5-probe/scenario
python3 generate_probe_spreadsheets.py
```

The `.stm` and `.md` arms are hand-authored and are not regenerated; only the
`.xlsx` arms are machine-generated, because `openpyxl` is the only way to
produce a real workbook carrying the P2 fill-colour semantics.
