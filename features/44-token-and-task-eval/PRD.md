# Feature 44 — Token and Task-Completion Eval: Satsuma vs. Spreadsheets

> **Status: PROPOSED** (raised 2026-08-04) — requested by the project owner to
> put a reproducible measurement behind the site's quantitative claims about
> agent token usage, and to find out whether a coding agent given a `.stm` spec
> actually produces *better* work than one given the equivalent spreadsheet.
>
> **State this PRD was checked against:** `main` at `0579a037`.
>
> **Direct antecedent.** `features/43-site-audit-fixes/PRD.md` (Non-goals)
> records "3-8x less token usage", "40-60% smaller", and
> ">90% LLM-generates-valid-Satsuma" as unsubstantiated marketing numbers, and
> explicitly left them for the project owner to triage into a future feature.
> This is that feature. The `>90%` figure is worth singling out: it is lifted
> from `docs/product-owner/PROJECT-OVERVIEW.md:237`, where it is a *future
> target* in a success-metrics list, and it is repeated on the site as though it
> were a measured result.
>
> **What this feature delivers.** A pre-registered experimental protocol, the
> paired-artifact generation design that makes the comparison valid, the graders,
> the model/harness matrix, a costed run plan under a hard budget cap, and a
> single-cell pilot proving the metrics are collectable. **It does not produce
> the published numbers** — executing the full run and updating site copy is a
> follow-on feature gated on this protocol being signed off.
>
> **What this feature is not.** It changes no Satsuma syntax, no grammar, and no
> CLI/LSP/VS Code/viz behaviour. It adds no package to the Turborepo task graph
> and must not lengthen CI.

## Goal

Replace three unfalsifiable marketing numbers with three separately-measured,
confidence-bounded, independently reproducible ones:

1. **Static compactness** — how many fewer tokens a `.stm` spec is than the
   same mapping expressed as a spreadsheet, and than the same mapping expressed
   as YAML. Deterministic; no model involved.
2. **Task cost** — how many tokens an agent *consumes* to complete a real
   mapping task from each representation. Behavioural; dominated by agent
   loops, not file size.
3. **Task quality** — whether the work the agent produces is correct, and
   specifically whether it *surfaces* ambiguity rather than silently guessing.

A secondary goal, equally important to the credibility of the first three: make
the measurement rerunnable by a sceptic. Committed raw data, a pinned config, a
protocol hash fixed before the first non-pilot run.

## Why the current claims can't be defended

Three separate problems, each fatal on its own.

**The claims conflate three different quantities.** "3-8x less token usage than
mapping spreadsheets" (`site/index.njk:259`, restated at `:524`) does not say
whether it means the artifact's token count or the agent's consumption. Those
differ by more than the claimed effect size: the artifact is a one-time cost
paid once per context, whereas an agent handed an `.xlsx` must first write
throwaway `openpyxl`/`pandas` code to read it at all, and every repair loop
re-pays for the sheet dump. Nobody can check a claim whose subject is
undefined.

**"The spreadsheet's token count" is not a well-defined number.** An `.xlsx` is
a zip archive; it cannot be tokenized. Every path to a token count is a
*choice*, and the choices span more than an order of magnitude:

| Serialization | Effect on the claimed ratio |
|---|---|
| Raw `xl/sharedStrings.xml` + `sheet1.xml` | Inflates it enormously — XML ceremony no agent ever sees |
| `pandas.DataFrame.to_string()` per sheet | Inflates it — column padding to fixed width |
| CSV per sheet | Roughly neutral; close to what a naive agent produces |
| Tight markdown table, blank rows dropped | Deflates it — a competent agent's own summarization |

Picking the first and reporting the result would not be a measurement, it would
be a rhetorical device. The protocol must pre-commit to a primary serialization
and report the full range across all four, so the reader can see the bound.

**The comparison has no controlled pairing.** For the two arms to differ *only*
in representation, they must encode the same mapping. There is currently no
artifact in the repo of which that is true — see the next section, which is the
core design problem this feature solves.

## The central design problem: how the two arms get paired

Both obvious approaches are contaminated, in opposite directions.

