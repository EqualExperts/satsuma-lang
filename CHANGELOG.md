# Changelog

## v0.8.0 — 2026-06-04

Mostly an additive release: five new agent skills, a viz UX improvement for
compact mapping cards, a fix to natural-language `@ref` parsing, broader
test coverage across the toolchain, and the project's move under Equal
Experts stewardship. No language or grammar changes.

### Project ownership and brand alignment (Feature 31)

- **Repository migrated to the `EqualExperts` GitHub organisation.** All
  references to `github.com/thorbenlouw/satsuma-lang` in the README, security
  report, citation file, VS Code extension manifest, and the published site
  now point at `github.com/EqualExperts/satsuma-lang`. GitHub redirects keep
  the old URLs working for now, but downstream tooling that captured the old
  URL string should be updated.
- **OpenLineage `_producer` URL changes (downstream-visible).** The
  `satsuma-to-openlineage` skill emits the producer URL into every event it
  generates. The documented producer URL changes from
  `https://github.com/thorbenlouw/satsuma-lang` to
  `https://github.com/EqualExperts/satsuma-lang`. The producer URL is treated
  as movable rather than as a long-lived stable identifier — downstream
  lineage consumers that key on the producer-URL string will see the new
  value once they regenerate events with this version of the skill. If you
  need a stable correlation across the change, key on dataset namespace +
  name (which are unaffected) and treat the producer URL as informational.
- **Equal Experts named as the maintainer.** The README now leads with
  stacked Satsuma + Equal Experts branding and closes with a "Maintained by
  Equal Experts" section. `CITATION.cff` adds Equal Experts as an entity
  author alongside the original creator.
- **EE brand assets live under `assets/ee-brand/`** with a short README
  describing each file. The published site footer carries the tagline "An
  Equal Experts open-source project" and the top navigation gains an EE
  brand-mark link pointing at `https://www.equalexperts.com/`.

### Agent Skills

