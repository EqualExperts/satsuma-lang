# Thoughts so far — Feature 44, after the static arms

> **Status: working note, mid-feature.** Written after the static-compactness
> arms (S/Y/J) landed in PR #516 and before the behavioural arms (S/S+/X/M)
> have run. Not a decision document — a record of where the thinking sits
> after the first measured result came back, so it is not lost or quietly
> revised later. The behavioural run is what will actually answer the
> question this note ends on.

## What the static arms found

The site said Satsuma is "40–60% smaller than YAML" in seven places, citing
"our v3" — a YAML design that exists nowhere in this repo, so the number was
unverifiable. The static measurement replaced it with a measured one: across
the 21 specs in `examples/`, under `o200k_base`, like-for-like (all arms
comment-free), the median reduction against equivalent YAML is **9%**
(range 2.5–22.1%), and against 2-space JSON **36.1%**. YAML is smaller than
`.stm` on 0 of 21 specs. The published claim needed a ratio of 1.67×–2.50×;
the measured range is 1.03×–1.28× — overstated by roughly 5 to 25 times.

The measurement is trustworthy in the way that matters for a self-funded
claim: the YAML design was committed *before* the number, it is deliberately
charitable to YAML, two guards fail rather than warn on every spec, and the
entire span of defensible YAML encodings is under 7% of the flagship file
against a claim needing 67–150%. No re-making of the design judgement calls
reaches the published figure.

This was not the result we hoped for. It is the result the measurement was
built to find, and finding it is the measurement working, not the product
failing — but that distinction is easier to write than to sit with.

## What the static arms did *not* measure

Two things the compactness number cannot see, both worth naming so the 9%
is not read as "Satsuma and YAML are otherwise equivalent."

**Human-friendliness.** The PR measured tokens and characters, not
readability. Rendering real specs through the PR's own emitter, the YAML is
a competent serialisation for flat schemas and a noticeably worse one for
the constructs that are actually Satsuma's differentiators:

- **Nested iteration** flattens `each`/`flatten` blocks into dotted keys
  (`orders.lines.sku`, `orders.packed_items.units`). The Satsuma source is
  visually nested; the YAML reader has to reconstruct the tree from key
  names. The token count credits the YAML for a property that hurts humans.
- **Namespaces** lose their block grouping entirely — `namespace raw { … }`
  becomes a `namespace: raw` field repeated on every schema, and a reader
  cannot tell where one namespace ends and the next begins without scanning
  every row.
- **Block notes** preserve their interior indentation verbatim under `|-`,
  which looks mis-indented to a YAML reader, where Satsuma's `""" … """`
  delimiters make the same content look intentional.

