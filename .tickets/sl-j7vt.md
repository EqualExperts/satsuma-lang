---
id: sl-j7vt
status: closed
deps: []
links: []
created: 2026-09-29T06:21:56Z
type: task
priority: 2
assignee: Thorben Louw
---
# docs+site: rewrite copy around readability, not token efficiency or AI results

The website and the main repo docs lean hard on two claims: that `.stm` is leaner than YAML/JSON (so
it saves LLM tokens), and that the CLI makes AI agents produce much better
results. Neither is where Satsuma's value lies, and the second is not something
we have measured. Rewrite the copy so the site and docs say what Satsuma is: a clear,
well-shaped, easy-to-read language for data mappings, which people and AI tools
can both read and write.

**Tone.** Do not argue against the old claims, explain why they are gone, or say
the CLI does not help agents. Simply stop making a feature of them. AI tools
stay in the story as one of the readers and writers of Satsuma, alongside
people, not as the headline.

**Style.** Plain, simple, technical UK English (`organisation`, `modelling`,
`visualise`). Short sentences. No hype words (`superpower`, `dramatic`,
`high-fidelity`, `AI-native`, `supercharge`), no "not X, but Y" flourishes, no
unmeasured superlatives (`100% deterministically correct`, `fewer
hallucinations`). Where the old copy asserted importance, state the concrete
fact instead.

## Changes by page

Line numbers are for `main` at c11de8c4 and will drift; search by the quoted text.

### `site/index.njk` (home) — most of the work

1. **Front matter** — `description` drops "AI-native". Suggested: "A readable
   language for source-to-target data mappings, for the people who own the data
   and the tools that build from it."