- **Five new skills shipped under `skills/`**, all following the
  [agentskills.io](https://agentskills.io) standard and runnable from any
  agent runtime that supports skills (Claude Code, Claude Desktop, etc.):
  - **`satsuma-explainer`** — plain-English walkthroughs of `.stm` files
    plus risk assessments, PII audits, coverage checks, and impact analysis
    for non-technical stakeholders.
  - **`satsuma-from-dbt`** — reverse-engineer Satsuma mapping specs from an
    existing dbt project so teams can adopt Satsuma without starting over.
  - **`satsuma-to-dbt`** — scaffold an idiomatic dbt project (staging /
    marts, Kimball stars, Data Vault 2.0, exposures) from `.stm` specs.
  - **`satsuma-sample-data`** — generate realistic CSV/JSON fixtures from a
    schema, respecting types, enums, PII patterns, and referential
    integrity across tables.
  - **`satsuma-to-openlineage`** — emit OpenLineage 2-0-2 RunEvents with
    column-level lineage for Marquez, DataHub, Atlan, and OpenMetadata.
- **Skills now assume a globally-installed `satsuma` CLI** rather than
  invoking via `npx`. Install the CLI tarball once with `npm install -g`
  and all skills resolve it from PATH.
- **Copilot + Excel reverse-engineering tutorial** added under
  `docs/tutorials/` walking through using GitHub Copilot to convert legacy
  Excel mapping spreadsheets into Satsuma.

### VS Code Visualization

- **Compact overview cards expand on click.** In overview mode, compact
  schema cards now expand inline to reveal their fields without leaving the
  workspace view. The canvas grows to accommodate the expanded card so it
  is never clipped.
- **Renderer test hooks** added to the viz component for mapping-detail and
  field-coverage modes, enabling deterministic browser-based test coverage
  through the new viz harness (Feature 30).

### CLI / LSP / Core

- **Unified validation pipeline.** Core, CLI, and LSP now share a single
  semantic-validation interface, eliminating drift between the three
  consumers' diagnostics.
- **`loadWorkspace` API** introduced and adopted across CLI commands; the
  earlier `WorkspaceIndex` type was renamed to `ExtractedWorkspace` for
  consistency. Internal-only — no CLI surface change.
- **`process.exit` centralised** in a single command runner so individual
  command modules no longer call it directly.
- **CLI duplicated consumer utilities consolidated** with their core
  counterparts (`satsuma-core` is now the canonical home for shared NL-ref,
  classification, metadata-extraction, and CST text helpers).

### Bug fixes

- **`@ref` regex anchoring + multiline position helper** — `@ref` tokens
  inside multi-line natural-language strings are now resolved at the
  correct source position. Previously, refs after a line break could be
  attributed to the wrong line, producing misleading lineage. Reported and
  fixed in `sl-dkr6`.
- **`metrics-platform` example validates with zero warnings** (`sl-wzpe`)
  and namespaces example regression fixed.
- **CLI `arrows` command** no longer destructures an unused `parsedFiles`
  value.
- **Site release-asset download URLs** corrected on the cli / vscode /
  learn pages.
- **VS Code extension build adapted for `vscode-languageclient` v10** —
  resolves a peer-dependency mismatch in the extension build.

### Schema format conventions

- **Apache Avro** added to the schema-format convention guides under
  `docs/conventions-for-schema-formats/avro/`, with mappings between Avro
  records, fields, logical types, unions, and Satsuma schemas.

### Test coverage and tooling

- **Viz harness (Feature 30) test suite expanded** from baseline coverage
  to comprehensive: canonical mapping-detail content, field-coverage and
  hover highlighting, toolbar namespace + file filter behaviour, geometry
  sanity helpers, overview edge anchoring across all fixture families, and
  a real arrow-row click test. A screenshot review workflow is also
  available for human-in-the-loop visual verification.
- **Grammar recovery corpus expanded** with additional malformed-input
  cases.
- **LSP / CLI custom-request, completion, and recovery test coverage
  grown** (`sl-63ix`).
- **Per-module coverage gates** raised across `satsuma-core`, `satsuma-viz`,
  `satsuma-viz-model`, `satsuma-viz-backend`, `satsuma-lsp`, and
  `satsuma-cli`. CI matrices the coverage jobs so per-module results are
  reported separately.

### Documentation

- **Tooling architecture documentation consolidated** under
  `docs/developer/ARCHITECTURE.md`, with a refreshed contributor guide.
- **Tutorials refreshed**: the BA, data-engineer, and integration-engineer
  tutorials now drop DMD acronym usage in favour of generic terminology,
  defer common-syntax pitfalls to `satsuma agent-reference`, and include a
  concrete prompt for the customise-workspace step.
- **Viz harness `README`** added covering the sentinel watcher, fixtures,
  and screenshot workflow (`sl-gfo4`).

### Dependencies

- TypeScript 5.9 → 6.0; typescript-eslint 8.58 → 8.60; ESLint 10.1 → 10.4.
- `vscode-languageclient` 9 → 10; `@types/vscode` refreshed for the new
  runtime; dev type versions aligned to runtime targets.
- `commander`, `tsx`, `tree-sitter-cli`, `liquidjs`, `markdownlint-cli2`,
  and several GitHub Action versions bumped via Dependabot.

### CI

- **gitleaks secret-scanning step now gates on the `GITLEAKS_LICENSE`
  secret being present** — the step skips itself for org-owned repos that
  do not yet have an org-tier licence, and re-enables automatically when
  the secret is set. Tracked as `tk 3eb-4vjj`.

## v0.7.0 — 2026-04-02

### Language Simplification (Feature 28)

- **All pipe steps are now NL.** The grammar no longer distinguishes structural
  vs NL pipe steps — every step in a pipe chain is natural language. The
  `structural` and `mixed` transform classifications are removed from the grammar,
  core, CLI, LSP, viz-model, and viz component.
- **`metric` keyword replaced with `schema(metric)` metadata.** Metrics are now
  regular schemas with a `metric` metadata tag, making them valid both as sources
  and targets. The dedicated `metric` keyword and its grammar rules are removed.
- Pipeline tokens (`to_decimal`, `count`, `equals`, etc.) are reframed as
  vocabulary conventions, not grammar-level constructs.
- All canonical examples updated to the simplified syntax.

### Standalone Viz Harness (Feature 29)

- **New `@satsuma/viz-backend` package** extracts VizModel production logic from
  the LSP into a shared package consumable by both the LSP and the harness.
- **New `satsuma-viz-harness`** provides a fixture-driven browser app that renders
  source code alongside the `<satsuma-viz>` web component. Includes syntax
  highlighting, fixture picker, and lineage/single mode toggle.
- **8 Playwright browser tests** covering overview rendering, detail view, hover
  events, cross-file lineage, navigation intents, and layout stability.
- LSP refactored to delegate viz model assembly to the shared backend.

### VS Code Visualization

- **@ref highlighting** in mapping detail and edge layer — `@ref` tokens in NL
  transform text now render bold in a darker green for visual emphasis.
- Full transitive lineage display with file-scope filter dropdown.
- Field notes, arrow notes, and left-aligned transforms in the mapping detail.
- Schema card labels capped at 400px width; minimap anchored to visible viewport.
- Removed `ClassificationFilter` and structural CSS from field-lineage panel.
- Removed pipeline/mixed rendering branches and orange edge colour.

### LSP

- **Symbol-level import reachability** — diagnostics now enforce that referenced
  symbols are actually imported, not just file-level reachability.
- **Core semantic diagnostics** via a new `SemanticIndex` adapter.
- Migrated field extraction, spread resolution, classification, metadata
  extraction, and CST text helpers from LSP into `@satsuma/core`.

### CLI

- **File-based entry points (ADR-022)** — the CLI now requires `.stm` file
  arguments and rejects directory arguments. Import reachability determines the
  workspace scope.
- Fixed 3 lineage/graph JSON output bugs, 4 nl/arrows bugs, 6 validate/lint
  bugs, and 4 diff/dispatch bugs.
- Refactored `graph.ts` into `graph-builder.ts` and `graph-format.ts`.
- Migrated all test files from JavaScript to TypeScript.
- Added test coverage measurement with c8 and coverage summary in CI.
- Standardized JSON output format across 7 CLI commands.

### Core

- Added source positions to `FieldDecl` and `startColumn` to `Extracted*` types.
- Added escape handling to `stringText()`.
- Consolidated extraction tests and fixed `sourceRefNameNs` regression.

### Grammar

- Simplified `pipe_text` — all steps are NL.
- Restored parenthesized NL tokens in `pipe_text`.
- Rejected empty backtick identifiers as parse errors.
- Replaced `metric` keyword with `schema(metric)` metadata decoration.

### Infrastructure

- Extracted `satsuma-lsp` package from `vscode-satsuma/server` (ADR-021).
- Core extraction consolidation (ADR-020) completed.
- Added `satsuma-viz-harness` to root `install:all`, `ci:all`, and `clean:all`.
- Added `build-artifacts.sh` for unified release artifact builds.
- CI dependency bumps: actions/checkout v6, actions/setup-node v6,
  actions/upload-artifact v7, dorny/test-reporter v3.
- Retrospective ADRs 010–023 documenting implicit architectural decisions.

### Documentation

- Added Satsuma Diaries section to the website.
- Archived 7 completed features (22–25, 29).
- Reorganised `docs/` into `developer/` and `product-owner/` subfolders.
- Added `adr-draft` skill for assessing and drafting ADRs.

## v0.6.0 — 2026-03-30

### VS Code Extension — LSP Server Crash Fix

- Fixed a critical crash that prevented the language server from starting after
  the VSIX was installed. esbuild bundled satsuma-core's `await import("web-tree-sitter")`
  using the ESM build, which calls `createRequire(import.meta.url)` — but esbuild
  stubs `import.meta` as `{}` in CJS output, making `import.meta.url` undefined at
  runtime. Fixed by aliasing `web-tree-sitter` to its CJS build in the server
  esbuild config. As a bonus, this also consolidates the previously duplicated
  ESM and CJS instances into a single one used by both the parser and semantic
  token helpers.

### VS Code Extension — Removed Redundant Command

- Removed the **Satsuma: Where Used** command and its right-click context menu
  entry. The built-in **Find All References** (Shift+F12) backed by the LSP
  references provider covers this fully and with better UX.

### End-to-End Smoke Tests

- The `smoke-tests/` suite is now run in CI. Tests are written as pytest-bdd
  Gherkin feature files (`.feature` + step definitions in `conftest.py`),
  covering 43 arrow scenarios and 4 lineage scenarios against the live CLI.
- `scripts/run-repo-checks.sh` runs the smoke tests locally when `satsuma` is
  on PATH, skipping gracefully with a clear message when it is not.

### Code Readability

- Extensive literate-programming pass across the CLI and LSP packages: every
  module now opens with a purpose comment, exported functions have doc-comments
  stating their contract, business rules are labelled with their source, and
  magic constants are named. Targets the project's goal of being a readable
  reference implementation of a tree-sitter-backed language toolchain.

### Documentation & Tooling

- Reorganised `docs/` into `developer/` and `product-owner/` subfolders.
- Added an `adr-draft` skill for assessing and drafting Architecture Decision
  Records; integrated as a pre-PR review step in the agent workflow.
- Added the Satsuma Diaries section to the website.

## v0.5.0 — 2026-03-28

### VS Code Visualization — Schema Spread Resolution

- Fragment spreads (`...ns::fragment`) are now fully pre-resolved at model-build
  time. Every schema card in both the workspace overview and the mapping detail
  view shows the complete, flat list of fields — including all inherited spread
  fields — without any special spread indicators. Recursive fragment chains
  (fragments that spread other fragments) are resolved iteratively until stable.
- Fragment nodes no longer appear as separate cards in the overview graph.
  Fragments are an authoring shorthand; the viz shows the resolved result.
- Overview mapping arrows now always render for cross-namespace mappings. A
  two-pass layout build ensures all schema node IDs are registered before edges
  are created, fixing silent edge drops when a mapping's namespace was processed
  before its source or target schema namespace.
- Source and target schema cards in the mapping detail view now show all
  spread-inherited fields alongside directly declared fields, so field-level
  arrows connect correctly to every field in the card.

### VS Code Extension

- Added context-aware lineage actions: right-clicking a field or schema in a
  `.stm` file now surfaces **Open Lineage View** and **Trace Field Lineage**
  commands scoped to the entity under the cursor.

### Shared `satsuma-core` Package

- Extracted shared parser utilities, CST helpers, and the formatter into a new
  `@satsuma/core` internal package consumed by both the CLI and the LSP server.
  This removes duplicated parsing infrastructure and makes the formatter
  available to all tooling without a circular dependency.
- Fixed a regex backtracking issue in the formatter that caused catastrophic
  slowdown on certain long NL strings.

### CLI & Packaging

- The CLI entry point now ships with the executable bit set, fixing
  `permission denied` errors after `npm install -g` on Linux and macOS.
- The release packaging step now fails fast if the WASM parser artifact is
  missing, preventing silent broken releases.

### Website

- Added workspace overview and mapping detail screenshots to the VS Code
  extension page, showing the interactive visualization in action.
- Added a full-width workspace overview screenshot to the home page, placed
  between the hero and the Problem/Solution sections.

## v0.4.0 — 2026-03-27

### Visual Mapping Workspace

- New two-level visualisation in the VS Code extension: an overview mode with
  compact schema cards and thick mapping arrows, plus a focused mapping-detail
  view with source schemas, a central arrow table, and the target schema.
- Mapping-detail hover now cross-highlights rows and fields in both directions,
  making multi-schema joins and transforms much easier to inspect.
- Added pan/zoom reset on overview-to-detail transitions, smoother fade
  animation, a minimap, SVG export, mapping tooltips, and a cleaner toolbar.
- Schema cards now render metadata pills and Markdown notes, and the layout no
  longer fails when mappings reference missing ports.

### VS Code Extension

- Added the new visualisation panel backed by the `@satsuma/viz` web component
  package and LSP-driven visual model extraction.
- Registered `.satsuma` files alongside `.stm`, added file icons, and grouped
  Satsuma commands coherently in the editor context menu.
- Fixed `Find References` for arrow paths and backtick NL references.
- Fixed bundled WASM runtime resolution so the packaged extension works
  reliably outside the development environment.

### CLI And Distribution

- The CLI now ships as one universal release artifact built on WASM
  `web-tree-sitter`, removing platform-specific release packaging.
- Release packaging now builds the visualisation bundle before VSIX creation,
  fixing the missing `@satsuma/viz` asset issue in GitHub Actions.
- Install docs now reflect the single universal CLI package for all platforms.

### Documentation

- Added the Feature 23 Phase 5 visual redesign plan and updated release-facing
  docs to reflect `v0.4.0` and the current manual release flow.

## v0.3.0 — 2026-03-26

### Language Simplification (Feature 22)

- **`@ref` cross-references** — new `@schema`, `@schema.field`, and
  `@ns::schema.field` syntax for referencing entities inside NL strings.
  Replaces the need for backtick-only references; backticks remain supported.
- **Grammar simplification** — collapsed 13 `kv_value` forms into greedy
  `value_text`, replaced `token_call`/`arithmetic_step` with greedy `pipe_text`,
  and simplified `map_key`/`map_value` with `repeat1`. Net reduction of ~150
  grammar rules with zero loss of expressiveness.
- **Backtick-only labels** — single-quoted block labels (`'name'`) removed from
  the grammar. All multi-word labels now use backtick syntax (`` `name` ``).
- **Multi-source arrows** — `a, b -> target` syntax for arrows with multiple
  source fields. Grammar, extraction, canonicalization, and CLI output all
  updated.

### CLI

- **`@ref` extraction** — `nl-refs`, `validate`, `lint`, `graph`, and `lineage`
  commands all recognize `@ref` syntax alongside backtick references.
- **Lineage follows `@ref` edges** — `satsuma lineage` traverses `nl_ref` edges
  emitted by `graph`, providing full cross-reference lineage.
- **`hidden-source-in-nl` auto-fix** — `satsuma lint --fix` can now insert
  missing source declarations when an NL reference mentions an undeclared schema.
  Severity raised from warning to error.
- **Canonical output** — all commands emit namespace-qualified, canonical field
  references (e.g. `ns::schema.field`) for consistent downstream consumption.
- **30 bug fixes** across two bughunt rounds, including:
  - Source block join NL extraction and `@ref` scanning
  - Field-scoped `nl` queries now recurse into `each`/`flatten` blocks
  - `graph --schema-only` no longer duplicates edges for namespaced mappings
  - `validate` no longer false-warns when duplicate mapping names exist across files
  - `classify` correctly detects mixed NL/structural pipe steps
  - `mapping --compact --json` now strips transforms, notes, and metadata
  - `lint` no longer flags backtick emphasis in file-level notes or dotted
    sub-field paths of declared sources
  - 3+ segment `@ref` paths (e.g. `@schema.record.subfield`) correctly resolve
    through nested record structures
  - Consistent `1`-indexed row numbers in all JSON output
  - Formatter preserves blank lines between header and section comments
- **845 CLI tests** (up from 679 in v0.1.0).

### VS Code Extension

- **`@ref` highlighting** — TextMate grammar updated with `@ref` token rules.
- **LSP `@ref` support** — semantic tokens, go-to-definition, and diagnostics
  for `@ref` cross-references.

### Documentation

- All examples, tutorials, convention guides, and spec updated for `@ref`
  syntax and backtick-only labels.
- New EDI convention guide (EDIFACT / ODETTE / TRADACOMS).
- MARC21 convention example gaps closed.
- Satsuma-to-Excel conversion skill added.
- Site examples and stats refreshed for v2 syntax.

### Infrastructure

- `npm run install:all` builds WASM parser and LSP server in one step.
- Integration tests run concurrently (24s down to 7.5s).
- CI test reporting via JUnit XML.

---

## v0.2.0 — 2026-03-24

### Formatter (`satsuma fmt`)

- **Opinionated, zero-config formatter** — one canonical style for all Satsuma
  files, analogous to `gofmt` or `black`. No settings, no overrides.
- **CLI command:** `satsuma fmt [path]` with `--check` (CI mode, exit 1 if
  unformatted), `--diff` (print unified diff), `--stdin` (pipe mode).
- **VS Code Format Document** — LSP `DocumentFormattingProvider` wired to the
  same shared `format()` function. Supports format-on-save.
- **Parser-backed:** walks the full tree-sitter CST, preserves all comments,
  never changes semantics.
- **Field column alignment** with name/type/metadata columns (caps at 24/14
  characters to prevent pathological widths).
- **Blank line normalisation:** 2 between top-level blocks, 1 within blocks,
  no trailing blanks, single newline at EOF.
- **Comment handling:** all three types preserved (`//`, `//!`, `//?`), section
  headers kept as-is, trailing inline comments with 2-space gap.
- **CI integration:** `satsuma fmt --check examples/` step in the CI pipeline.
- 81 formatter tests, 16/16 corpus files idempotent and structurally equivalent.

### VS Code Extension

- **WASM migration** — LSP server now uses web-tree-sitter (WASM) instead of
  native bindings, eliminating platform-specific build requirements.
- **Arrow navigation** — go-to-definition from arrow paths to source/target
  schema fields.
- **NL-ref navigation** — go-to-definition from backtick references inside
  natural language strings.
- **TODO diagnostics** — `//!` and `//?` comments surfaced in the Problems panel
  with warning/info severity.
- **Underlined NL refs** — backtick references inside NL strings get underline
  styling for visual distinction.
- Fixed WASM runtime packaging in `.vsix` artifacts.

### Site

- **GitHub Pages site** with brand guide, landing page, CLI reference, VS Code
  feature tour, examples gallery, and learning resources.
- Dynamic version templating and release notes links.
- FAQ section and no-CLI getting-started guide.

### Infrastructure

- Versioned releases via manual `workflow_dispatch`.
- Build artifacts auto-attached to tagged releases.
- Shell injection fix in CI workflow inputs.
- Tailwind CSS vendored locally for SRI compliance.

---

## v0.1.0 — 2026-03-24

First tagged release of the Satsuma language and toolchain.

### Language

- **Satsuma v2 specification** — formal grammar covering schemas, mappings,
  fragments, transforms, metrics, namespaces, imports, natural-language blocks,
  value maps, pipe chains, metadata vocabulary, and unified field syntax.
- **16 canonical examples** demonstrating real-world patterns: database migrations,
  CRM-to-warehouse syncs, EDI/COBOL/XML/Protobuf format conversion, multi-source
  joins, metric definitions, namespace-based platform modelling, and governance
  filters.
- **AI agent reference** — a compact grammar and conventions summary designed for
  LLM prompts, also available via `satsuma agent-reference`.

### Tree-Sitter Parser

- Full v2 grammar with 490 corpus tests across 25 test files.
- Covers all spec constructs including nested records, list_of fields,
  namespace blocks, multi-line NL strings, and adjacent string concatenation.
- Error recovery tests for malformed input.
- Tree-sitter queries: `highlights.scm`, `folds.scm`, `locals.scm`.

### CLI (`satsuma`)

16 commands for structural extraction, analysis, validation, and diff:

- **Workspace extractors:** `summary`, `schema`, `metric`, `mapping`,
  `find --tag`, `lineage`, `where-used`, `warnings`, `context`
- **Structural primitives:** `arrows`, `nl`, `meta`, `fields`, `match-fields`
- **Graph analysis:** `graph` (with `--json`, `--compact`, `--schema-only`,
  `--namespace` filters)
- **Validation:** `validate`, `lint` (3 rules with `--fix`), `diff`
- **Agent support:** `agent-reference`

All commands produce deterministic, parser-backed output. JSON output via
`--json` on every command. 679 tests across 154 suites, all passing.

### VS Code Extension

Full editor experience backed by a tree-sitter LSP server:

- **Syntax highlighting** — TextMate grammar with semantic token overrides for
  context-sensitive constructs.
- **Diagnostics** — parse errors in real time; semantic warnings on save via
  `satsuma validate`; `//!` and `//?` comment markers surfaced in Problems panel.
- **Navigation** — go-to-definition, find-references, rename symbol (cross-file,
  namespace-aware).
- **IntelliSense** — context-aware completions for schema names, fragment/transform
  spreads, field paths, metadata tokens, and pipeline functions.
- **Document structure** — outline panel, breadcrumbs, code folding for all block
  types, contextual hover.
- **CodeLens** — inline annotations showing field counts, usage counts, and
  source/target relationships.
- **Commands** — 9 palette commands: validate, lineage, where-used, warnings,
  summary, arrows, workspace graph, field lineage, mapping coverage.
- **Workspace graph** — interactive SVG diagram with click-to-navigate and
  namespace filtering.
- **Field lineage** — multi-hop visual trace from source to target through
  transforms.
- **Mapping coverage** — gutter markers and status bar showing mapped vs unmapped
  fields.

142 LSP server tests.

### Documentation

- Language specification (`SATSUMA-V2-SPEC.md`)
- CLI command reference (`SATSUMA-CLI.md`)
- AI agent reference (`AI-AGENT-REFERENCE.md`)
- Business analyst tutorial (`BA-TUTORIAL.md`)
- Use cases and personas (`USE_CASES.md`)
- Data modelling conventions for Kimball and Data Vault patterns
- Security threat model and report (`SECURITY-REPORT.md`)
- Excel-to-Satsuma conversion prompt for web LLMs

### Not Yet Included

- `satsuma fmt` (formatter)
- Type checking
- Code generation (Python, SQL, dbt scaffolding)
- Excel-to-Satsuma and Satsuma-to-Excel conversion tooling