- **Render the spreadsheet from the `.stm`** (via `skills/satsuma-to-excel/`).
  The workbook inherits Satsuma's structural discipline — one concern per
  column, consistent naming, no colour-as-semantics — so it is not the artifact
  the pitch is about. Worse, it is *causally downstream*: every real-world
  ambiguity was already resolved by whoever wrote the `.stm`, so the Excel arm
  gets a cleaned-up problem and the ambiguity-detection measurement becomes
  meaningless.
- **Render the `.stm` from real messy spreadsheets** (via
  `skills/excel-to-satsuma/`). Now the Satsuma arm is the derived one, and the
  conversion may silently drop information the spreadsheet had or invent
  information it didn't. Any measured advantage could be an artifact of the
  conversion step.

### The design: one intent record, two total renderers

Author the ground truth **once, in neither format**, as a machine-readable
`MappingIntent` record; render both arms from it mechanically.

```
                    MappingIntent  (JSON — the only source of truth)
                  ┌────────┴────────┐
        render_stm│                 │render_xlsx (messiness profile 0|1|2)
                  ▼                 ▼
              Arm S / S+        Arm X            Arm Y (render_yaml, static only)
                  └────────┬────────┘
                           ▼
                  same ground-truth key grades both
```

The repo already contains most of this. `tooling/satsuma-scenario-gen/` is
exactly the pattern: a scenario is plain data, it renders to Satsuma source, and
it *states the ground truth that follows by construction*. It never parses or
interprets Satsuma, and its one architectural rule is no dependency on
`@satsuma/core`. So:

- `satsuma-scenario-gen` gains a neutral **`MappingIntent` JSON serializer**
  alongside its existing Satsuma renderer. It stays pure string/JSON building
  and takes on no new dependency — in particular no xlsx writer.
- The **xlsx, CSV and YAML renderers live in `evals/`** (Python, `openpyxl`),
  reusing the workbook-construction approach already proven in
  `skills/satsuma-to-excel/scripts/stm_to_excel.py`. This is the same
  core-vs-consumer split `AGENTS.md` mandates: semantics in the shared
  generator, format-specific I/O in the consumer.

**Totality is the control, and it must be enforced, not assumed.** Every field
of `MappingIntent` must be rendered by *both* renderers, or one arm is quietly
handed less information than the other. Two mechanisms:

1. **Renderer totality test** — a schema-driven test asserting every
   `MappingIntent` field is reachable in each renderer's output. A new intent
   field with no rendering in one arm fails the suite.
2. **Blind pairing audit** — an LLM reads *only* arm X, and separately *only*
   arm S, and reconstructs the intent record from each. The two
   reconstructions must agree with each other, and with the true record, on
   every gradeable element except the deliberately planted ambiguities. A
   disagreement means the arms are not paired and the run is invalid. This is a
   go/no-go gate before any billed run, not a post-hoc diagnostic.

### Messiness profiles: report the honest lower bound

Real mapping spreadsheets are messy, and that mess is the substance of the
pitch. But "we made the spreadsheet bad and Satsuma won" is not a finding. So
messiness is an explicit, reported knob:

| Profile | What the workbook looks like | Role |
|---|---|---|
| **P0 — clean** | One tidy table per mapping, one concern per column, consistent naming, no merged cells, plain header row | **Adversarially favourable to Excel.** The headline claim is bounded by this number |
| **P1 — typical** | Tab per source system, free-text Notes column mixing rules and commentary, merged cells in headers, inconsistent field naming, a legend tab | The realistic middle; the number most representative of practice |
| **P2 — field-observed** | P1 plus semantics encoded in cell fill colour with no legend, multi-row headers, cell comments carrying transformation rules, one wholly stale tab | The pathological-but-real end |

P2 is where a genuine and underappreciated finding lives: **fill colour is
invisible to `pandas.read_excel`**, so an agent taking the obvious path loses
information a human reader would see. That is worth measuring deliberately and
labelling clearly — it is a fact about spreadsheets as an agent interface, not a
trick.

Results are reported **per profile**. The headline goes to P0.

## Arms

Behavioural arms (cost 💰 = billed episodes; static-only arms are free):

