# Feature 45 — Progressive Disclosure for the AI Agent Reference

> **Status: IMPLEMENTED** (2026-08-05) — all 9 `arpd-*` tickets closed (epic
> `arpd-6iis`), PR #492. Requested by the project owner to restructure
> `AI-AGENT-REFERENCE.md` *before* Feature 44 measures anything, so the eval
> measures the artifact we intend to ship rather than one we are about to
> replace.
>
> **State this PRD was checked against:** `main` at `0579a037`.
>
> **Relationship to Feature 44.** Feature 44 (`features/44-token-and-task-eval/`)
> treats the reference's ~6.9k tokens as a fixed cost charged to the Satsuma arm,
> and identifies that cost as the term most likely to decide whether there is a
> break-even at all. This feature makes that term smaller and, critically, ships
> **before** Feature 44's protocol is pre-registered — see
> [Ordering constraint](#ordering-constraint-and-the-goodhart-risk).
>
> **This feature stands on its own merits.** Every user of the reference pays for
> a document of which roughly half is irrelevant to whatever they are doing. That
> is worth fixing whether or not the eval ever runs.

## Goal

Cut the resident context cost of teaching an agent Satsuma, without reducing what
an agent can find out, and without regressing the harnesses that cannot do
progressive disclosure at all.

Three sub-goals, in priority order:

1. **One canonical source, several delivery envelopes.** Section content is
   authored once and composed at build time into the CLI's output, the
   no-CLI paste blob, and any skill wrapper — never hand-maintained twice.
2. **Task-appropriate slices.** A codegen task should not pay for the CLI
   command reference; a lineage-analysis task should not pay for the EBNF.
3. **Lazy loading where the harness supports it**, with the full document still
   reachable in one call for harnesses that don't.

## Background — the measured anatomy of the file

> The two tables directly below are historical: they describe the
> **pre-restructure** monolithic document, in the bytes/4 estimate this
> feature set out to replace, and are kept only so the "what needed cutting"
> narrative below still makes sense. Every subsequent estimate in this PRD
> has been replaced by a measured number — see
> [The measurement, pulled forward from Feature 44](#the-measurement-pulled-forward-from-feature-44)
> and [`reference/token-costs.md`](../../../reference/token-costs.md) for the
> post-restructure figures, keyed to the 8 canonical `reference/*.md`
> sections these subsections became.

`AI-AGENT-REFERENCE.md` was 27,489 bytes. Section sizes, measured with code
fences handled correctly (naive measurement is fooled by the `##` headings
*inside* the fenced conventions block):

| Section | Bytes | ≈ tokens | Share |
|---|---|---|---|
| `## Portable Grammar & Conventions` | 12,964 | ~3,240 | 47% |
| `## Satsuma CLI — Agent Tooling` | 11,418 | ~2,850 | 42% |
| `## Agent Workflow` | 2,988 | ~750 | 11% |

Broken down one level further:

| Subsection | Bytes | ≈ tokens | Needed by |
|---|---|---|---|
| `### Conventions & Rules` | 5,983 | ~1,495 | **Both** (partly) |
| `### Grammar (compact EBNF)` | 3,528 | ~880 | Writing only |
| `### Command reference` | 3,699 | ~925 | Reading only — *and largely reproducible by `--help`* |
| `### Composing workflows` | 2,473 | ~620 | Reading only |
| `### Common mistakes` | 1,672 | ~420 | Writing only |
| `### Transform classification` | 1,379 | ~345 | Both |
| `### When to use the CLI vs. reading files` | 1,367 | ~340 | Reading only |
| `### field-lineage vs arrows` | 922 | ~230 | Reading only |
| Two worked examples | 1,479 | ~370 | Writing only |
| `### CLI output in prompts` | 383 | ~95 | Reading only |

**The document already says where it should be cut, and nothing enforces it.**
The CLI section opens with:

> **Include this section only when the agent has access to the `satsuma` CLI.**
> Run `satsuma agent-reference` to print this entire document.

That is a progressive-disclosure instruction addressed to a human assembling a
prompt by hand. There is no mechanism behind it: `satsuma agent-reference` prints
all 27 KB or nothing, because `tooling/satsuma-cli/scripts/prebuild.js` bakes the
whole file into a single exported string
(`tooling/satsuma-cli/src/generated/agent-reference.ts`).

### Task-need analysis

Grouping by what a task actually needs — this is the analysis that drives the
split, deliberately *not* eval scores (see the Goodhart note below):

| Task shape | Needs | Tokens (`o200k_base`, measured) | vs. 6,813 whole document |
|---|---|---|---|
| **Writing** Satsuma (codegen, conversion, authoring) | EBNF, conventions, common mistakes, examples, the generate-workflow steps | **3,743** | **45% cut** |
| **Reading** Satsuma (lineage, impact, coverage, audit) | Command reference, composition guidance, transform classification, the `@ref` and path-syntax parts of conventions, the read-workflow steps | **4,520** | **34% cut** |

(These were originally estimated at ~3,600/~48% and ~3,300/~52% respectively;
measurement — see `reference/token-costs.md` — found `read` costs more than
`write` expected to, because the CLI command surface it needs
(`cli-index` + `cli-composition`) is larger than `write`'s grammar section.)

So **task-slicing roughly halves the resident cost**, and it does so with no
behavioural risk at all: the agent is handed everything it needs up front, just
not everything it doesn't.

### A correction worth recording

An earlier framing of this work claimed the largest win was *deleting* the CLI
section by deferring to `satsuma <command> --help` — which the document itself
advertises ("Self-discovery: Every command supports `--help`"). Measurement does
not support that as the *largest* win. Only `### Command reference` (~925 tokens,
13% of the file) is genuinely reproducible by `--help`. The remaining ~1,930
tokens of that section are composition guidance that `--help` cannot supply:
which command to reach for, why `field-lineage` differs from `arrows`, and the
coverage aggregate-vs-per-mapping trap that exists precisely because
hand-composed versions got it wrong.

Deferring the command list to `--help` is still worth doing — it removes a second
place where flags can drift from the CLI — but it is a ~13% saving, not a ~42%
one. Slicing is the bigger lever.

### Duplication across the repo

Verified: the EBNF block appears in exactly one prose location
(`AI-AGENT-REFERENCE.md`) — `satsuma-lang-contributor-guide.md` mentions CST node
type names like `field_decl` but carries no grammar block, so there is **no EBNF
drift today**.

The *conventions*, however, are partly restated in five `skills/*/SKILL.md` files
and two `useful-prompts/*.md` files. Each has a legitimate reason — skills must
be self-contained, and `useful-prompts/` exists for web LLMs with no CLI — but
each restatement is a place where guidance can drift from the canonical text, and
each pays its own token cost. A canonical section set makes build-time
composition possible where those files currently restate by hand.

## Design

### Canonical sections, composed at build time

```
reference/                       ← canonical, authored once
  grammar.md                     ~880 tok
  conventions.md                 ~1,495 tok
  mistakes.md                    ~420 tok
  examples.md                    ~370 tok
  cli-index.md                   ~925 tok  (or a stub deferring to --help)
  cli-composition.md             ~1,930 tok
  workflow-generate.md
  workflow-read.md
        │
        │  prebuild.js composes
        ▼
  ┌─────────────┬──────────────────┬─────────────────┐
  │ CLI         │ portable blob    │ skill wrapper   │
  │ --section   │ (no-CLI paste)   │ (lazy body)     │
  └─────────────┴──────────────────┴─────────────────┘
```

`prebuild.js` already bakes markdown into a generated TS module; this changes it
from baking one string to baking a **section map**. The composition is
mechanical, so drift between envelopes becomes impossible rather than merely
discouraged.

Proposed surface on the existing command:

```bash
satsuma agent-reference                      # unchanged — prints everything
satsuma agent-reference --section grammar    # one slice
satsuma agent-reference --profile write      # the slices a writing task needs
satsuma agent-reference --profile read       # the slices a reading task needs
satsuma agent-reference --list               # what sections exist, with token costs
```

**Back-compatibility is a hard constraint.** Bare `satsuma agent-reference` keeps
printing the whole document. It is a documented public command
(`SATSUMA-CLI.md`), the site tells people to append its output to their agent
instructions (`site/cli.njk`), and anything piping it today must keep working.
`--section`/`--profile` are additive.

### Progressive disclosure: what it actually buys, stated honestly

A skill-style envelope keeps ~50-100 tokens of frontmatter resident and loads the
body on demand. That is a ~20-70× reduction in *resident* cost — but only in
resident cost. **If a session ends up loading a slice anyway, progressive
disclosure saves nothing over plain slicing.** Its real wins are narrower and
worth naming so the feature is not oversold:

1. Sessions that touch Satsuma incidentally or not at all, and would otherwise
   have paid 6.9k tokens for nothing.
2. Sessions that need exactly one slice, which would otherwise pay for both.
3. Sessions where the agent can load a *second* slice mid-task if the work turns
   out to need it — which plain slicing cannot do without a full reload.

And it carries a genuine counter-risk: an agent that never loads the grammar,
guesses at syntax, and burns a repair loop pays **more** than one handed the
document up front. Lazy loading trades a certain small cost for an uncertain
larger one. That is the specific thing Feature 44's behavioural check exists to
measure.

### Portability is a constraint, not an afterthought

The site claims Satsuma works with Copilot, Cursor, Codex, Windsurf, and web
LLMs (`site/index.njk`, `site/cli.njk`). The agentskills.io format is well
supported in Claude tooling and Pi has its own lazy-skills mechanism, but a
**skill-only delivery would regress every other harness**. Hence:

- `--section`/`--profile` on the CLI works everywhere and is the primary
  mechanism.
- The composed **portable blob** covers the no-CLI web-LLM path that
  `useful-prompts/` serves today.
- The skill wrapper is a thin envelope over the same canonical sections —
  sugar for harnesses that support it, never the only route.

### The measurement, pulled forward from Feature 44

Feature 44's Phase 2 included a static token-counting baseline per delivery
mechanism. **That measurement moves here**, because it is the evidence for which
mechanism to pick, it needs no model spend, and it should inform this
restructure rather than post-date it. Feature 44 then inherits the tooling
instead of owning it.

Requirements: real tokenizers, not byte-count estimates (Anthropic
count-tokens endpoint, `tiktoken` `o200k_base`, published HF tokenizers for
open-weight models), reported **per tokenizer** and per section, with the
resident-vs-loaded distinction made explicit for each envelope.

**Done.** [`reference/token-costs.md`](../../../reference/token-costs.md),
generated by `npm run measure:agent-reference-tokens`
(`scripts/measure-agent-reference-tokens.mjs`), reports `o200k_base` counts
(via `js-tiktoken`) for the whole document, each section, each profile, and
each envelope's resident-vs-loaded cost — plus the Anthropic count-tokens
endpoint whenever `ANTHROPIC_API_KEY` is set. Headline numbers, replacing the
bytes/4 estimates the rest of this section originally carried:

| Figure | Old bytes/4 estimate | Measured (`o200k_base`) |
|---|---|---|
| Whole document | ~6,900 | **6,813** |
| `write` profile | ~3,600 | **3,743** |
| `read` profile | ~3,300 | **4,520** |
| Skill envelope, resident (frontmatter only) | ~50–100 | **164** |
| MCP comparison, resident (23 command schemas) | "a few hundred tokens" × 23, unmeasured | **2,253** total (~98/command) |

The two profiles turned out closer in cost than the original estimate
suggested — `read` needs the whole CLI command surface (`cli-index` +
`cli-composition`, 2,808 tokens together), which is larger than `write`'s
grammar (948). Both are still well under the 6,813-token whole document: 45%
and 34% cuts respectively, not the ~48%/52% the pre-measurement estimate
guessed. See `reference/token-costs.md` for the full per-section breakdown
that table sizes are drawn from, and its "Per section" table in particular
for how each of the 8 canonical sections contributes to those profile totals.

## Ordering constraint and the Goodhart risk

The hazard in doing this first is real: if the reference is tuned to win a
benchmark we also author, the eval measures our tuning rather than the language.
Three controls:

1. **The split is driven by task-need analysis, not eval scores.** The table
   above was derived from what each task shape needs, before any episode runs.
2. **This feature ships and is released before Feature 44's protocol is
   hashed.** Pre-registration then covers the final artifact, so the measurement
   cannot be reverse-engineered from results.
3. **No iteration against eval outcomes.** If a later eval suggests a different
   split, that is a new feature with its own pre-registration — not a quiet
   retune of this one.

## Risks

| Risk | Mitigation |
|---|---|
| **Agent never loads the slice it needs** and guesses instead, costing more via repair loops | The primary mechanism (`--profile`) is eager, not lazy — the agent is handed the right slice up front. Lazy loading is offered, measured by Feature 44, and not made the default until it is shown not to hurt |
| **A slice is missing something a task needs**, silently degrading output | Profiles are supersets, not minimal cuts: `read` and `write` both include the conventions a reader must know (`@ref`, path syntax, transform classification). `--list` shows what exists so an agent can pull more |
| **Envelope drift** — CLI output, portable blob and skill diverge | All three are composed from the same canonical sections at build time; a test asserts every section appears in at least one envelope and that no envelope contains hand-written content |
| **Back-compat break** for anyone piping `agent-reference` | Bare invocation is unchanged and covered by a test asserting its output equals the concatenation of all sections |
| **Section files rot relative to the CLI's real flags** | Defer the command list to `--help` where practical; add a test that flags named in `cli-index.md` exist in the CLI |

## Non-goals

- **No change to Satsuma syntax, grammar, or CLI behaviour** beyond additive
  flags on `agent-reference`.
- **No rewrite of the reference's content.** This is a restructure: the same
  guidance, reorganised and composed. Improving the prose is a separate concern
  and would confound Feature 44's before/after comparison.
- **No consolidation of `skills/` or `useful-prompts/` in this feature.** The
  canonical sections make that possible; actually rewiring seven files to compose
  from them is follow-on work with its own review surface.
- **No fine-tuning, embeddings, or retrieval.** Out of scope.
- **No MCP server.** Measured (not merely expected) as a comparison point,
  not built: eagerly-injected tool schemas for the CLI's 23 commands cost
  2,253 `o200k_base` tokens **resident on every request, for every session**
  — see `reference/token-costs.md`. That resident cost is paid whether or not
  Satsuma comes up at all, unlike every envelope this feature actually ships:
  the CLI's resident cost is 0 (it is pull-based), and the skill's is 164
  (frontmatter only, until it triggers). A session that never touches Satsuma
  pays 2,253 tokens under an MCP server registering these tools and ~0 under
  every mechanism Feature 45 ships.

## Acceptance criteria

- [x] Canonical section files exist under `reference/`, containing the same
      guidance as today's `AI-AGENT-REFERENCE.md` — no content rewritten.
- [x] `prebuild.js` bakes a **section map** rather than one string, and every
      envelope is composed from it with no hand-written content.
- [x] `satsuma agent-reference` with no flags produces byte-identical output to
      the current command, verified by a test comparing it against the
      concatenation of all sections.
- [x] `--section <name>`, `--profile write|read`, and `--list` implemented, with
      `--list` reporting measured token costs per section.
- [x] A test asserts every canonical section appears in at least one envelope
      (no orphaned sections) and that section names in `--list` resolve.
- [x] A test asserts every CLI flag named in the command-index section exists in
      the CLI, so the index cannot drift from reality.
- [x] **Measured** per-tokenizer token counts for: the whole document, each
      section, each profile, and each envelope's *resident* vs *loaded* cost —
      replacing every bytes/4 estimate in this PRD.
- [x] MCP tool-schema resident cost measured as a comparison point (schemas
      generated for the 23 commands and counted; no server built).
- [x] The `write` and `read` profiles are each demonstrably sufficient for their
      task shape — checked by review against the task-need table (both are
      supersets including the shared conventions), and asserted directly by
      `agent-reference.test.ts`'s `--profile write`/`--profile read` cases.
- [x] `SATSUMA-CLI.md`, `AI-AGENT-REFERENCE.md`'s own framing, `HOW-DO-I.md`, and
      `site/cli.njk`'s description of `agent-reference` updated to describe the
      new flags, with the back-compat guarantee stated.
- [x] Existing CLI tests pass; new flags covered; `scripts/run-repo-checks.sh`
      green.
- [x] Feature 44's PRD updated to reference the measured baselines produced here
      rather than owning that measurement itself.

## Open decisions for the project owner

1. **Where the canonical sections live.** A top-level `reference/` directory is
   proposed, which makes `AI-AGENT-REFERENCE.md` a *generated* artifact — clean,
   but it changes a file people link to directly and that GitHub renders. The
   alternative is keeping the monolith authored by hand and slicing it at build
   time by heading, which preserves the file but makes the section boundaries
   implicit and fragile.
2. **Whether the command index defers to `--help`.** Worth ~925 tokens and
   removes a drift surface, at the cost of an extra tool call for an agent that
   just wants to know what commands exist. `--list`-style summarisation is a
   middle path.
3. **Whether a `satsuma` language skill ships in this feature** or waits. The
   canonical sections make it a thin wrapper, but it adds an eighth entry to
   `skills/` and a second thing to keep in sync with the CLI's flags.
4. **Whether this warrants an ADR.** It changes the delivery contract for the
   reference — one canonical source composed into multiple envelopes, with an
   additive-only CLI surface. That reads as an architectural decision downstream
   consumers depend on. Recommend assessing with `/adr-draft` before the PR.