2. **Hero sub-line** — drop "and AI-native by design". Keep the H1 ("humans can
   read, machines can parse, and AIs can reason about"); it already puts people
   first and treats AI as one reader among three. (Same line is the footer
   tagline in `_includes/footer.njk` — leave both, or change both.)
3. **The Problem** — remove "and AI can't help because there's no parseable
   format" from the paragraph. Replace the third bullet ("AI can't reason well
   about human-optimised spreadsheets…") with a human problem, e.g. business
   rules hidden in cell comments and colour coding.
4. **The Solution** — keep "concise, beautiful, parseable" and the DBML
   comparison. Replace the third bullet ("LLMs generate valid Satsuma… high-
   fidelity pipeline implementations…") with one plain line that people and AI
   tools can both read and write it.
5. **"The superpower" section** — rename the eyebrow (e.g. "Extensible
   metadata"). The heading's "Your tokens" now reads as LLM tokens; use "Your
   vocabulary" or similar. Rewrite the `LLM-Guidelines.md` paragraph so the point
   is that a team defines its conventions once and every reader — person,
   generator or AI assistant — interprets them the same way; drop "every AI
   tool in your org… generates the right code".
6. **"Why teams choose Satsuma" cards**
   - *Machine-Parseable*: drop "100% deterministically correct results"; say
     every tool works from the same parse tree.
   - *AI-Native*: retitle (e.g. "Works with AI tools") and describe it plainly:
     the structure is regular enough for AI assistants to read and write, and
     `satsuma validate` checks what they produce.
   - *Measurably Leaner*: **remove**. Replace with a readability card, e.g.
     "Reads like a document" — arrows, plain-English notes, metadata in
     brackets.
7. **Built for your role**
   - *Data & ML Engineers*: remove "AI tools achieve much better implementation
     adherence to specs compared to loose spreadsheets." Lead with the mapping
     contract; mention AI tools once, neutrally.
   - *AI & Automation*: keep, but plain ("A regular, validated format for AI
     tools to read and write.") — drop "reliably" and "safe automation".
8. **No installation required** — remove the "Token-efficient specs" bullet.
   Replace with a readability point (a `.stm` file makes sense in any text
   editor or on GitHub, with no tooling). Keep the other three bullets and the
   four workflow cards.
9. **FAQ**
   - Move "Can non-technical people read Satsuma?" to the top; it is the
     primary design goal.
   - Merge "How does Satsuma work with AI coding agents?" and "Can AI agents
     generate entire pipeline implementations…?" into one short answer: agents
     can read and write `.stm`, the Agent Skills exist, and the split between
     structured arrows and natural-language rules shows which parts need human
     judgement. Drop "high-fidelity", "the generated code is better" and
     "dramatic improvement".
   - "Why not just use YAML, JSON, or a spreadsheet?" — remove the size
     paragraph entirely. Answer on readability and structure: a fixed shape
     every reader can rely on, validation and linting, clean diffs, no meaning
     hidden in cell colour. Drop "at any price".
   - "What tech stacks can I target…?" — remove "gives the agent exactly the
     context it needs".

### `site/cli.njk` — reframe from "the agent's toolkit" to a tool for everyone

1. **Front matter** — title/description/og: drop "Agent Tooling" and "gives AI
   agents many deterministic… commands". Suggested title: "Satsuma CLI —
   Validate, Format and Query Your Mappings".
2. **Hero** — rewrite. Remove "exists mainly so an AI agent doesn't have to load
   a whole workspace into its context window", "spends its tokens reasoning,
   not re-parsing" and "most of the commands exist for the agent, not for you".
   Describe what it does: validate, format and lint mappings; trace lineage;
   answer structural questions (a field's lineage, every PII tag, unmapped
   fields) as text or JSON — for people, CI and AI assistants alike. Primary
   button "Set up your agent" → "Install".
3. **Section order** — move "Your day-to-day commands" (validate / fmt / lint)
   above the agent sections, so the page opens with what a person runs.
4. **"Teach your agent Satsuma in 30 seconds"** — keep the section, calm the
   heading (e.g. "Using the CLI with an AI assistant").
5. **"How agents use the CLI"** — retitle (e.g. "Querying a workspace"). Remove
   "token-efficient structural queries instead of dumping entire files into
   context". The four workflow panels and example workflows can stay; phrase
   them as things anyone can do, with an agent as one caller.
6. **Closing CTA** — replace "Ready to give your agent superpowers?" and "your
   agent can query your data mappings in seconds" with a plain install prompt.

### `site/learn.njk`

- *AI & Automation* path — remove "The constrained grammar means fewer
  hallucinations and reliable round-tripping." Keep the validate-in-the-loop
  workflow as a plain description. "Build reliable AI workflows…" → something
  like "Use AI tools to draft and review mappings, and check the result with the
  parser."
- Intro line "Whether you review mappings, build pipelines, or automate with
  AI…" is fine.

### `site/examples.njk`

- Kimball card — "the free-form … convention that tells an LLM which fields to
  version on change" → "that says which fields to version on change";
  "LLM interpretation rules" → "interpretation rules".

### No change expected

`site/vscode.njk`, `site/diaries.njk`, `site/_includes/nav.njk`. Re-read them in
the same pass to confirm.

## Repo docs

Same brief, lighter touch: these documents have other jobs (reference, tutorial,
product history), so change the claims, not the documents' structure or subject.
The data-engineer tutorial and the lessons are about working *with* AI agents;
they keep that subject and lose only the overclaims.

1. **`README.md`**
   - Opening list: "compact enough for AI agents to generate and consume
     reliably" → "regular enough for people and AI tools to read and write".
   - "Why Satsuma Exists": "YAML and JSON are parseable but too noisy for large
     mapping inventories" → keep the point about noise, drop the size angle
     ("hard to read at a glance"). Remove the paragraph "Agents can produce
     better code, better reviews, and better impact analysis…".
   - "the reliable substrate that lets the agent reason safely" → plainer.
   - Heading "Extensible Metadata: Satsuma's Superpower" → "Extensible
     metadata". "every AI agent in your organisation knows how to act on them"
     → people and tools read them the same way.
2. **`SATSUMA-CLI.md`** — Design Principle section: drop "100% deterministically
   correct results" (say results come from the parse tree alone, with no
   interpretation of natural language). Remove the "make workspace navigation
   token-efficient… context window" paragraph; say what the CLI does for people,
   CI and agents.
3. **`docs/using-satsuma-without-cli.md`** — remove the "Token efficiency" bullet
   (lines ~38–44) from "What you keep without the CLI"; replace with a
   readability point. Line ~72 ("fits in any model's context window", about the
   agent reference) is a practical fact about pasting it into a web LLM — keep.
4. **`docs/tutorials/data-engineer-tutorial.md`**
   - Opening (lines ~7–9): keep the spreadsheet problem, remove "The AI saved you
     no time at all" and "generate correct scaffolding on the first pass".
     "precise context it needs to generate correct DDL…" (line ~15) → plainer.
   - Line ~44: "This is Satsuma's superpower" → drop the phrase, and soften "an
     AI agent that has read your guidelines will know exactly what to
     generate".
   - Line ~368: remove the "Token efficiency" paragraph.
5. **`docs/tutorials/integration-engineer-tutorial.md`** line ~375 — "AI
   readability" paragraph: remove "dramatically more context" and "better-
   quality generated code with fewer hallucinations". The section says "Four
   reasons"; keep the count right.
6. **`docs/product-owner/PROJECT-OVERVIEW.md`**
   - "AI-native mapping spec" (line ~53) → describe the same idea plainly.
   - Design goal 5 "It should be leaner than equivalent YAML. Token efficiency
     matters for AI consumption…" → recast as a readability goal ("less
     ceremony than YAML; faster to scan"). Keep the italic measurement note —
     it is the record of why the old 40–60% figure went.
7. **`docs/product-owner/COMPETITOR_ANALYSIS.md`** line ~53 — "AI-friendly
   (compact enough for LLM context windows)" → "Readable and writable by AI
   tools as well as people".
8. **`branding/README.md`** line ~105 — the voice guide *recommends* "AI-native".
   Replace with the new framing (e.g. "Works for people and AI tools") so future
   copy doesn't reintroduce it. Check the rest of the guide agrees with this
   ticket.
9. **`lessons/08-satsuma-cli.md`** — retitle from "The Satsuma CLI as the Agent's
   Toolkit"; "The CLI Is Primarily for the Agent" and "Loading entire Satsuma
   files into an agent's context window is wasteful…" → present the CLI as
   answering precise structural questions, for whoever asks. Keep the
   `--compact` descriptions; they describe a real flag.
10. **`docs/developer/SATSUMA-V2-SPEC.md`** line ~17 — principle 4
    "Token-efficient. Eliminate ceremony." → "Concise. Eliminate ceremony."
    Wording only, no change to the language; call it out in the PR since it
    touches the authoritative spec.

Before closing, re-run the search below across the whole repo (outside the
excluded paths) in case anything was missed:
`grep -rniE "token-eff|token efficien|leaner than|context window|superpower|AI-native|9% smaller|dramatically|fewer hallucinations|high-fidelity|100% determin"`

## Out of scope

Leave these alone; they are records, not claims:

- `adrs/` (ADR bodies are immutable), `archive/`, `CHANGELOG.md`,
  `satsuma-diaries/`, `.tickets/`
- `features/44-token-and-task-eval/` — the research that measures token use; it
  is meant to discuss it
- `reference/static-compactness.md` — the measurement itself
- `docs/product-owner/ROADMAP.md` (lines ~30–42) — records that the published
  claim was measured and corrected
- `lessons/01-what-is-satsuma.md` line ~182 and other plain statements that the
  agent reference fits in a prompt or that `--compact` shortens output
- Skills and `useful-prompts/` — instructions to agents, not claims to readers
- The playground (`site/playground/`, built from `tooling/satsuma-viz-harness`),
  which has no marketing copy

## Acceptance Criteria

- No page under `site/` claims `.stm` is smaller or more token-efficient than
  YAML/JSON, mentions context windows or token budgets, or cites the 9%/36%
  figures: `grep -rniE "token-eff|leaner|context window|spends its tokens|9%|36%" site/*.njk site/_includes` returns nothing
- No hype words remain in site copy: `grep -rniE "superpower|AI-native|dramatic|high-fidelity|hallucinat|100% determin" site/*.njk site/_includes` returns nothing
- The CLI page opens with what a person uses it for (validate, format, lint, query) and presents agents as one kind of user; its title and meta description no longer describe it as agent tooling
- Home page leads with readability: hero sub-line, Solution bullets, "Why teams choose" cards and first FAQ entry each make the readability case, and AI tools appear only as one reader/writer among others
- Metadata tokens (`pii`, `scd 2` …) are never called just "tokens" where a reader could take it to mean LLM tokens
- Copy is UK English throughout, and every changed sentence has been re-read aloud for plainness
- Site builds (`npm --prefix site run build`) and each changed page has been viewed locally at desktop and phone width, with no broken layout from removed or added cards
- Every item under "Repo docs" is done, and the whole-repo search above returns
  only hits in the excluded paths (or ones justified in the PR description)
- The spec wording change is called out in the PR; no grammar, parser or
  example changes
- Markdown lint passes for the changed docs (pre-commit hook)

## Notes

**2026-09-29T06:32:41Z**

Cause: Site and repo docs presented token savings (the 9%/36% size figures, "context window") and unmeasured AI-quality claims as headline benefits, and the CLI page framed the CLI as mainly an agent tool.
Fix: Rewrote the copy in site/index, cli, learn and examples and in the ten listed repo docs to lead with readability, with AI tools as one kind of reader; reordered the CLI page so everyday commands come first and merged the two AI FAQ entries; the branding guide now lists the dropped phrases under "Avoid". Spec change is wording only ("Token-efficient" → "Concise"). Could not screenshot pages locally: headless Chromium and Firefox both crash in the agent session, so layout needs a visual check in review. (commit immediately after 5c2300b1)
