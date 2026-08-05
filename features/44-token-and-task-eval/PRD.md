# Feature 44 — Token and Task-Completion Eval: Satsuma vs. Spreadsheets and Markdown

> **Status: PROPOSED** (raised 2026-08-04, revised 2026-08-05) — requested by the
> project owner to put a reproducible measurement behind the site's quantitative
> claims about agent token usage, and to find out whether a coding agent given a
> `.stm` spec actually produces *better* work than one given the equivalent
> spreadsheet.
>
> **State this PRD was checked against:** `main` at `0579a037`; revision checked
> against `177cabd9`.
>
> **Revision, 2026-08-05.** Five changes, after a review of this protocol against
> the question a technical evaluator actually asks:
>
> 1. **Arm M (markdown) added as a billed behavioural arm** with its own M0/M1
>    profiles. Beating spreadsheets answers the marketing question; markdown is
>    what a sceptic substitutes for free, and the protocol was silent on it.
>    Compactness is explicitly *not* the claim — see
>    [What we actually claim over markdown](#what-we-actually-claim-over-markdown).
> 2. **Phase 0.5 added** — a ~$8 hand-graded probe that returns a directional
>    effect size *before* `MappingIntent`, the renderers, the totality test, the
>    pairing audit and the graders get built, with pre-committed kill thresholds.
> 3. **The cut order is corrected.** It previously put arm S second, contradicting
>    this document's own claim that S vs. S+ is what makes the result attributable.
>    Arms X, M, S and S+ are now uncuttable.
> 4. **Arm S+ is documented as a behavioural distribution, not a fixed treatment**,
>    because measured CLI output sizes show `--json` on aggregate commands costs
>    *more* than reading the source files. Invocations are now recorded per episode.
> 5. **T2 dropped** on the merits, and a context-boundary cell added, because
>    prompt caching partially substitutes for the benefit arm S+ is meant to provide.
>
> The revision leaves the pairing design, grading approach, statistics and
> pre-registration discipline intact — those were sound. It costs money: the run no
> longer fits the $100 cap, and [Costed run plan](#costed-run-plan--100-hard-cap)
> puts that choice to the project owner rather than silently absorbing it.
>
> **Direct antecedent.** `archive/features/43-site-audit-fixes/PRD.md` (Non-goals)
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
> the model/harness matrix, a costed run plan under a hard budget cap, a cheap
> probe that decides whether the full run is worth building, and a single-cell
> pilot proving the metrics are collectable. **It does not produce the published
> numbers** — executing the full run and updating site copy is a follow-on feature
> gated on this protocol being signed off. The one exception is `README.md:179`,
> which asserts tests that do not exist and is corrected now rather than in Phase 4.
>
> **What this feature is not.** It changes no Satsuma syntax, no grammar, and no
> CLI/LSP/VS Code/viz behaviour. It adds no package to the Turborepo task graph
> and must not lengthen CI.

## Goal

Replace three unfalsifiable marketing numbers with three separately-measured,
confidence-bounded, independently reproducible ones:

1. **Static compactness** — how many fewer tokens a `.stm` spec is than the
   same mapping expressed as a spreadsheet, as YAML, as JSON, and as a
   field-level markdown table. Deterministic; no model involved.
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

**The comparison has no controlled pairing.** For the arms to differ *only*
in representation, they must encode the same mapping. There is currently no
artifact in the repo of which that is true — see the next section, which is the
core design problem this feature solves.

## The central design problem: how the arms get paired

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

### The design: one intent record, several total renderers

Author the ground truth **once, in neither format**, as a machine-readable
`MappingIntent` record; render every arm from it mechanically.

```
                  MappingIntent  (JSON — the only source of truth)
                                 │
        ┌────────────────┬───────┴────────┬──────────────────────┐
        │                │                │                      │
   render_stm      render_xlsx      render_markdown      render_yaml / _json
        │          (P0|P1|P2)         (M0|M1)              (static only)
        ▼                ▼                ▼                      ▼
    Arm S / S+        Arm X            Arm M               Arms Y / J
        │                │                │
        └────────────────┴────────────────┘
                         ▼
            one ground-truth key grades all three
```

The repo already contains most of this. `tooling/satsuma-scenario-gen/` is
exactly the pattern: a scenario is plain data, it renders to Satsuma source, and
it *states the ground truth that follows by construction*. It never parses or
interprets Satsuma, and its one architectural rule is no dependency on
`@satsuma/core`. So:

- `satsuma-scenario-gen` gains a neutral **`MappingIntent` JSON serializer**
  alongside its existing Satsuma renderer. It stays pure string/JSON building
  and takes on no new dependency — in particular no xlsx writer.
- The **xlsx, markdown, CSV, YAML and JSON renderers live in `evals/`** (Python,
  `openpyxl` for the workbook), reusing the workbook-construction approach
  already proven in `skills/satsuma-to-excel/scripts/stm_to_excel.py` and the
  messiness primitives — header styling, fills, multi-tab layout — already in
  `archive/features/04-excel-to-stm-skill/test-data/generate_test_spreadsheets.py`.
  This is the same core-vs-consumer split `AGENTS.md` mandates: semantics in the
  shared generator, format-specific I/O in the consumer.

**Totality is the control, and it must be enforced, not assumed.** Every field
of `MappingIntent` must be rendered by *every* behavioural renderer, or one arm
is quietly handed less information than another. Two mechanisms:

1. **Renderer totality test** — a schema-driven test asserting every
   `MappingIntent` field is reachable in each renderer's output. A new intent
   field with no rendering in one arm fails the suite.
2. **Blind pairing audit** — an LLM reads *only* arm X, then *only* arm M, then
   *only* arm S, and reconstructs the intent record from each. All three
   reconstructions must agree with each other, and with the true record, on
   every gradeable element except the deliberately planted ambiguities. A
   disagreement means the arms are not paired and the run is invalid. This is a
   go/no-go gate before any billed run, not a post-hoc diagnostic.

**The markdown arm needs this control more than the xlsx arm does**, and the one
real-world artifact we have proves why. `tmp/dmd_tb_branch.{xlsx,stm,md}`
(untracked, client-derived, inspected locally on 2026-08-05 and not committable)
is the only Satsuma/markdown pair in existence here — and **it is not a pair**.
The `.stm` carries 15 schemas, **175 field-level arrows** and 79 natural-language
transform bodies in 656 lines. The `.md` carries **zero field-level mappings** in
146 lines: schema-level mermaid lineage, business rules summarised by *area*
rather than by field, and an explicit self-description as a companion document
*about* the `.stm`. Nothing could be implemented from it.

Two conclusions, and they point in opposite directions:

- The `.md` being 3.5× smaller than the `.stm` is **not** markdown winning on
  compactness. It is a *genre convention*: asked to document a mapping of this
  size in prose-plus-tables, the author produced a summary and silently dropped
  the payload a mapping spec exists to carry. That failure mode — silent
  omission, not visible mess — is markdown's characteristic risk, and it is the
  most honest available answer to "why not just write markdown".
- But it is **n = 1**, and that document was written as a companion to the `.stm`
  rather than as a substitute for it, so it cannot be cited as evidence of
  anything. What it does establish is a *methodological requirement*: a
  hand-authored markdown baseline will drift toward summary, which would hand
  Satsuma a win for entirely the wrong reason. Only a total `render_markdown`
  over `MappingIntent`, gated by the totality test, produces a markdown arm
  worth beating.

**Registered prediction for the static markdown comparison:** a *total*
field-level markdown table (175 rows of source, target, type and rule, for a spec
of that size) will come out at roughly **parity** with `.stm`, not 3.5× smaller
and not meaningfully larger. Registered in advance so that "Satsuma is more
compact than markdown" cannot be quietly adopted as a finding if it isn't one.

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

### Markdown gets the same treatment, for the same reason

If the xlsx arm's headline is its Excel-favourable profile, the markdown arm's
must be its markdown-favourable one. Anything else is the strawman the profile
mechanism exists to prevent.

| Profile | What the document looks like | Role |
|---|---|---|
| **M0 — tidy** | One field-level table per mapping with fixed columns (source, target, type, rule), consistent naming, rules stated per row | **Adversarially favourable to markdown.** The headline markdown comparison is bounded by this number |
| **M1 — typical** | Per-author structure: some mappings as tables and some as prose bullets, rules interleaved with commentary, a shared conventions preamble the reader must apply, inconsistent heading depth | The realistic middle — what a mapping doc written by whoever wrote it actually looks like |

The **M0↔M1 gap is itself a measurand**, not noise. It quantifies the
convention-inference cost that Satsuma's fixed grammar removes, which is one of
the three things we actually claim over markdown (below). A large gap is evidence
for the claim; a small one is evidence against it.

Note what M0 concedes: a tidy field-level markdown table is a genuinely good
artifact, and the totality test forces it to carry everything the `.stm` carries.
This arm is meant to be hard to beat.

## Arms

Behavioural arms (cost 💰 = billed episodes; static-only arms are free):

| Arm | Artifact | Agent tooling | 💰 | What it isolates |
|---|---|---|---|---|
| **X** | `.xlsx` at profile P0/P1/P2 | Python + `openpyxl`/`pandas`, file described as a mapping spec, free exploration | yes | The baseline the claim is made against — **the anchor arm** |
| **M** | Markdown at profile M0/M1 | Read/Grep/Glob, file described as a mapping spec | yes | **The alternative a sceptic substitutes instead** |
| **S** | `.stm` only | No `satsuma` CLI. `AI-AGENT-REFERENCE.md` in context | yes | **The language alone** |
| **S+** | `.stm` | `satsuma` CLI on PATH + `AI-AGENT-REFERENCE.md` | yes | **Language + tooling** — the configuration actually shipped |
| **Y** | YAML | — | no | The `40-60% smaller than YAML` claim (static only) |
| **J** | JSON | — | no | The JSON half of the same claim (static only) |
| **C** | CSV-per-sheet dump of X | — | no | Serialization sensitivity for the static claim |

**Arm X is the anchor, not an optional extra.** Spreadsheets are the world
Satsuma displaces and the baseline every published number is stated against, so X
is the one arm whose removal ends the run rather than shrinking it. It also
carries T5: real-world ambiguity lives in workbooks — merged cells, a free-text
Notes column, semantics in fill colour — and ambiguity detection measured only
against artifacts we authored ourselves measures our own planting.

**S vs. S+ is the contrast that stops the result being uninterpretable.** The
site makes two distinct claims — the format is compact (`index.njk:259`) and the
CLI gives agents structural queries instead of whole-file dumps
(`cli.njk:156`). Run only S+ and you cannot attribute the effect to either. A
sceptical technical evaluator will ask, and "we didn't separate them" is not an
answer.

### What we actually claim over markdown

Arm M exists because Excel and markdown answer two different questions. Excel is
the *status quo* Satsuma displaces; markdown is the *cheapest credible
alternative*, the one a sceptical engineer substitutes at zero cost with the
obvious retort — "we'll just write a well-structured markdown doc." An eval that
beats spreadsheets and stays silent on markdown answers the marketing question
and dodges the engineering one.

Compactness is **not** the argument, and the PRD should say so before anything is
measured. A total field-level markdown table is predicted to land at rough parity
(above). The three things we do claim:

1. **No convention inference.** Markdown structure is per-author: one writer's
   Notes column is another's H3 section, and the agent re-derives the convention
   for every new document. Satsuma's shape is fixed by grammar, so that cost is
   paid once by the ecosystem rather than per document — and, more importantly,
   does not vary with author quality. Measured by the **M0↔M1 gap**.
2. **There is an oracle.** `validate` and `lint` give ground truth on structural
   correctness; markdown admits no equivalent at any price. This is what kills
   the agent's most expensive loop — re-reading the document to "check
   carefully" — and it should surface in T1 and T5 as *quality* separation rather
   than token separation.
3. **Addressability.** Canonical entity IDs and stable field paths are what make
   arm S+'s queries possible at all. This is a *precondition* for the tooling,
   not a benefit of the surface syntax.

Note that (2) and (3) are both really arguments that **the language exists to
enable the tooling**. So register the uncomfortable outcome in advance: if arm S
lands at parity with arm M, the finding is *the tooling is the product and the
syntax is the enabling substrate*. That is a stronger and more defensible
position than "our syntax is shorter" — it matches where the engineering effort
actually went (grammar, core, CLI, LSP), and it cannot be neutralised by someone
writing a tighter markdown convention. "Our syntax is 12% smaller" invites
exactly that reply.

### Arm S+ is a behavioural distribution, not a fixed treatment

Measured on the installed CLI (**v0.12.0**, 2026-08-05) against
`examples/sfdc-to-snowflake/` — 5,817 bytes for the whole three-file workspace
including `examples/lib/` — and `examples/metrics-platform/` (10,922 bytes):

| Invocation | Output bytes | vs. reading the workspace |
|---|---|---|
| `graph --compact` | 151 | **38× smaller** |
| `validate` | 36 | — |
| `field-lineage <f>` | 158 | — |
| `arrows <f>` | 202 | — |
| `mapping --compact` | 369 | — |
| `fields <schema>` | 374 | — |
| `summary` | 792 | 7× smaller |
| `coverage` | 1,113 | 5× smaller |
| `summary --json` | 2,740 | 2× smaller |
| `graph --json` | 12,388 | **2.1× LARGER** |
| `coverage --json` | 15,601 | **2.7× LARGER** |
| `coverage --json` (metrics-platform) | 70,081 | **6.4× LARGER** |

The savings live in the **text and `--compact`** forms plus the targeted
primitives (`arrows`, `field-lineage`, `fields`, `meta`, `nl`, `validate`).
`--json` on the *aggregate* commands (`graph`, `coverage`) costs substantially
more than reading the source files. This inverts the common assumption — and the
most frequent external recommendation about this CLI — that structured output is
inherently cheaper for agents. It is cheaper only where the command is *narrowing*.

Three consequences the protocol must absorb:

1. **Arm S+'s token result is a property of the agent's invocation choices, not
   of the CLI.** An agent that reaches for `graph --json` makes Satsuma+CLI lose
   outright. The runner must therefore record **every `satsuma` invocation with
   its flags, exit code and output size** per episode, and the write-up must
   report the invocation mix alongside the headline. Without it, an S+ number is
   uninterpretable in a second way — the first being S vs. S+ attribution.
2. **This is a measurable property of the reference, which ties it to Feature
   45.** `AI-AGENT-REFERENCE.md:456-458` already advises `--compact` to minimise
   tokens, and `:439-461` is a 13-row situation→command decision table whose last
   row says to read files directly for raw content. Whether the agent *follows*
   that guidance is exactly the behavioural reference-delivery check this feature
   already promises; and if progressive disclosure drops the slice carrying that
   advice, S+ gets measurably worse. That is the sharpest available test of
   Feature 45's design.
3. **A free static deliverable, available today.** A per-command output-size table
   across the corpus at each spec size is deterministic and needs no model spend.
   It belongs with the other static measurements, and it is useful to agent and
   skill authors regardless of what the behavioural run concludes.

Two definitional consequences for the arms themselves:

- **`satsuma context` is excluded from arm S+.** It is the CLI's only heuristic,
  keyword-ranked command. Leaving it in turns the experiment into "our retrieval
  heuristic vs. grep" rather than "semantic structure vs. plain text". The runner
  records any attempt to call it as a protocol observation.
- **Arm S's withholding is enforced, not requested.** An agent instructed not to
  use a binary that is on `PATH` will use it. Arm S runs with the CLI absent from
  `PATH` (or in a container without the package), and the runner asserts absence
  before the episode starts.

### Satsuma pays for its own reference material

`AI-AGENT-REFERENCE.md` was ~7k tokens of fixed overhead (27.5 KB, 4,026 words)
before Feature 45 restructured it. **Whatever an arm actually loads counts
against that arm's budget.** Omitting it would be indefensible. Feature 45 has
implemented that restructure and its measurement (still pending merge and
release — see
[But the overhead is a *variable*, not a constant](#but-the-overhead-is-a-variable-not-a-constant--so-it-is-a-factor)
below for the sequencing this protocol depends on), and the Satsuma arms in
this feature charge the measured figures from
[`reference/token-costs.md`](../../reference/token-costs.md), not a bytes/4
estimate of the pre-restructure document.

The consequence is worth stating up front because it likely reshapes the
headline: on a small spec, Satsuma may well *lose* on total tokens, and only win
past some workspace size. If so, the deliverable is a **break-even curve**
(tokens vs. number of mappings, all arms plotted, crossover marked) rather than
a single multiple. That is a strictly better asset than "3-8x": it is
defensible, it tells an evaluator where the technique pays off for *their*
workspace, and it cannot be dismissed as cherry-picking. The run must therefore
sweep spec size — 1, 3, 10 and 25 mappings — not just measure one size.

### But the overhead is a *variable*, not a constant — so it is a factor

The fixed cost above assumed the whole reference was resident in context,
which is how it was used before Feature 45. It need not be, and no longer is:
this analysis — the CLI reference is a large, mostly reading-only share of the
document; a task-appropriate slice roughly halves it; an MCP server's
eagerly-injected tool schemas are worse than every mechanism actually
shipped — is exactly the task-need analysis that drove Feature 45's split,
and now has measured numbers behind it instead of bytes/4 estimates. See
`features/45-agent-reference-progressive-disclosure/PRD.md`'s Background and
"The measurement, pulled forward from Feature 44" sections for the reasoning,
and [`reference/token-costs.md`](../../reference/token-costs.md) for the
per-section/profile/envelope figures this feature's Satsuma arms now charge.

Headline figures, so this feature's arms and budget calculations don't need
to open that report just to get the numbers they charge:

| Mechanism (shipped) | Resident cost | Loaded cost (once used) |
|---|---|---|
| `--profile write` (CLI, or the skill's `write` slice) | 0 | 3,743 tokens |
| `--profile read` (CLI, or the skill's `read` slice) | 0 | 4,360 tokens |
| Skill envelope, before it triggers | 164 tokens (frontmatter only) | +6,738 tokens (whole document + intro) |
| Portable blob (`AI-AGENT-REFERENCE.md` pasted in) | 6,653 tokens | 6,653 tokens (no lazy option) |
| MCP comparison point (not shipped) | 2,253 tokens, every request | 2,253 tokens |

All `o200k_base`, via `js-tiktoken`. The MCP comparison bears out the
prediction above on the resident axis specifically — it is the only mechanism
that costs tokens on requests that never touch Satsuma at all — while costing
*less* than either profile's *loaded* figure, which is the nuance the
one-line "worst" claim missed before measurement.

**The counter-risk is real and is what makes this worth measuring rather than
just assuming.** Progressive disclosure can cost *more*: an agent that never
loads the grammar, guesses at syntax, and then burns a repair loop pays more
than one handed 7k tokens up front. Lazy loading trades a certain small cost for
an uncertain large one.

Two measurements, chosen to be nearly free:

1. **Static baseline cost per mechanism** (no model spend at all) — count what
   actually lands in context for each mechanism at each task type. This alone
   answers "is there a more token-efficient way", and it is the number that
   picks the mechanism for the behavioural arms. **This measurement was owned
   by Feature 45, not by this feature** (see below), and is done: see
   [`reference/token-costs.md`](../../reference/token-costs.md). This feature
   consumes that output rather than re-measuring it.
2. **One cheap behavioural check** — best static mechanism vs. status quo, one
   model, T1 (writing, needs grammar) + T4 (reading, needs CLI), n=3. It is
   looking for exactly one thing: does the agent reliably *load* what it needs,
   and if it doesn't, does the repair loop cost more than the tokens saved?
   This stays here, because it costs model spend and is a measurement, not a
   design decision.

**Agreed sequencing (2026-08-04).** Restructuring the reference is a product
improvement that stands on its own merits, and it happens **first**, as
`features/45-agent-reference-progressive-disclosure/PRD.md`. The static baseline
measurement moves into that feature, because it is the evidence for which
mechanism to build and it should inform the restructure rather than post-date it.

This feature then measures the *restructured* reference. Two consequences:

- The Satsuma arms use the shipped `--profile write` / `--profile read` slices,
  not the monolithic document, so the overhead charged to Satsuma is the real
  one rather than a soon-to-be-obsolete worst case.
- **Feature 45 must ship and be released before this protocol is hashed.** If the
  reference changed after pre-registration, the registered artifact would not be
  the measured one. This is also the Goodhart control: the split is derived from
  task-need analysis before any episode runs, and is not retuned against eval
  outcomes. **Status: implemented, not yet merged/released** — the restructure
  and its measurement (`reference/token-costs.md`) are done on
  `feat/agent-reference-progressive-disclosure`; sl-6ips's gate (merged AND
  in a release) is still open until that branch merges and a version ships.

## Tasks and how each is graded

Four tasks. Three are graded **deterministically against the intent record**,
which is the single biggest lever on this eval's credibility: LLM-as-judge is
the weakest link in any eval, and most of these don't need one.

| # | Task | Primary grading | Judge? |
|---|---|---|---|
| **T1** | Generate a pipeline implementation (dbt model + SQL) for one mapping | Deterministic: does it parse; is every target field populated; does the derived field-level coverage match the intent record's | Yes — idiomaticity only |
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
is how four tasks fit inside the budget of three.

**T2 (enumerate data-quality test cases) is dropped.** Settled 2026-08-05, and on
its merits rather than under budget pressure: it overlaps T3 in what it exercises
— both probe whether the arm recovered the constraint set — while being the only
remaining task needing a judge for its primary grade. Dropping it removes the
weakest measurement, not the cheapest one. The freed ~$13 funds arm M, the
context-boundary cell, and a raised *n* on arm S. The IDs T3/T4/T5 keep their
original numbers so that existing cross-references and Feature 45's PRD stay
valid; the gap at T2 is deliberate and records the decision.

### One cell must cross a context boundary

Prompt caching **partially substitutes for the exact benefit arm S+ is supposed to
provide.** Inside a single warm session, an agent re-reading a large `.stm` or
re-dumping a sheet pays cache-read prices — roughly a tenth of fresh input, and
roughly the cost that narrowing via the CLI is meant to eliminate. An S+ advantage
measured entirely within one warm context therefore tests something narrower than
the claim at `cli.njk:156`.

Where caching cannot help is **across** a context boundary: a fresh session,
a post-compaction continuation, a subagent fan-out. That is where precise
retrieval should pay most, because rediscovery is re-paid at full price.

Add one cell — **T4, 1 rung, n=3, at the 25-mapping spec size** where compaction
is likeliest, ~$2 — and report the S+ advantage **with and without a boundary
crossed**. If the effect exists only within a warm session, the honest claim is
much narrower than the site currently makes, and we should be the ones to find
that out.

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

**Secondary paired ratios**, reported the same way: X/M (does structure beat prose
at all), M/S+ (the sceptic's comparison), and S/S+ (the tooling decomposition).

**Which comparisons carry a CI, and which do not.** The X-vs-S+ headline is
powered for one; the decomposition arms are not, and the PRD must not let them
inherit the headline's framing by proximity. Arm S at its funded slice yields on
the order of a dozen episodes, which cannot support a bootstrap CI. Therefore:

- **X vs. S+ and M vs. S+** are reported as `point estimate [95% CI]`.
- **S vs. S+** is reported as a **directional decomposition with per-cell
  observations shown**, explicitly labelled as underpowered for an interval. It
  answers "which of the two factors dominates", not "by exactly how much".

If the freed budget stretches far enough to raise arm S to *n* = 5 across both
rungs, S vs. S+ is promoted to a CI-bounded figure and this paragraph is amended.
What must not happen is a thin arm quietly reported as though it were a thick one.

**Invocation mix.** For arm S+, report the distribution of `satsuma` subcommands
and flags actually used per episode, and the share of S+ input tokens originating
from CLI output versus file reads. See
[Arm S+ is a behavioural distribution](#arm-s-is-a-behavioural-distribution-not-a-fixed-treatment)
— without this, the S+ number cannot be attributed to the CLI's design rather
than to one agent's habits.

**Turn count is reported alongside tokens.** With caching, dollar cost and token
count diverge; with tool-calling, both diverge from wall-clock and from the
number of round-trips a user waits through. Turns are the honest latency proxy and
the metric most sensitive to the round-trip overhead that should make Satsuma+CLI
*lose* at small spec sizes.

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

Task sizes in CEE: T1 1.0, T3 0.8, T4 0.25, T5 0.25 → **2.3 CEE per
arm per model per repeat** (T2 dropped, see below).

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
| Primary: arms X vs S+, 4 tasks, 4 rungs, n=5, Pi | 23/rung | **$53** |
| Arm M (markdown), 4 tasks, 4 rungs, n=5, Pi | 23/rung | **$26** |
| Secondary: arm S (language alone), T1+T4, 2 rungs, n=5 | 12.5 | **$4** |
| Context-boundary cell: T4, 1 rung, n=3, 25 mappings | ~4 | **$2** |
| Harness invariance: Claude Code + Codex, 1 rung, 2 tasks, 2 arms, n=3 | 15 | **$7** |
| Reference-delivery check: 2 mechanisms, T1+T4, 1 rung, n=3 | 7.5 | **$4** |
| Judge panel: 3 judges × 40 T1 outputs | 120 calls | **$5** |
| Pairing audit (now three arms) + canary probes | — | **$4** |
| Phase 0.5 probe | ~6 | **$8** |
| Pilot (Phase 3 gate) | ~3 | **$5** |
| Static arms (Y, J, C, markdown, tokenizer counts, per-command output sizes) | — | **~$0** |
| | **Total** | **~$118** |

**That is over the cap, and the cap is hard.** Two honest options, and the choice
belongs to the project owner (open decision 2):

- **Drop the harness-invariance slice (−$7) and reduce arm M to 2 rungs (−$13),
  giving ~$98.** Arm M at the top and bottom rungs still tests the registered
  capability-ladder prediction, which is the only thing the four-rung sweep buys.
  This is the recommended cut: it keeps every arm alive and every comparison
  interpretable.
- **Raise the cap to $150.** The eval's whole purpose is replacing numbers that
  are currently indefensible; $50 is cheap against publishing a wrong one. If the
  answer matters enough to measure, it probably matters enough to measure properly.

Arm M is not free, and the PRD should not pretend otherwise: adding the comparison
a sceptic actually cares about costs about a quarter of the run. The judgement is
that a defensible markdown number is worth more than a four-rung sweep of a
harness-invariance check the PRD already refuses to generalise from.

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
  first, then arm M from 4 rungs to 2, then the context-boundary cell, then *n*
  from 5 to 3, then Excel profile P2, then P1. Anything cut is named in the
  write-up.

  **Four things are uncuttable: arms X, M, S and S+.** Removing any of them does
  not shrink the run, it ends it — a budget squeeze that deletes arm S leaves the
  expensive primary slice intact and *uninterpretable*, which is the worst
  available outcome. The earlier version of this cut order put arm S second,
  contradicting this document's own claim that S vs. S+ is what makes the result
  attributable; that is corrected here. If the ledger cannot fund all four arms at
  minimum viable *n*, the runner **aborts and reports a partial run** rather than
  silently degrading to a comparison that cannot be interpreted.
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
matters (T1, T3).

## Delivery phases

| Phase | Content | Feature |
|---|---|---|
| **0** | This PRD — protocol, arms, tasks, graders, matrix, costing, pre-registration | **44** |
| **0.5** | **Insight-first probe** — hand-authored scenario, 5 arms, T4 + T5, hand-graded. Go/no-go on building Phases 1–3 at all | **44** |
| **1** | `MappingIntent` schema + all three behavioural renderers + totality test + blind pairing audit passing | **44** |
| **2** | Deterministic graders (T3/T4/T5) + static-compactness measurement (arms Y, C — no model spend) | **44** |
| **3** | **Pilot gate:** one cell end to end (1 model, 1 harness, T1 + T4, n=3), proving usage is collectable, grading runs, and arms are paired | **44** |
| **4** | Full run, statistics, `RESULTS.md`, published methodology page, **site copy updated to the measured numbers** | follow-on |

Phase 4 is explicitly out of scope here and should be raised as its own feature
once this protocol is signed off.

### Phase 0.5 — the probe that decides whether to build the machinery

As written before this revision, the earliest signal from this feature arrived at
the Phase 3 pilot gate — behind Feature 45 shipping *and* releasing, plus
`MappingIntent`, three total renderers, a schema-driven totality test, a blind
three-arm pairing audit, and three deterministic graders. That is weeks of
engineering before anyone knows whether the effect is 1.2× or 4×. Phase 0.5 buys
that number first.

**Design.** One hand-authored scenario of ~10 mappings, expressed by hand in each
representation. Five arms, with **Excel as the anchor**:

| Probe arm | Role |
|---|---|
| **X-P0** | The headline pair with S+. Tidy, adversarially favourable to Excel |
| **X-P2** | The realism check — the P0↔P2 spread is the honest-bound question |
| **M0** | The sceptic's substitute |
| **S** | Language alone |
| **S+** | Language + CLI — the shipped configuration |

Two tasks: **T4** (impact analysis) and **T5** (ambiguity detection). *n* = 2. One
model, one harness. **~$8.**

**Why those two tasks:** both are gradeable **by hand against an answer key
written when the scenario was authored** — T4 by set-F1 against the true
downstream set, T5 by counting flags against the planted list. Neither needs
`MappingIntent`, the renderers, the totality test, the pairing audit, or a judge.
T1 is excluded because it needs the judge panel and derived coverage. T4 and T5
are also where the S+ advantage should be most visible: `lineage`/`where-used`
versus reconstructing traversals by hand, and the deterministic/NL split
respectively.

**Include a cell designed to lose.** Run the same probe at **1 mapping**, where
the reference overhead and per-call round-trips should make S+ *lose* outright.
Confirming the crossover exists at the small end costs almost nothing here and is
the single most credible thing the eventual write-up can contain — it is the
difference between a break-even curve and a marketing multiple.

**What it is explicitly not.** Not evidence, not publishable, not pre-registered.
Its scenario is hand-authored by us with no totality control, so its arms are
**not paired** to the standard the registered run requires, and its markdown arm
in particular is at risk of the summary drift documented above. Its numbers must
never appear on the site or in `RESULTS.md`. That limitation is precisely why it
is cheap, and precisely why it must not be allowed to grow.

**Its three outputs.**

1. A **go/no-go on building Phases 1–3**, against thresholds written before the
   run:
   - S+ ≥ 0.85 × M on tokens **and** no quality separation on T5 → **stop.** The
     effect is inside run-to-run noise and no amount of harness rescues it. The
     honest follow-up is to correct the site copy downward without a full study.
   - S+ ≤ 0.6 × M → **build the full protocol.**
   - In between → build Phases 1–2, then re-probe before committing the primary
     slice.
2. A directional effect size per arm pair, used to **size *n*** for the full run.
   The current *n* = 5 is a guess; the probe replaces it with an estimate.
3. A list of protocol bugs found cheaply: does the S+ agent actually *use* the
   CLI, or ignore it; **does it fall into the `--json`-on-aggregate-commands trap**;
   does it reach for `satsuma context`; is **turn count** rather than tokens the
   thing that moves; is arm-S withholding actually enforced; do the hand-written
   answer keys survive contact with real output.

**Sequencing.** Phase 0.5 waits for **Feature 45 to ship and release**, so the
reference it charges against is the one that will actually be measured, and so
Feature 45's slicing design cannot be tuned against probe outcomes — that
feature's "no iteration against eval outcomes" Goodhart control would otherwise
come under strain. It still lands well before Phases 1–3, which is where the
saving is.

**Reuse rather than write from scratch.**
`useful-prompts/excel-to-stm-prompt.md` (343 lines: full grammar, conventions,
worked examples, a self-critique checklist, and it already emits ambiguity flags)
is a ready-made no-CLI treatment for arms X and S. `testing-prompts/` holds 21
per-command agent exercise prompts that are a realistic source of S+ task
phrasings. `archive/features/04-excel-to-stm-skill/test-data/generate_test_spreadsheets.py`
gives P0-grade workbook construction.

## Publishing commitment

Registered in advance, as a condition of the measurement being worth anything:
**the site copy follows the data.** If the measured ratio is 1.8×, the site says
1.8×. If Satsuma loses below some spec size, the break-even point is published
alongside the win. And if arm M comes out at parity, the site stops implying
otherwise.

**Every site that carries these numbers is updated, not just the two on the
landing page.** A commitment that fixes two of eight leaves the claim in
circulation:

| Location | Claim |
|---|---|
| `README.md:179` | "**our tests show** 3–8x fewer tokens than equivalent spreadsheets or YAML" |
| `site/index.njk:259` | "40-60% Smaller" / "3-8x less token usage" |
| `site/index.njk:524` | "3–8x more compact than spreadsheets" |
| `site/index.njk:654` | FAQ — "5–7 lines of YAML … 40–60% smaller than YAML" |
| `docs/using-satsuma-without-cli.md:38-40` | "3–8x more compact than equivalent spreadsheets, YAML, or free-form docs" |
| `docs/tutorials/data-engineer-tutorial.md:368` | "3-8x more compact than equivalent spreadsheets or YAML documents" |
| `docs/product-owner/PROJECT-OVERVIEW.md:67`, `:202` | "40-60% smaller than equivalent YAML" (`:67` is phrased as a design goal, `:202` as a result) |
| `docs/product-owner/PROJECT-OVERVIEW.md:237` | ">90% LLM-generates-valid-Satsuma" — a future target in a success-metrics list |

`README.md:179` is the worst of the set and should be corrected **immediately,
not in Phase 4**: it asserts that tests exist. They do not — there is no eval code
anywhere in the repo, which is why this feature exists. Every other line above is
an unsourced claim; that one is a false statement about our own repository.

The `>90%` figure is either measured or removed. (`site/_site/` is generated
output — only the `.njk` sources need editing.)

The failure mode this commitment exists to prevent is running the experiment,
disliking the answer, and quietly keeping the old number.

## Non-goals

- **No new Satsuma syntax, grammar, CLI, LSP or viz behaviour.** If the eval
  reveals tooling gaps (e.g. an agent repeatedly wants a command that doesn't
  exist), those become separate tickets, not scope here.
- **No claim about human comprehension.** This measures agents. "Faster for
  humans to scan" (`PROJECT-OVERVIEW.md:67`) needs a study with human subjects
  and is out of scope.
- **No comparison against dbt, DBML, or other mapping DSLs.** Spreadsheets,
  markdown, YAML and JSON only — the formats the claims name, plus the one a
  sceptic substitutes for free. Other mapping DSLs are a different question
  (competitive positioning, not agent cost) and need their own feature.
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
- [ ] All three behavioural renderers (`.stm`, `.xlsx`, markdown) implemented,
      with the xlsx renderer supporting messiness profiles P0/P1/P2 and the
      markdown renderer supporting M0/M1.
- [ ] **Renderer totality test passes**: every `MappingIntent` field is
      demonstrably rendered in all three behavioural arms; adding an unrendered
      field fails the suite. The markdown renderer is covered by the same test —
      its characteristic failure is silent omission, so it is the arm this test
      most needs to guard.
- [ ] **Blind pairing audit passes**: independent reconstructions from arm X
      alone, arm M alone and arm S alone agree with each other and with the
      intent record on every gradeable element except the planted ambiguities.
- [ ] Deterministic graders for T3, T4 and T5 implemented and unit-tested,
      including negative tests proving each grader *fails* a deliberately wrong
      submission.
- [ ] Judge rubric for T1 written, with a worked example per score band, and an
      agreement threshold committed.
- [ ] Static-compactness measurement produces per-tokenizer, per-serialization,
      per-spec-size numbers for arms S/X/M/Y/J/C — including the
      `AI-AGENT-REFERENCE.md` overhead charged to the Satsuma arm — with no
      model spend.
- [ ] **Per-command CLI output-size table** produced across the corpus at each
      spec size, with no model spend, documenting which invocations narrow and
      which (`graph --json`, `coverage --json`) cost more than reading the source.
- [ ] Runner records **every `satsuma` invocation** per episode with flags, exit
      code and output size; the analysis reports the arm-S+ invocation mix and the
      share of S+ input tokens originating from CLI output versus file reads.
- [ ] **Arm S's CLI withholding is enforced and asserted** — the CLI is absent
      from `PATH` for arm-S episodes and the runner verifies this before starting,
      rather than instructing the agent not to use it.
- [ ] `satsuma context` is excluded from arm S+, and any attempt to invoke it is
      recorded as a protocol observation.
- [ ] Context-boundary cell run, reporting the arm-S+ advantage with and without
      a context boundary crossed.
- [ ] **Phase 0.5 probe run and its go/no-go thresholds evaluated** before any
      Phase 1 engineering begins, with its non-publishable status recorded in the
      write-up and its numbers absent from `RESULTS.md` and the site.
- [ ] `README.md:179` corrected immediately — it asserts tests that do not exist,
      which is a false statement about this repository rather than an unsourced
      claim.
- [ ] **Reference-delivery baselines consumed from Feature 45** (which owns that
      measurement): the Satsuma arms use the shipped task-appropriate profile,
      and the resident overhead charged to them is Feature 45's measured figure,
      not a bytes/4 estimate.
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
2. ~~**Whether T2 survives.**~~ **Settled 2026-08-05: dropped**, on the merits —
   it overlapped T3 and was the last task needing a judge for its primary grade.
   The live question it has been replaced by is **how to fit arm M under the cap**:
   drop the harness-invariance slice and run arm M at 2 rungs instead of 4
   (~$98, recommended), or raise the cap to $150. See
   [Costed run plan](#costed-run-plan--100-hard-cap).
3. **Hand-authored scenario count.** More realism costs authoring effort and
   risks our own bias in what we write; fewer means the marquee codegen task
   runs mostly on synthetic scenarios.
4. ~~**Whether restructuring `AI-AGENT-REFERENCE.md` waits for the eval.**~~
   **Settled 2026-08-04: it goes first**, as Feature 45
   (`features/45-agent-reference-progressive-disclosure/PRD.md`). The static
   baseline measurement moves there; this feature measures the restructured
   reference and must not hash its protocol until Feature 45 is released. See
   [But the overhead is a *variable*](#but-the-overhead-is-a-variable-not-a-constant--so-it-is-a-factor).
5. **Whether arm M is reported as a headline number or a footnote.** The measured
   markdown ratio is the one a technical evaluator will look for, and the
   registered prediction is that it lands near parity on static size with the
   advantage showing up in *quality* instead. Publishing it prominently is the
   honest choice and makes the whole write-up harder to dismiss; it also means the
   site can no longer imply compactness-over-prose. Recommend headline.
6. **Whether the `>90% valid Satsuma` claim gets measured here or just pulled.**
   Measuring it is a different experiment (generation validity, not
   comprehension cost) and would need its own arms. Recommend pulling it from
   the site in Phase 4 and giving it its own feature if it's wanted back.