The "charitable to YAML" framing is charitable on *size* only. Several
terseness choices that help the token count — dotted-key flattening, flow
style over block, dropping the namespace block — trade readability the metric
cannot see. So the lower-bound framing ("every ratio is a lower bound on
Satsuma's advantage") does **not** extend to readability, where Satsuma's
advantage is plausibly larger, not smaller. This is not a defect of the
measurement; it is a scope the measurement did not claim. It belongs here so
a reader of `reference/static-compactness.md` does not walk away thinking
"9% smaller and otherwise equivalent."

**Tooling.** The compactness comparison loads everything. The project's real
claim is that the CLI lets agents *shortcut* loading everything — and the
PRD's own pre-measurement table already shows that claim is
command-dependent, not CLI-dependent:

| Invocation | Output | vs. reading the workspace |
|---|--:|--:|
| `field-lineage <f>` | ~158 B | ~37× smaller |
| `graph --compact` | 151 B | 38× smaller |
| `validate` | 36 B | — |
| `summary` | 792 B | 7× smaller |
| `summary --json` | 2,498 B | 2× smaller |
| `graph --json` | 11,850 B | **2× larger** |
| `coverage --json` | 14,479 B | **2.7× larger** |

The savings live only in the *narrowing* commands. `--json` on the aggregate
commands costs more than reading the source files, which inverts the most
common external recommendation about this CLI. An agent that reaches for
`graph --json` to "be structured" makes Satsuma+CLI lose to plain
YAML-by-file-read. The win is a property of the agent's invocation choices,
not of the CLI — which is why arm S+ must record every invocation with its
flags and output size per episode, and why the headline is uninterpretable
without the invocation mix.

## Where the claims relocated

The eval did not destroy the claims; it relocated them. Three published
claims, three different fates:

1. **"Compact representation"** — does not hold as stated. 9% is not 40–60%,
   and once the 6,813-token agent reference is charged, Satsuma loses on
   per-file size on every spec in the corpus. The site copy is corrected.
2. **"Tooling lets agents shortcut context"** — holds conditionally and
   narrower than stated. Only with the narrowing commands, only when the
   agent queries instead of loads, and most clearly across a context
   boundary where prompt caching cannot substitute. The PRD's
   context-boundary cell is what will measure this.
3. **"There is an oracle"** — holds, and is probably the real product.
   `validate` and `lint` give ground truth on structural correctness that
   YAML and markdown have no equivalent of at any price. This is what kills
   the agent's most expensive loop, and it should surface as *quality*
   separation (T1 correctness, T5 ambiguity detection) rather than token
   separation.

The honest re-framing, which the PRD registered *before* the measurement
came in: **the tooling is the product and the syntax is the enabling
substrate.** The grammar, the core, the CLI, the LSP — the engineering
effort — is what the eval is now correctly centring. "Our syntax is 9%
smaller" invites the reply "we'll write a tighter YAML schema." "Our CLI
answers `what depends on Amount?` in 158 bytes instead of 5,817, and
`validate` tells you the spec is structurally sound before you generate a
line of code" is harder to neutralise — but it depends on the agent
reaching for the narrowing command, which is a behavioural question, not a
static one.

## Risks the eval surfaced that are real

- **The adoption tax.** An agent reading `.stm` carries a reference YAML
  does not. On a single small spec, Satsuma loses on total tokens. The
  breakeven sits around a 75k-token workspace — genuine production scale,
  not a single mapping file. That is a real constraint on who this is for:
  the value proposition sharpens with platform size, and is weakest exactly
  where a spreadsheet-and-markdown team starts.
- **The win is conditional on agent behaviour.** `--json` on aggregates
  costs *more* than reading the files. Whether the agent follows the
  reference's guidance toward the narrowing commands is exactly the
  behavioural reference-delivery check Feature 45 promises, and it is
  unproven until the behavioural arms run.
- **Product-market fit is untested.** The eval measured representation and
  tooling properties. It did not measure whether a team currently living in
  spreadsheets or markdown will adopt a DSL. dbt, data vault tooling, and
  "we'll just write a tighter YAML schema" are good-enough incumbents. The
  eval showed the thesis is sound *where it claims to be*; it did not show
  the market wants it.

## The decision not to decide yet

The question "is Satsuma still a good idea" is the one this feature was
built to answer, and it is not answered yet. The static arms came back
weaker than hoped on the one claim (compactness) that was always too small
to justify adopting a DSL on its own — and they did not touch the claims
(oracle, addressability, tooling) that actually are the case for the
project. Those live or die in the behavioural arms: S vs. S+ vs. X, with
the invocation mix recorded, across the context-boundary cell, on the
capability ladder including a deliberately weak model.

If the behavioural arms come back and S+ does not beat X on task cost or
quality — even on the weak-model rung, even across a context boundary,
even with the narrowing commands — *that* is when the project is in
trouble, because it would mean the oracle and addressability do not
translate into agent outcomes. We are not there. We are at "the static
number was wrong and the tooling claim is narrower than stated," which is
a correctable position, not a terminal one.

Killing the project now means throwing away the eval before it answered the
question it was built for. The honest path is to finish the run: build
`MappingIntent`, run the behavioural arms, and let the registered
prediction — that Satsuma's advantage is largest on the weakest model and
shrinks as models get stronger — either appear or fail to appear. Either
outcome is a better decision basis than the one we have today.

## Why this note exists

The version of this project that has a defensible 9% and a tooling claim
pinned to narrowing commands and a real oracle is a stronger project than
the one that had 40–60% and a hand-wave. It is just a less fun one to be
the owner of on the day you find out. This note is so that the thinking
that got us here is recorded, dated, and not quietly revised once the
behavioural numbers come in — whichever way they go.
