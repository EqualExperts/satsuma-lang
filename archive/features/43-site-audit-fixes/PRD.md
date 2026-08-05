# Feature 43 — Marketing Site Audit Fixes

> **Status: IMPLEMENTED** (2026-08-05) — all 11 `saf-*` tickets closed (epic
> `saf-dmvx`), PR #485. Found during a full-site audit of
> `site/` (the Eleventy-built marketing/docs site deployed at
> `equalexperts.github.io/satsuma-lang`) requested by the project owner: an
> exhaustive search for incorrect claims, invalid example syntax, dead links,
> numeric drift, and content that should be removed, de-emphasized, or added.
>
> **State this PRD was checked against:** `main` at `db65476d`.
>
> **Method.** A 15-agent audit cross-checked every claim on `site/index.njk`,
> `site/learn.njk`, `site/cli.njk`, `site/examples.njk`, and `site/vscode.njk`
> against: the tree-sitter grammar (`tooling/tree-sitter-satsuma/grammar.js`),
> the language spec (`docs/developer/SATSUMA-V2-SPEC.md`), the real files
> under `examples/` that the site's illustrative snippets claim to summarize,
> the real source of `tooling/vscode-satsuma` and `tooling/satsuma-lsp`, and
> the repo-root `test-stats.json`. Several findings were confirmed by writing
> minimal `.stm` repros and parsing them with the tree-sitter CLI.
>
> **What this feature is not.** It changes no Satsuma syntax, no grammar, and
> no CLI/LSP/VS Code behavior. Every fix here is either a text/data correction
> on the static site, or (for the fabricated example snippets) bringing the
> site's illustrative code back in line with the real fixture files it claims
> to summarize.

## Goal

Make every factual claim on the marketing site true, make every illustrative
code snippet either an accurate excerpt of the real file it names or clearly
labelled as illustrative-only, and remove or fix content that actively
misleads a technical evaluator (self-contradicting claims, a removed feature
still documented as current, a dead link).

## Background — audit findings

### A. Fabricated or incorrect example snippets (`site/examples.njk`)

Several "View snippet" code blocks do not match the real `examples/*.stm`
file they claim to summarize — beyond the acceptable truncation every card
already does for length. These read as bugs, not simplifications, because
they show syntax or values that are not just shortened but *wrong*:

| Card | File | Problem |
|---|---|---|
| Legacy Customer Migration | `examples/db-to-db/pipeline.stm:106-108` | Snippet shows `uuid_v5("6ba7b810-...", CUST_ID)` as a structural function call. The real file uses an NL string instead: `"Generate UUID v5 using namespace 6ba7b810-9dad-11d1-80b4-00c04fd430c8 and CUST_ID as name"`. |
| Salesforce to Snowflake | `examples/sfdc-to-snowflake/pipeline.stm:74` | Snippet shows an in-prose backtick reference: `` "Multiply by rate from `fx_spot_rates` using CurrencyIsoCode" ``. The real file uses an `@ref`: `"Multiply by rate from @fx_spot_rates lookup using CurrencyIsoCode"`. Per `SATSUMA-V2-SPEC.md:55` and ADR-036, `@ref` is the documented mechanism for in-string cross-references; a backtick-quoted name inside an `nl_string` is inert prose to the parser, not a real reference. |
| EDI to JSON | `examples/edi-to-json/pipeline.stm:50-59` | Snippet shows `LineItems list_of record { ITEMQTY NUMBER(15) //! 4 implied decimal places }`. No `ITEMQTY` field exists anywhere in the file. The real `LineItems` record has `LINENUM`/`ITEMNO`/`ITEMTYPE`; the `NUMBER(15)` field with the decimal-places warning is `QUANTITY`, inside an entirely separate `Quantities` block. Two schema blocks were merged and a field renamed. |
| SAP PO to MFCS | `examples/sap-po-to-mfcs/pipeline.stm:54-59` | Multiple fabrications in the `Items` block: adds a `pk` constraint to `EBELP` that the real schema doesn't have; drops `required` from `MATNR` (changes semantics from mandatory to optional) and rewrites its note; and uses `DECIMAL(13,3)`/`DECIMAL(11,2)` for `MENGE`/`NETPR` where the real file uses `NUMBER(13,3)`/`NUMBER(13,4)` — `DECIMAL` never appears anywhere in this example (it looks like content copied from the unrelated `xml-to-parquet` example). |
| Merge Strategies | `examples/merge-strategies/pipeline.stm` | Snippet shows `now_utc()` with parentheses at both call sites; the real file uses the bare word `now_utc` (no parens) everywhere it appears. |
| Governance Metadata | `examples/filter-flatten-governance/governance.stm` | Snippet packs two metadata entries per continuation line when a field's metadata wraps. Neither the real file nor the formatter's own multi-line output (`tooling/satsuma-core/src/format.ts:1334-1358`, one entry per line) does this. The snippet also drops a real `note` entry on the `email` field. |
| Multi-Source Hub | `examples/multi-source/multi-source-hub.stm:68-76` | Snippet drops one of the mapping's two real sources (`crm_system`) and rewrites `@ref`-based NL text into ref-free prose, making a two-source join look single-source. |