| Arm | Artifact | Agent tooling | 💰 | What it isolates |
|---|---|---|---|---|
| **X** | `.xlsx` at profile P0/P1/P2 | Python + `openpyxl`/`pandas`, file described as a mapping spec, free exploration | yes | The baseline the claim is made against |
| **S** | `.stm` only | No `satsuma` CLI. `AI-AGENT-REFERENCE.md` in context | yes (reduced) | **The language alone** |
| **S+** | `.stm` | `satsuma` CLI on PATH + `AI-AGENT-REFERENCE.md` | yes | **Language + tooling** — the configuration actually shipped |
| **Y** | YAML | — | no | The `40-60% smaller than YAML` claim (static only) |
| **C** | CSV-per-sheet dump of X | — | no | Serialization sensitivity for the static claim |

**S vs. S+ is the contrast that stops the result being uninterpretable.** The
site makes two distinct claims — the format is compact (`index.njk:259`) and the
CLI gives agents structural queries instead of whole-file dumps
(`cli.njk:156`). Run only S+ and you cannot attribute the effect to either. A
sceptical technical evaluator will ask, and "we didn't separate them" is not an
answer.

### Satsuma pays for its own reference material

`AI-AGENT-REFERENCE.md` is ~7k tokens of fixed overhead (27.5 KB, 4,026 words —
to be measured exactly, not estimated) that the Satsuma arms need in order to
work as intended. **Those tokens count against the Satsuma arm's budget.**
Omitting them would be indefensible.

The consequence is worth stating up front because it likely reshapes the
headline: on a small spec, Satsuma may well *lose* on total tokens, and only win
past some workspace size. If so, the deliverable is a **break-even curve**
(tokens vs. number of mappings, both arms plotted, crossover marked) rather than
a single multiple. That is a strictly better asset than "3-8x": it is
defensible, it tells an evaluator where the technique pays off for *their*
workspace, and it cannot be dismissed as cherry-picking. The run must therefore
sweep spec size — 1, 3, 10 and 25 mappings — not just measure one size.

### But the overhead is a *variable*, not a constant — so it is a factor

The fixed cost above assumes the whole reference is resident in context, which is
how it is used today. It need not be. Measured section sizes of
`AI-AGENT-REFERENCE.md`:

| Section | Bytes | ≈ tokens | Needed for |
|---|---|---|---|
| `## Satsuma CLI — Agent Tooling` | 11,418 | ~2.9k | **Reading/analysis only** |
| `## Portable Grammar & Conventions` (+ subsections) | ~8,900 | ~2.2k | **Writing only** |
| Common mistakes + worked examples | 3,494 | ~0.9k | Writing |
| `## Agent Workflow` | 2,988 | ~0.7k | Both |

The CLI reference is **41% of the file**, and a task that only *reads* Satsuma
needs none of the grammar — every CLI command has `--json`, so the agent
consumes structured facts and never sees Satsuma syntax at all. Conversely a
codegen task needs the grammar and not the command reference. Today every task
pays for both, so the flat ~7k figure charged above is a **worst case that
understates Satsuma**.

Candidate delivery mechanisms, ranked by expected resident cost:

| Mechanism | Resident cost | Notes |
|---|---|---|
| **Progressive disclosure via a skill** | ~50-100 tokens of frontmatter | The `skills/` (agentskills.io) pattern already in this repo; body loads on trigger. Pi's "lazy skills" is built around exactly this |
| **Task-sliced reference** | ~300-token router + one slice on demand | No new machinery: `satsuma agent-reference --section grammar\|cli\|conventions` |
| **Full file in context** (status quo) | ~7k | Simple, robust, and the agent cannot fail to have it |
| **MCP server wrapping the CLI** | ~5-9k, *whether used or not* | Likely the **worst** on this axis: 23 commands × a few hundred tokens of eagerly-injected tool schema. MCP buys discoverability and typed arguments, not token efficiency — unless the client supports deferred schema loading |
| **Prompt caching** | orthogonal | The reference is a static prefix, so cache reads make it ~90% cheaper in *dollars* while costing full *tokens*. Already handled by splitting cache-read from input in the metrics |

**The counter-risk is real and is what makes this worth measuring rather than
just assuming.** Progressive disclosure can cost *more*: an agent that never
loads the grammar, guesses at syntax, and then burns a repair loop pays more
than one handed 7k tokens up front. Lazy loading trades a certain small cost for
an uncertain large one.

Two measurements, chosen to be nearly free:

1. **Static baseline cost per mechanism** (no model spend at all) — count what
   actually lands in context for each mechanism at each task type. This alone
   answers "is there a more token-efficient way", and it is the number that
   picks the mechanism for the behavioural arms.
2. **One cheap behavioural check** — best static mechanism vs. status quo, one
   model, T1 (writing, needs grammar) + T4 (reading, needs CLI), n=3. It is
   looking for exactly one thing: does the agent reliably *load* what it needs,
   and if it doesn't, does the repair loop cost more than the tokens saved?

Restructuring the reference into progressive disclosure is a **product
improvement that stands on its own merits**, independent of this eval, and
should be raised as its own ticket rather than smuggled in as eval scaffolding.
This feature's job is only to produce the number that says whether it is worth
doing.

## Tasks and how each is graded

Five tasks. Three are graded **deterministically against the intent record**,
which is the single biggest lever on this eval's credibility: LLM-as-judge is
the weakest link in any eval, and most of these don't need one.

| # | Task | Primary grading | Judge? |
|---|---|---|---|
| **T1** | Generate a pipeline implementation (dbt model + SQL) for one mapping | Deterministic: does it parse; is every target field populated; does the derived field-level coverage match the intent record's | Yes — idiomaticity only |
| **T2** | Enumerate data-quality test cases for the spec | Recall against the ground-truth constraint checklist (required, enum, pk uniqueness, referential integrity, filter boundaries) derived from the intent record | Light — "does this test actually test that constraint" |
| **T3** | Generate synthetic test data | **Fully deterministic.** Programmatically validate rows against every intent constraint: types, enums, required, PII patterns, formats, defaults, filter predicates, cross-schema referential integrity | No |
| **T4** | Impact analysis — "if `<field>` changes type, what breaks?" | **Fully deterministic.** Set-F1 against the true downstream set from the intent record's lineage | No |
| **T5** | Ambiguity detection | **Fully deterministic.** Recall/precision over *K* ambiguities planted in the intent record by construction; false-positive rate over unambiguous fields | No |

**T5 is the task nobody else runs, and it measures the claim the site actually
leans on** — `index.njk:635`, that Satsuma "separates deterministic structure
from intentionally scoped natural language" so an agent "can generate correct
code for the deterministic parts and leave clearly marked TODOs". The intent
record plants a known number of genuine ambiguities (an underspecified rounding
rule, a target field with no stated source, a value map missing a case, a
timezone left implicit). Score = flagged vs. silently guessed. An agent that
confidently invents a rule scores worse than one that asks. Precision matters
too: an arm that flags everything is not better, so the false-positive rate over
the unambiguous fields is reported alongside.

T4 and T5 are also the **cheapest episodes** — short, no code generation — which
is how five tasks fit inside the budget of four.

### Judge protocol, where a judge is unavoidable

- Three judges per artifact, from **three different model families**.
- No model judges output from its own family (self-preference is well
  documented and would bias exactly the comparison being made).
- **Judges are blind to the arm**: outputs are stripped of any trace of whether
  they came from Excel or Satsuma before judging. Any leak invalidates the cell.
- Rubrics are written and committed *before* the first run, with a worked
  example per score band.