### B. Self-contradictions within a single page

1. **`site/cli.njk`** lists a real `coverage` command in the "Structural
   Primitives" section (with its own `--fail-under` CI-gating behavior
   described) — then the "Design Boundaries" section on the *same page*
   states: "There are no `impact`, `coverage`, or `audit` commands." The
   `impact`/`audit` half of that claim is accurate; the `coverage` clause is
   false and contradicts the page's own command reference above it.
2. **`site/vscode.njk`** asserts "8 commands" twice (stats-bar tile and the
   "8 commands at your fingertips" section heading), but only 7 command
   cards are rendered in that section (missing: `clearCoverage`, which is a
   real 8th registered command with no card of its own).
3. **`site/examples.njk`** front-matter (`description`/`og_description`)
   says "16 canonical examples" across 5 named categories; the page's own
   rendered hero says "20 canonical examples" / "20 examples" / "6
   categories." The rendered body is correct (20 example-item cards, 6
   distinct categories) — the SEO meta text is stale from an earlier gallery
   size.
4. **`site/learn.njk`** (Data & ML Engineers pathway) claims "The examples
   gallery includes real-world patterns: multi-source joins, SCD Type 2,
   Kimball star schemas, and more," linking to `examples.html`. Neither
   "SCD Type 2" nor "Kimball star schema" appears anywhere in
   `site/examples.njk` (confirmed by grep) — only the multi-source-joins
   part of that sentence is true. A reader following this link to find those
   two named patterns will not find them.

### C. Stale/removed-feature documentation

**`site/cli.njk`**'s "Transform classification" table (the `#classification`
section) documents five classifications: `structural`, `nl`, `mixed`, `none`,
`nl-derived`. `tooling/satsuma-core/src/classify.ts` explicitly documents that
`structural` and `mixed` "existed before Feature 28" and have been removed;
`tooling/satsuma-core/src/types.ts:50` defines `Classification` as only
`"nl" | "none" | "nl-derived"` — three values, not five. The site is
describing a design that shipped and was later replaced, not the current
behavior.

### D. Broken / dead link

`site/learn.njk` (the "Tutorials" documentation-hub card) links to
`https://github.com/EqualExperts/satsuma-lang/blob/main/PROJECT-OVERVIEW.md`.
That file does not exist at the repo root — it lives at
`docs/product-owner/PROJECT-OVERVIEW.md`. The link 404s on GitHub.

### E. Numeric drift — `site/_data/stats.json` vs. `test-stats.json`

The repo-root `test-stats.json` is the authoritative source per `AGENTS.md`.
`site/_data/stats.json` has drifted from it (`cliCommands`, `parserCorpusTests`,
`satsuma-lsp`, and `vscode-satsuma` are still correct):

| Field | site/_data/stats.json | test-stats.json (authoritative) |
|---|---|---|
| `packages.satsuma-core` | 689 | 697 |
| `packages.satsuma-cli` | 1049 | 1061 |
| `packages.satsuma-viz-model` | 6 | 7 |
| `packages.satsuma-viz-backend` | 186 | 190 |
| `packages.satsuma-viz` | 137 | 145 |
| `packages.integration-tests` | *(absent)* | 3 |

There is no script that regenerates `site/_data/stats.json` from
`test-stats.json` automatically, which is why they drift every time
package test counts change without someone remembering to update the site's
copy by hand.

### F. VS Code "3 Webview Panels" claim is right by accident

`tooling/vscode-satsuma/src/webview/` has **four** panel implementations
(`viz`, `field-lineage`, `lineage`, `schema-lineage`), not three. Of these,
`webview/lineage/panel.ts` (`LineagePanel`, viewType `satsumaLineage`) is dead
code — never imported by `extension.ts` or any command handler. The site's
"Interactive Visualization" section (`site/vscode.njk` lines ~270-359)
presents exactly three webviews as its headline "3 Webview Panels": Workspace
Graph, Field-Level Lineage, and **Mapping Coverage**. But Mapping Coverage is
implemented with `TextEditorDecorationType` + a status-bar item
(`tooling/vscode-satsuma/src/commands/coverage.ts`) — it contains zero
`createWebviewPanel` calls, and the CLI/VS Code page's own Commands section
two subsections earlier correctly calls it "gutter markers and status bar,"
never a webview. Meanwhile the real third live webview — `SchemaLineagePanel`
(`webview/schema-lineage/panel.ts`), opened by the "Show Lineage From..."
command (`satsuma.showLineage`) — is never mentioned in that section at all.
Net effect: the showcase lists a non-webview feature as one of its three
webviews and omits a real one.

### G. Documentation-authority conflict (flagged per `AGENTS.md`'s own rule)

`docs/developer/SATSUMA-V2-SPEC.md` — the file `AGENTS.md` designates as the
*primary* authority for syntax questions — still describes the `namespace`
block as a **future, unbuilt** feature ("**Future**: The `namespace` block
... will scope definitions..."), even though `archive/features/15-namespaces/PRD.md`
records it as `Status: COMPLETED (2026-03-20)` with full grammar support, and
three site example cards (Namespace Basics, Namespace Merging, Enterprise
Platform) showcase it working today. `AGENTS.md`'s own "Source of Truth"
section says to "call out the mismatch explicitly" when docs conflict — this
PRD is that callout. Fixing the spec itself is out of scope for this feature
(it's a developer-doc gap, not a site-content bug) but is recorded here so a
ticket can be raised against `docs/developer/SATSUMA-V2-SPEC.md` separately.

## Non-goals for this feature

The audit also surfaced softer editorial judgment calls that are **not**
being turned into fix tickets here, only recorded for a maintainer decision:

- **Unsubstantiated marketing numbers** ("40-60% smaller," "3-8x less token
  usage," ">90% LLM-generates-valid-Satsuma" — the last one is lifted from
  `docs/product-owner/PROJECT-OVERVIEW.md`'s *future target* success metrics,
  not a measured result) repeated multiple times across `site/index.njk`.
- **The "Diaries" top-level nav item** (a whimsical in-joke changelog
  written by a fictional AI intern) sitting alongside Home/CLI/VS Code/
  Examples/Learn, which may undercut credibility with the enterprise/data
  engineering audience the rest of the site targets.
- **Redundant pitch repetition** of the same 2-3 value props across the
  homepage feature cards, homepage role cards, and nearly all of
  `learn.njk`'s role sections.
- **Missing content opportunities**: `satsuma-lsp` as a standalone
  editor-agnostic server is never mentioned (only framed as a VS Code
  dependency); the footer's "MIT License" text isn't a link to `LICENSE`;
  no dedicated tool-comparison page (PROJECT-OVERVIEW.md already has a
  considered comparison table); no public roadmap page derived from
  `docs/product-owner/ROADMAP.md`; `satsuma-viz-model`/`satsuma-viz-backend`
  (the shared engine behind both the VS Code webviews and the browser
  playground) are never explained to a visitor; `satsuma.config.yaml`
  (lint suppression, type aliases, strict mode) is undocumented on the CLI
  page despite being real and documented in `SATSUMA-CLI.md`.

These are intentionally left for the project owner to triage into a future
feature rather than bundled into this correctness-focused pass.

## Acceptance criteria

- [ ] Every example snippet identified in Finding A renders syntax and
      values that are a verbatim (whitespace/truncation aside) subset of its
      real named source file — no invented functions, fields, types, or
      constraints.
- [ ] The `coverage` self-contradiction on `site/cli.njk` is resolved (the
      Design Boundaries text no longer claims no `coverage` command exists).
- [ ] `site/vscode.njk`'s "8 commands" claim and its rendered command-card
      count agree (either add the missing card or correct the stated count).
- [ ] `site/examples.njk`'s front-matter `description`/`og_description`
      state the same example/category counts as the rendered hero.
- [ ] `site/learn.njk` no longer promises example patterns (SCD Type 2,
      Kimball star schema) that are not present in the examples gallery.
- [ ] `site/cli.njk`'s Transform Classification table shows only the three
      classifications the code actually emits (`nl`, `none`, `nl-derived`).
- [ ] The dead `PROJECT-OVERVIEW.md` link in `site/learn.njk` points to its
      real path.
- [ ] `site/_data/stats.json` matches `test-stats.json` exactly, including
      the previously-missing `integration-tests` entry.
- [ ] `site/vscode.njk`'s "Interactive Visualization" section accurately
      describes the three live, command-reachable webviews (Workspace
      Graph, Field-Level Lineage, Schema Lineage) and no longer presents
      Mapping Coverage as a webview panel; OR the stats-bar "3 Webview
      Panels" / section framing is otherwise reconciled with reality.
- [ ] The site builds and renders correctly after all changes (spot-check
      with the Eleventy dev server).