- **Inter-rater agreement is reported** (Krippendorff's α). Below a
  pre-committed threshold, the judged metric is reported as inconclusive rather
  than quietly used.

## Metrics and statistics

This is where most vendor benchmarks fail, so the protocol is specific.

**Token accounting.** Provider-reported usage is primary, our own counting is a
fallback. Record **input, output, cache-write and cache-read separately** —
prompt caching changes the dollar answer by several-fold, so the token claim and
the cost claim are different claims and both are reported. OpenRouter returns
exact per-request usage; Claude Code, Codex CLI and Pi each report session
usage. Note that Claude Code and Codex may bill against a subscription rather
than per-token — for those, harness-reported token counts are used and the
dollar figure is imputed from list API prices, labelled as imputed.

**Static token counts** use each vendor's real tokenizer — the Anthropic
count-tokens endpoint, `tiktoken` `o200k_base` for OpenAI, the published HF
tokenizers for open-weight models — and are **reported per tokenizer, never
averaged**. Different tokenizers give materially different ratios on this kind
of input (dense punctuation and identifiers), and a single averaged number would
hide that.

**Primary statistic.** Per-instance paired ratio *r* = tokens(X) / tokens(S+),
summarized as the **geometric mean** of per-instance ratios with a BCa bootstrap
95% CI (10,000 resamples). Not the ratio of means — token ratios are
right-skewed and the ratio of means systematically overstates the effect. This
is the single most common error in published comparisons of this kind. Paired
significance by Wilcoxon signed-rank, with effect size.

**Quality metrics** are proportions per arm, with the paired difference and its
bootstrap CI; McNemar's test for the binary outcomes.

**Repeats.** n = 5 per cell, with within-cell variance reported. Temperature is
pinned at 0 where supported, but **temperature 0 is not determinism** on MoE
models, so repeats are required regardless — a protocol that runs each cell once
cannot distinguish a real effect from routing noise.

**Headline format.** Every published number is `point estimate [95% CI]` at a
named messiness profile and a named spec size — e.g. "3.4× [2.6-4.1] at P0,
10 mappings" — never a bare range like "3-8x".

**Pre-registration.** Arms, tasks, metrics, n, and the analysis are committed
and the protocol file hashed before the first non-pilot run. Deviations are
recorded as such. Raw JSONL per episode — prompts, full transcripts, usage,
grades — is committed to the repo.

## Validity threats and their controls

| Threat | Control |
|---|---|
| **Training-data contamination.** `examples/` is public on GitHub and inside the training data of every model with a post-2025 cutoff. A task built on `examples/sfdc-to-snowflake` may be partly recalled, not reasoned | All eval scenarios are authored fresh, with renamed entities and domains absent from the corpus. Plus a **canary probe**: ask each model to reproduce the scenario without being shown it, and discard any scenario it can |
| **Prompt asymmetry.** Unequal effort in the two prompts would manufacture the result | The two prompt templates are committed, and their **diff must be reviewable and minimal** — identical except the artifact reference and the minimum wording to describe the format |
| **Excel strawman.** A hostile reader's first accusation | The Excel arm gets `openpyxl` + `pandas`, is told the file is a mapping spec, may explore freely, and is run at P0 (deliberately tidy) as the headline. A separate **best-effort Excel prompt**, tuned by someone briefed to make Excel win, is run on one cell as an adversarial check |
| **Harness confound.** Claude Code, Codex CLI and Pi differ enormously in system-prompt size and default tools — Pi's sub-1k-token prompt vs. Claude Code's much larger one | Harness is a **blocking factor, never averaged over**. Pi is the anchor (smallest prompt overhead, model-agnostic across 15+ providers, so the cleanest measurement); a bounded invariance check runs on Claude Code and Codex |
| **Model drift.** Hosted model IDs move under a stable name | Pin dated snapshot IDs; record the resolved ID and provider per episode |
| **Cherry-picked size.** One spec size proves nothing about scaling | Sweep 1/3/10/25 mappings; publish the break-even curve |
| **Our own bias.** We are the language's authors | Deterministic graders wherever possible; blind judging; committed raw transcripts; pre-registered analysis |

### The prediction that makes this an experiment

If the "structure helps agents" hypothesis is right, **Satsuma's advantage
should be largest on the weakest model and shrink as models get stronger** — a
strong model can parse a messy spreadsheet unaided, so it has less to gain. The
matrix therefore includes a deliberately weak model so that curve has a chance
to fail to appear.

If the advantage is *flat* across the capability ladder, that is evidence the
measurement is picking up something other than comprehension difficulty — most
likely raw artifact size — and the interpretation must change accordingly. This
prediction is registered in advance precisely so it can embarrass us.

## Model and harness matrix

**Selection criterion, stated because it is easy to get wrong.** Models are
chosen to span a **capability ladder** — one rung per tier, as far apart as the
market allows — because the experiment's registered prediction is about how the
effect varies *with* capability. They are explicitly **not** chosen by adoption,
spend share, or leaderboard rank. Adoption leaderboards rank by accumulated
dollars, so they lag releases by roughly a model generation and would populate
the matrix with last-generation models while claiming to describe the current
one. (This PRD's first draft made exactly that mistake, sourcing its models from
an adoption-by-spend snapshot.)

Prices are list, August 2026, and **must be re-verified at run time** — this
market repriced more than once during the drafting of this document.

| Rung | Model | $/M in | $/M out | Why this rung |
|---|---|---|---|---|
| Frontier | **Claude Opus 5** | 5.00 | 25.00 | Approaches Fable 5's frontier performance at roughly half the per-token price — the cost-sensible ceiling |
| Daily driver | **Claude Sonnet 5** | 2.00 | 10.00 | The realistic default for agentic coding. **Promotional rate; rises to 3.00/15.00 after 2026-08-31** |
| Strong open-weight | **Kimi K3** | 3.00 | 15.00 | Frontier-adjacent open weights — the self-host / cost-control tier |
| Cheap and weak | **DeepSeek V4 Flash** | 0.14 | 0.28 | Two orders of magnitude below the top rung on output price; the bottom rung the registered prediction needs |

Named alternates if any is unavailable: **Claude Fable 5** ($10/$50) or
**GPT-5.6 Sol** ($5/$30) at the top — Fable 5 is the true frontier but roughly
doubles that rung's cost for a modest capability delta; **Gemini 3.1 Pro**
($2/$12) as daily driver; **DeepSeek V4** or **GLM-5.2** for open weights;
**Gemma 4 31B** or **Mistral Small 4** if a genuinely small locally-runnable
model is wanted at the bottom. Substitutions are recorded as protocol
deviations.

Two run-time constraints follow from the prices above. The Sonnet 5 promotional
rate expires **2026-08-31** — a ~50% cost swing on the highest-volume rung, so
the full run either lands before it or gets re-costed. And because hosted model
IDs move under stable marketing names, every episode records its **resolved
dated snapshot ID**, never the friendly name.

| Harness | Role |
|---|---|
| **Pi** (Ronacher/Zechner) | **Anchor.** Sub-1k-token system prompt, 15+ providers, model switchable mid-session — the least confounded measurement surface. Carries the full matrix |
| **Claude Code** | Bounded invariance check only |
| **Codex CLI** | Bounded invariance check only |

At the £/$ ceiling chosen for this feature, **one anchor harness carries the
publishable number** and the other two only answer "is this effect grossly
harness-specific?". They cannot support a cross-harness generalisation claim,
and the write-up must not imply otherwise. Widening to a full 3-harness factorial
is the first thing to buy if the budget ever increases.

## Costed run plan — $100 hard cap

Costing unit: one **codegen-equivalent episode (CEE)** ≈ 150k input-equivalent +
15k output tokens. This is an assumption to be *replaced* by pilot
measurements — the Excel arm is expected to run 1.5-2.5× the Satsuma arm, and
the CEE figure is set at the higher end so the estimate errs expensive.

Task sizes in CEE: T1 1.0, T2 0.6, T3 0.8, T4 0.25, T5 0.25 → **2.9 CEE per
arm per model per repeat**.

Cost of one CEE per rung, at the corrected August 2026 prices:

| Rung | $/CEE |
|---|---|
| Claude Opus 5 | 1.13 |
| Claude Sonnet 5 (promo) | 0.45 |
| Kimi K3 | 0.68 |
| DeepSeek V4 Flash | 0.03 |
| **Sum across the four rungs** | **2.29** |

| Slice | CEE | Est. |
|---|---|---|
| Primary: arms X vs S+, 5 tasks, 4 rungs, n=5, Pi | 29/rung | **$66** |
| Secondary: arm S (language alone), T1+T4, 2 rungs, n=3 | 7.5 | **$2** |
| Harness invariance: Claude Code + Codex, 1 rung, 2 tasks, 2 arms, n=3 | 15 | **$7** |
| Reference-delivery check: 2 mechanisms, T1+T4, 1 rung, n=3 | 7.5 | **$4** |
| Judge panel: 3 judges × 40 T1 outputs | 120 calls | **$5** |
| Pairing audit + canary probes | — | **$3** |
| Pilot (this feature's gate) | ~3 | **$5** |
| Static arms (Y, C, tokenizer counts, delivery-mechanism baselines) | — | **~$0** |
| | **Total** | **~$92** |

That is uncomfortably close to the cap, which makes the cut order below
load-bearing rather than theoretical. **Dropping T2 brings the total to ~$79**
(the primary slice falls from 29 to 23 CEE per rung) — see open decision 2,
which is now a costed choice rather than a preference.

Note that Claude Code and Codex CLI may bill against a subscription rather than
per-token, so the harness-invariance slice's marginal cash cost may be near
zero. Its **token** accounting is unaffected, and the $7 above is the imputed
list-price figure so the budget errs expensive.

Controls on the cap:
- `--dry-run` prints the full projected cost from the matrix before any billed
  call, and the runner refuses to start without an explicit `--budget` figure.
- A **running spend ledger** with a hard kill switch at the cap; a partial run
  is reported as partial, never silently truncated.
- **Documented cut order** if the cap is approached: harness-invariance check
  first, then the arm-S secondary slice, then T2, then n from 5 to 3. Anything
  cut is named in the write-up.
- A **tier-0 smoke config** (1 model, 1 harness, 2 tasks, n=1, ~$1) that any
  reader can run to reproduce the pipeline end to end without reproducing the
  spend.

## Where the code lives

- **`evals/`** — new top-level directory, Python. Deliberately **outside the npm
  workspace and the Turborepo task graph**: this must add nothing to CI time,
  and it is not a language tool. Owns the xlsx/CSV/YAML renderers, the harness
  runners, the graders, the statistics, and the committed raw results.
- **`tooling/satsuma-scenario-gen/`** — gains the neutral `MappingIntent` JSON
  serializer. No new dependency, no xlsx writer, and its existing rule (no
  dependency on `@satsuma/core`) is preserved.
- **`site/`** — untouched by this feature. Copy changes belong to the follow-on
  run feature.

Scenario sourcing is deliberately mixed: `satsuma-scenario-gen`'s generated
scenarios give breadth and free ground truth, but are synthetic and may be
unrealistic for judging code-generation quality. A small number of
**hand-authored realistic scenarios** — expressed in the same `MappingIntent`
form, so they get the same free ground truth — carry the tasks where realism
matters (T1, T2).

## Delivery phases

| Phase | Content | Feature |
|---|---|---|
| **0** | This PRD — protocol, arms, tasks, graders, matrix, costing, pre-registration | **44** |
| **1** | `MappingIntent` schema + both renderers + totality test + blind pairing audit passing | **44** |
| **2** | Deterministic graders (T3/T4/T5) + static-compactness measurement (arms Y, C — no model spend) | **44** |
| **3** | **Pilot gate:** one cell end to end (1 model, 1 harness, T1 + T4, n=3), proving usage is collectable, grading runs, and arms are paired | **44** |
| **4** | Full run, statistics, `RESULTS.md`, published methodology page, **site copy updated to the measured numbers** | follow-on |

Phase 4 is explicitly out of scope here and should be raised as its own feature
once this protocol is signed off.

## Publishing commitment

Registered in advance, as a condition of the measurement being worth anything:
**the site copy follows the data.** If the measured ratio is 1.8×, the site says
1.8×. If Satsuma loses below some spec size, the break-even point is published
alongside the win. `site/index.njk:259` and `:524` are updated to the measured,
dated, CI-bounded figure in Phase 4, and the unmeasured
">90% LLM-generates-valid-Satsuma" claim is either measured or removed — it is
currently a roadmap target being presented as a result.

The failure mode this commitment exists to prevent is running the experiment,
disliking the answer, and quietly keeping the old number.

## Non-goals

- **No new Satsuma syntax, grammar, CLI, LSP or viz behaviour.** If the eval
  reveals tooling gaps (e.g. an agent repeatedly wants a command that doesn't
  exist), those become separate tickets, not scope here.
- **No claim about human comprehension.** This measures agents. "Faster for
  humans to scan" (`PROJECT-OVERVIEW.md:67`) needs a study with human subjects
  and is out of scope.
- **No comparison against dbt, DBML, or other mapping DSLs.** Spreadsheets and
  YAML only — those are what the claims name.
- **No CI integration.** The eval never runs on PRs. Its results are committed
  artifacts, refreshed deliberately.
- **No cross-harness generalisation claim** at this budget (see the matrix
  section).

## Acceptance criteria

- [ ] `MappingIntent` schema defined, documented, and covering every element the
      graders need: schemas, fields, types, constraints, value maps, filters,
      lineage edges, and **deliberately planted ambiguities**.
- [ ] `satsuma-scenario-gen` emits `MappingIntent` JSON, with no new dependency
      and no dependency on `@satsuma/core`.
- [ ] Both renderers (`.stm`, `.xlsx`) implemented, with the xlsx renderer
      supporting messiness profiles P0/P1/P2.
- [ ] **Renderer totality test passes**: every `MappingIntent` field is
      demonstrably rendered in both arms; adding an unrendered field fails the
      suite.
- [ ] **Blind pairing audit passes**: independent reconstructions from arm X
      alone and arm S alone agree with each other and with the intent record on
      every gradeable element except the planted ambiguities.
- [ ] Deterministic graders for T3, T4 and T5 implemented and unit-tested,
      including negative tests proving each grader *fails* a deliberately wrong
      submission.
- [ ] Judge rubrics for T1 (and T2's light check) written, with a worked example
      per score band, and an agreement threshold committed.
- [ ] Static-compactness measurement produces per-tokenizer, per-serialization,
      per-spec-size numbers for arms S/X/Y/C — including the
      `AI-AGENT-REFERENCE.md` overhead charged to the Satsuma arm — with no
      model spend.
- [ ] **Reference-delivery baselines measured with no model spend**: resident
      context cost per mechanism (full file, task-sliced, skill-style
      progressive disclosure, MCP tool schemas) per task type, with the winner
      selected on evidence and recorded.
- [ ] Reference-delivery behavioural check run, reporting whether lazy loading
      changes task success — specifically whether the agent reliably loads what
      it needs, and what a failure-to-load costs in repair-loop tokens.
- [ ] Both prompt templates committed, and their diff reviewed as minimal.
- [ ] Runner records per-episode input/output/cache-read/cache-write usage,
      resolved model ID, provider, harness version, and full transcript to
      committed JSONL.
- [ ] `--dry-run` cost projection, mandatory `--budget`, running spend ledger,
      and hard kill switch all working; documented cut order.
- [ ] Analysis code computes the geometric mean of per-instance paired ratios
      with BCa bootstrap CIs — with a test proving it does *not* report the
      ratio of means.
- [ ] Canary contamination probe implemented; any recallable scenario is
      discarded.
- [ ] Protocol file hashed and the hash committed, before any non-pilot billed
      run.
- [ ] **Pilot gate:** one cell runs end to end within the pilot budget, and its
      output demonstrates collected usage, applied grades, and a passing pairing
      audit.
- [ ] Tier-0 smoke config runs for ~$1 and is documented in a `README` a sceptic
      can follow.
- [ ] Nothing added to CI time; `evals/` is absent from the Turborepo graph and
      from `npm run test:all`.

## Open decisions for the project owner

1. **Anchor harness.** Pi is proposed for the cleanest measurement (smallest
   prompt overhead, model-agnostic). The counter-argument is that Claude Code is
   what most of the audience actually uses, so a number measured on Pi may read
   as less relevant even if it is more valid. Validity vs. relatability.
2. **Whether T2 survives.** Test-case enumeration overlaps T3 (test-data
   generation) in what it exercises, and you named both. Keeping it puts the run
   at ~$92 against a $100 cap; dropping it brings the run to ~$79 and frees
   headroom for more repeats, which is the only thing that tightens the
   headline's confidence interval.
3. **Hand-authored scenario count.** More realism costs authoring effort and
   risks our own bias in what we write; fewer means the marquee codegen task
   runs mostly on synthetic scenarios.
4. **Whether restructuring `AI-AGENT-REFERENCE.md` waits for the eval.** The
   static baselines will very likely show that task-slicing the reference —
   grammar for writing, CLI reference for reading — roughly halves the resident
   overhead, and that skill-style progressive disclosure cuts it by around 20×.
   That is a product improvement worth making on its own merits, and it needs no
   eval result to justify it. The argument for waiting is that changing the
   reference mid-design moves the thing being measured; the argument against is
   that shipping a cheaper reference is straightforwardly good and the eval
   should measure whatever is current. Recommend raising it as its own ticket
   now and letting the eval measure the improved version.
5. **Whether the `>90% valid Satsuma` claim gets measured here or just pulled.**
   Measuring it is a different experiment (generation validity, not
   comprehension cost) and would need its own arms. Recommend pulling it from
   the site in Phase 4 and giving it its own feature if it's wanted back.
