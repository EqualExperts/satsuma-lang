![Satsuma logo](assets/512x_satsuma_logo.png)

<p>
  <a href="https://www.equalexperts.com/" target="_blank" rel="noopener">
    <img src="assets/ee-brand/ee-logo-colour.png" alt="Equal Experts" height="28">
  </a>
  <br>
  <em><a href="https://www.equalexperts.com/" target="_blank" rel="noopener">An Equal Experts open-source project</a></em>
</p>

# Satsuma

[![CI](https://github.com/EqualExperts/satsuma-lang/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](https://github.com/EqualExperts/satsuma-lang/actions/workflows/ci.yml?query=branch%3Amain+event%3Apush)
[![Release](https://github.com/EqualExperts/satsuma-lang/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/EqualExperts/satsuma-lang/actions/workflows/release.yml)
[![Security](https://github.com/EqualExperts/satsuma-lang/actions/workflows/security.yml/badge.svg?branch=main&event=push)](https://github.com/EqualExperts/satsuma-lang/actions/workflows/security.yml?query=branch%3Amain+event%3Apush)

📖 **[Website, documentation &amp; examples → equalexperts.github.io/satsuma-lang](https://equalexperts.github.io/satsuma-lang/)**

⚡ **[Try it Live! — edit Satsuma in your browser and watch the visualization update](https://equalexperts.github.io/satsuma-lang/playground/)** (everything runs client-side; your source is never uploaded)

Satsuma is a domain-specific language for source-to-target data mapping.

It is designed to replace ad hoc spreadsheets, wiki tables, and overly verbose
structured specs with a format that is:

- readable by humans
- parseable by tools
- compact enough for AI agents to generate and consume reliably
- stable enough to act as the source of truth for downstream tooling

Satsuma is intended to sit between systems and describe how data moves from one
shape to another, whether those systems are databases, APIs, files, messages,
events, or mixed enterprise platforms.

What makes Satsuma different is that it does not force a false choice between
formal structure and human intent. The language keeps schemas, mappings,
metadata, and references deterministic and parser-backed, while still allowing
natural language exactly where real projects need it: notes, business rules,
underspecified transforms, and review context.

That makes Satsuma a good fit for AI agents. Deterministic tooling can extract
the structural facts with high confidence, while an LLM handles the reasoning
over the natural-language parts. The parser and CLI are not competing with the
agent; they are the reliable substrate that lets the agent reason safely.

## Why Satsuma Exists

Most mapping specifications today are hard to trust operationally:

- spreadsheets are inconsistent and drift from implementation
- free-form docs are readable but not machine-checkable
- YAML and JSON are parseable but too noisy for large mapping inventories
- vendor tools often hide critical logic behind UI configuration

Satsuma aims to solve that by making mapping intent explicit in a language that both
people and parsers can work with directly.

That matters even more in AI-assisted delivery. Agents can produce better code,
better reviews, and better impact analysis when they operate against a
constrained language instead of reverse-engineering free-form implementation
logic.

The intended operating model is hybrid:

- Satsuma captures the deterministic structure of the integration
- the `satsuma` CLI extracts facts, topology, metadata, lineage, and NL content
- the LLM reasons over those extracted facts plus the embedded natural-language intent

This is the core idea: use deterministic tools for what must be exact, and use
LLM reasoning for what cannot be fully formalized without making the language
unusable.

## Natural Language as a First-Class Part of the Spec

Satsuma treats natural language as part of the specification surface, not as an
embarrassing escape hatch.

In real mapping work, some intent is naturally formal:

- source and target structures
- field references
- metadata tags
- imports and reusable definitions
- file-based workspace boundaries and import-reachable symbol graphs

Some intent is not naturally formal, at least not without turning the mapping
document into a programming language:

- business rules that depend on domain interpretation
- legacy behaviors that are known but not fully codified
- transformation notes that require analyst review
- implementation guidance and caveats for downstream teams

Satsuma keeps both in one versioned artifact. That is important for AI agents:

- the parser-backed parts provide reliable structure
- the natural-language parts preserve the reasoning context humans actually use
- the CLI can surface both without inventing semantics
- the agent can then apply judgment instead of scraping prose from Excel cells

## Extensible Metadata: Satsuma's Superpower

Satsuma's `( )` metadata accepts **any vocabulary token**. There are no reserved
metadata keywords. When you write `(merge upsert, match_on customer_id)` or
`(dimension, scd 2)`, you are not using built-in language features — you are
using conventions that anyone can define and document.

That means your organisation can encode its own standards directly into specs:

```satsuma
schema payments (
    owner "payments-team",
    data_domain "finance",
    cost_center "CC-4200",
    audit_level high,
    compliance {PCI-DSS, SOX}
) {
  ...
}
```

None of those tokens required a language change. They work today. Write an
`LLM-Guidelines.md` that tells AI agents how to interpret your custom tokens
(what DDL to generate, what tests to create, what policies to enforce), and
every AI agent in your organisation knows how to act on them. The
[convention guides](docs/) that ship with Satsuma
([Kimball](docs/data-modelling/kimball/LLM-Guidelines.md),
[Data Vault](docs/data-modelling/datavault/LLM-Guidelines.md),
[Merge Strategy](docs/conventions-for-merge-strategy/LLM-Guidelines.md),
[Governance](docs/conventions-for-governance/LLM-Guidelines.md),
[Reports & Models](docs/conventions-for-reports-and-models/LLM-Guidelines.md))
are ready-made examples of this pattern.

## What Satsuma Covers

Satsuma supports:

- schema and record structure declarations
- source-to-target field mappings
- computed target fields
- transform bodies expressed as natural-language pipe steps plus value maps
- conditional mapping logic
- comments and rich notes with semantic intent
- reusable fragments and imports
- multi-file platform modeling for platform-wide lineage

The long-term tooling model is parser-first:

1. grammar and parser
2. AST/CST conventions
3. linter and validator
4. formatter
5. editor support
6. visualizers and generators

For the package map, dependency graph, and design principles behind the tooling, see [Satsuma Tooling Architecture](docs/developer/ARCHITECTURE.md).

For agent workflows specifically, the model is:

1. author or generate `.stm`
2. validate and extract with deterministic tooling
3. let the agent reason over the extracted structure plus NL intent
4. generate code, reviews, documentation, or impact analysis from that combined view

## Install the CLI

A universal pre-built package is published on every merge to `main`. It uses
WASM internally, so the same package works on macOS, Linux, and Windows:

```bash
npm install -g https://github.com/EqualExperts/satsuma-lang/releases/download/latest/satsuma-cli.tgz
```

This gives you the `satsuma` command on your PATH. Run `satsuma --help` to see
available commands.

> **Can't install the CLI or VS Code extension?** Satsuma is still useful
> without any tooling. LLMs can read and generate `.stm` files directly — our
> tests show 3–8x fewer tokens than equivalent spreadsheets or YAML — and
> plain-text files version-control cleanly. See
> **[Using Satsuma Without the CLI](docs/using-satsuma-without-cli.md)** for
> workflows with web LLMs like ChatGPT, Gemini, or Claude.ai.

## Example

```satsuma
note { "Customer sync — legacy CRM to analytics warehouse" }

schema crm (note "Legacy CRM — SQL Server 2008") {
  CUST_ID     INT            (pk)
  CUST_TYPE   CHAR(1)        (enum {R, B, G})  //! NULL means Retail
  FIRST_NM    VARCHAR(100)
  LAST_NM     VARCHAR(100)
  EMAIL_ADDR  VARCHAR(255)   (pii)
  STATUS      CHAR(1)        (enum {A, I})
}

schema warehouse (note "Analytics Model — PostgreSQL 16") {
  customer_id   UUID         (pk, required)
  customer_type VARCHAR(20)  (enum {retail, business, government})
  display_name  VARCHAR(200) (required)
  email_address VARCHAR(255) (format email)
  is_active     BOOLEAN
}

mapping {
  source { `crm` }
  target { `warehouse` }

  CUST_ID    -> customer_id   { uuid_v5("namespace", CUST_ID) }
  EMAIL_ADDR -> email_address { trim | lowercase | validate_email | null_if_invalid }
  STATUS     -> is_active     { map { A: true, I: false } }

  CUST_TYPE -> customer_type {
    map { R: "retail", B: "business", G: "government", null: "retail" }
  }

  -> display_name {
    "If @CUST_TYPE is null or R, trim and concat @FIRST_NM + ' ' + @LAST_NM.
     Otherwise 'UNKNOWN'."
  }
}
```

Pipe steps such as `trim | lowercase | validate_email | null_if_invalid` are
natural-language instructions. Quotes are optional; tooling classifies them as
`nl`, not as a separate structural pipeline type. `map { ... }` remains a
structural value-mapping construct.

For richer examples, see [examples/db-to-db/pipeline.stm](examples/db-to-db/pipeline.stm),
[examples/edi-to-json/pipeline.stm](examples/edi-to-json/pipeline.stm),
and [examples/multi-source/multi-source-hub.stm](examples/multi-source/multi-source-hub.stm).

## Learn Satsuma

The **[Lessons](lessons/README.md)** are the fastest way to get productive with
Satsuma and an AI agent. 10 core lessons build the mental model progressively,
and 4 role-specific playbooks adapt it to how you actually work:

| Lessons | What you learn |
|---|---|
| [01 — What Satsuma Is Really For](lessons/01-what-is-satsuma.md) | The hybrid model, three delimiters, setting up your AI agent |
| [02 — Reading Satsuma with an Agent](lessons/02-reading-satsuma.md) | Schemas, metadata, nested structures, asking the agent to explain |
| [03 — Writing Schemas from Imperfect Inputs](lessons/03-writing-schemas.md) | Drafting from DDL, JSON, Excel; preserving ambiguity |
| [04 — Reuse, Imports, and Multi-File Thinking](lessons/04-reuse-and-imports.md) | Fragments, imports, workspace organization |
| [05 — Mapping Blocks](lessons/05-mappings.md) | Arrows, transforms, value maps, multi-source mappings |
| [06 — Natural Language Transforms](lessons/06-nl-transforms.md) | When to formalize vs. keep it natural, `@ref` references |
| [07 — Nested Data, Arrays, and Complex Shapes](lessons/07-nested-mappings.md) | Dotted paths, array notation, nested arrow blocks |
| [08 — The Satsuma CLI](lessons/08-satsuma-cli.md) | The CLI as the agent's deterministic toolkit |
| [09 — Human-Agent Workflows](lessons/09-agent-workflows.md) | Impact analysis, coverage checks, PII audits, change review |
| [10 — End-to-End Delivery](lessons/10-real-world-workflows.md) | The full delivery loop from gathering to versioned source of truth |

**Playbooks:** [Business Analyst](lessons/11-ba-playbook.md) ·
[Data Engineer](lessons/12-data-engineer-playbook.md) ·
[Governance & Audit](lessons/13-governance-playbook.md) ·
[Integration Engineer](lessons/14-integration-engineer-playbook.md)

Start with Lesson 01 or jump to a [suggested reading path](lessons/README.md#suggested-reading-paths) based on your role.

## Repository Guide

- [SATSUMA-V2-SPEC.md](docs/developer/SATSUMA-V2-SPEC.md): authoritative language specification
- [PROJECT-OVERVIEW.md](docs/product-owner/PROJECT-OVERVIEW.md): problem statement, vision, and roadmap
- [SATSUMA-CLI.md](SATSUMA-CLI.md): CLI command reference (structural extraction, analysis, and validation)
- [AI-AGENT-REFERENCE.md](AI-AGENT-REFERENCE.md): compact grammar and quick reference for agents (also available via `satsuma agent-reference`)
- [docs/tutorials/](docs/tutorials/): role-based tutorials (BA, data engineer, integration engineer) plus a [Copilot + Excel reverse-engineering workflow](docs/tutorials/copilot-excel-reverse-engineering-tutorial.md)
- [USE_CASES.md](docs/product-owner/USE_CASES.md): practical scenarios and personas
- [HOW-DO-I.md](HOW-DO-I.md): question-based index to all guides and conventions
- [ROADMAP.md](docs/product-owner/ROADMAP.md): deferred work items, ideas, and convention docs still to write
- [examples/](examples): canonical Satsuma examples
- [tooling/tree-sitter-satsuma/](tooling/tree-sitter-satsuma): tree-sitter parser package
- [tooling/satsuma-cli/](tooling/satsuma-cli): CLI tool for structural extraction and validation
- [tooling/vscode-satsuma/](tooling/vscode-satsuma): VS Code extension with LSP server and syntax highlighting
- [skills/](skills): Agent Skills following the [agentskills.io](https://agentskills.io) standard:
  - [excel-to-satsuma](skills/excel-to-satsuma) — convert Excel mapping spreadsheets to Satsuma (Python CLI tool + Claude Code slash command)
  - [satsuma-to-excel](skills/satsuma-to-excel) — generate stakeholder-ready Excel workbooks from `.stm` files
  - [satsuma-explainer](skills/satsuma-explainer) — explain `.stm` files in plain English for business stakeholders, including PII audits, coverage checks, and impact analysis
  - [satsuma-from-dbt](skills/satsuma-from-dbt) — reverse-engineer Satsuma specs from an existing dbt project
  - [satsuma-to-dbt](skills/satsuma-to-dbt) — scaffold an idiomatic dbt project (Kimball, Data Vault, exposures) from `.stm` specs
  - [satsuma-sample-data](skills/satsuma-sample-data) — generate realistic synthetic test data that respects schema constraints and referential integrity
  - [satsuma-to-openlineage](skills/satsuma-to-openlineage) — emit OpenLineage events (Marquez/DataHub/Atlan/OpenMetadata) with column-level lineage
  - [adr-draft](skills/adr-draft), [satsuma-diaries](skills/satsuma-diaries) — internal authoring helpers
- [useful-prompts/](useful-prompts): self-contained system prompts for web LLMs ([Excel-to-Satsuma](useful-prompts/excel-to-stm-prompt.md), [Satsuma-to-Excel](useful-prompts/stm-to-excel-prompt.md))

## Current Status

What exists today:

- the Satsuma v2 language specification
- a canonical example corpus (20 `.stm` files covering major integration patterns)
- a tree-sitter parser (245 corpus tests, all examples parse clean)
- a TypeScript CLI (`satsuma`) with commands for structural extraction, analysis, validation, formatting, and diff — see [SATSUMA-CLI.md](SATSUMA-CLI.md)
- `satsuma fmt` — opinionated, zero-config formatter (CLI + VS Code Format Document)
- a VS Code extension with an LSP server (go-to-definition, find-references, completions, hover, rename, code lens, semantic tokens, diagnostics, folding, document symbols, formatting) and TextMate grammar
- `satsuma lint` with 3 rules (hidden NL source refs, unresolved NL refs, duplicate definitions) and `--fix` support
- namespace support for multi-team, multi-domain platform modelling
- data modelling conventions for Kimball and Data Vault patterns with canonical examples
- pre-built CLI release artifacts published on every merge to `main`

### Agent Skills

Satsuma ships a suite of [Agent Skills](skills/) that turn `.stm` files into a hub for the rest of your stack. Each skill is self-contained, follows the [agentskills.io](https://agentskills.io) standard, and works with any agent runtime that supports skills (Claude Code, Claude Desktop, etc.).

- **Excel → Satsuma** ([excel-to-satsuma](skills/excel-to-satsuma)) — surveys a spreadsheet, generates idiomatic Satsuma with chunked extraction, and self-critiques the output. Includes a Python CLI tool and `/excel-to-satsuma` slash command. A [lite prompt for web LLMs](useful-prompts/excel-to-stm-prompt.md) is also available for zero-setup conversion.
- **Satsuma → Excel** ([satsuma-to-excel](skills/satsuma-to-excel)) — produces stakeholder-ready Excel workbooks from `.stm` files. A [lite web-LLM prompt](useful-prompts/stm-to-excel-prompt.md) is also available.
- **Explain a spec** ([satsuma-explainer](skills/satsuma-explainer)) — plain-English walkthroughs, risk assessments, PII audits, coverage checks, and impact analysis for non-technical stakeholders.
- **dbt → Satsuma** ([satsuma-from-dbt](skills/satsuma-from-dbt)) — reverse-engineers Satsuma mapping specs from an existing dbt project so you can adopt Satsuma without starting over.
- **Satsuma → dbt** ([satsuma-to-dbt](skills/satsuma-to-dbt)) — scaffolds an idiomatic dbt project (staging/marts, Kimball stars, Data Vault 2.0, exposures) from `.stm` specs.
- **Synthetic test data** ([satsuma-sample-data](skills/satsuma-sample-data)) — generates realistic CSV/JSON fixtures from a schema, respecting types, enums, PII patterns, and referential integrity across tables.
- **OpenLineage export** ([satsuma-to-openlineage](skills/satsuma-to-openlineage)) — emits OpenLineage events with column-level lineage for Marquez, DataHub, Atlan, and OpenMetadata.

## Multi-File Lineage

Satsuma supports multi-file platform modeling through imports and namespaces.
That gives tooling a consistent way to traverse lineage and impact across a
platform from a chosen entry file, without treating a whole directory as an
implicit merged workspace.

In practical terms:

- library files define reusable schemas, fragments, and lookups
- integration files define source/target structures and mapping blocks
- namespace-qualified imports connect those files into one platform graph
- only symbols reachable through the entry file's import graph are in scope

This matters when multiple teams have similarly named schemas or when lineage
needs to cross project boundaries cleanly.

## Parser-First Tooling

Downstream tools should be built on the parser, not on text heuristics.

The parser work lives in
[tooling/tree-sitter-satsuma/](tooling/tree-sitter-satsuma)
and is responsible for syntax parsing only. Semantic validation, formatting,
import resolution, and code generation should consume the parser output rather
than reinterpreting raw Satsuma text.

The same principle applies to AI-agent integrations. Agents should prefer
parser-backed CLI output over raw file scraping for structural questions, then
apply reasoning only where the language intentionally carries natural-language
meaning.

If you are contributing tooling, start here:

- read [SATSUMA-V2-SPEC.md](docs/developer/SATSUMA-V2-SPEC.md)
- inspect the example corpus in [examples/](examples)
- review the parser in [tooling/tree-sitter-satsuma/](tooling/tree-sitter-satsuma) and its grammar
- review the CLI in [tooling/satsuma-cli/](tooling/satsuma-cli) and its command reference in [SATSUMA-CLI.md](SATSUMA-CLI.md)
- treat CST and AST naming stability as part of the public implementation surface

## Development

### Prerequisites

- Node.js 22+
- Python 3.12+

### Setup

Install all dependencies across every package, build the WASM parser, and
compile all bundles in one step from the repo root:

```bash
npm run install:all
```

This is the only setup step needed. It runs `npm install` in every package,
builds `satsuma-core`, builds the WASM parser (`tree-sitter build --wasm`),
runs the CLI prebuild to copy generated sources and WASM into `dist`, builds
`satsuma-viz`, and compiles the VS Code LSP server.

To start fresh, wipe all `node_modules` and `dist` directories and reinstall:

```bash
npm run reinstall
```

### Tree-sitter parser

```bash
cd tooling/tree-sitter-satsuma
npm run generate          # regenerate parser from grammar.js
npm test                  # corpus tests + fixture tests + CST tests + smoke tests
```

Individual test suites:

```bash
node_modules/.bin/tree-sitter test --wasm   # corpus tests only (always use --wasm)
python3 scripts/test_fixtures.py            # example and recovery fixtures
python3 scripts/test_cst_summary.py         # CST consumer unit tests
python3 scripts/test_smoke_summary.py       # smoke test all examples
```

Always use the `--wasm` flag with the `tree-sitter` CLI — there is no native
build in this repository.

When changing `grammar.js`, regenerate and commit the generated parser sources:

```bash
npm run generate
git add src/
```

CI will fail if `src/` diverges from `grammar.js`.

### Satsuma CLI

```bash
cd tooling/satsuma-cli
npm test                  # full test suite
npm link                  # symlink `satsuma` onto your PATH for local use
```

Quick usage:

```bash
satsuma summary examples/db-to-db/pipeline.stm                       # structural overview
satsuma validate examples/db-to-db/pipeline.stm                      # structural + semantic validation
satsuma schema customers examples/db-to-db/pipeline.stm              # show a specific schema
satsuma lineage --from legacy_sqlserver examples/db-to-db/pipeline.stm   # trace data flow
```

To set up an AI agent, print the built-in reference:

```bash
satsuma agent-reference               # print grammar, conventions, and CLI guide
satsuma agent-reference > .github/copilot-instructions.md   # feed to Copilot
```

To build the distributable tarball (the same way CI and releases do):

```bash
npm run pack              # produces satsuma-cli.tgz, verified and smoke-tested
```

See [SATSUMA-CLI.md](SATSUMA-CLI.md) for the full command reference.

### VS Code extension

We haven't published the extension to the official VS Code Marketplace yet.
A pre-built `.vsix` is published on every merge to `main`. Download it from the
[latest release](https://github.com/EqualExperts/satsuma-lang/releases/tag/latest)
and install:

- In VS Code, open the Command Palette (`Cmd+Shift+P`) and choose
  **Extensions: Install from VSIX...**
- Navigate to the downloaded `.vsix` and select it.
- Commands like **Satsuma: Show Warnings** are available, and `.stm` files get
  syntax highlighting and LSP features.

To build from source or run the test suite:

```bash
cd tooling/vscode-satsuma
npm run check             # validate manifest/grammar + run all tests
npm run build             # build client + server + webview bundles
```

### Viz harness (local Playwright tests)

`tooling/satsuma-viz-harness/` is a standalone HTTP server and browser client
for testing the `<satsuma-viz>` web component against canonical fixtures — without
VS Code or the LSP in the loop.

This is a **local developer-machine workflow only**. It is not run in CI.

```bash
cd tooling/satsuma-viz-harness
npm run build             # build server + client bundles
```

To run the Playwright test suite, start the sentinel watcher in a separate
terminal, then trigger a run by touching the sentinel file:

```bash
# Terminal 1 — leave running
./watch-and-test.sh

# Terminal 2 — trigger a run
touch .run-tests
# Results appear in .playwright-results.txt
```

The watcher kills any stale server on port 3333, runs `npx playwright test`,
writes results to `.playwright-results.txt`, and resets the sentinel.

The test suite covers:
- Overview rendering (schema cards, mapping nodes) for the sfdc-to-snowflake fixture
- Clicking a mapping card to open the detail view
- Field-hover and navigate event pipeline validation (programmatic dispatch)
- Cross-file lineage merging for an import-reachable fixture set
- Layout stability on the sap-po-to-mfcs larger fixture

### CI

The full CI picture is documented in [CI-WORKFLOWS.md](docs/developer/CI-WORKFLOWS.md).
In brief:

- **CI** (`ci.yml`) runs on every push and pull request to `main`. It verifies
  linting, the tree-sitter parser (corpus tests, generated-source staleness,
  conflict count), the CLI test suite, the VS Code extension tests and LSP
  server, a CLI tarball pack-and-install smoke test, and the Excel skill tests.
- **Release** (`release.yml`) runs on every push to `main` to publish a rolling
  `latest` pre-release, and on manual dispatch to create a tagged release with
  changelog-sourced release notes.
- **Security** (`security.yml`) runs on every push and PR, and is also called
  as a gate by the release workflow. It covers `npm audit` across all packages
  and Semgrep SAST.

Grammar conflict count is enforced in CI against
`tooling/tree-sitter-satsuma/CONFLICTS.expected` — update that file when
adding or removing documented conflicts.

## Contributing

Contributions are most useful when they strengthen the parser-backed ecosystem.

Good contribution areas:

- grammar and parser improvements
- corpus tests and malformed-input recovery tests
- additional canonical examples
- AST/CST mapping documentation
- editor tooling and visualization work

When syntax, semantics, or supported constructs are in question, prefer the
spec over secondary docs and call out mismatches explicitly.

## Concerned About Security?

Satsuma is a local-only, read-only analysis tool — it makes no network calls,
stores no credentials, and runs no user-supplied code. The entire toolchain is
open source and auditable. Automated security scanning (npm audit, Semgrep,
Gitleaks, Dependabot) runs on every pull request, and releases are gated behind
passing security checks.

For a full threat model, dependency audit, and enterprise adoption guidance, see
the **[Security Report](SECURITY-REPORT.md)**.

## Maintained by Equal Experts

Satsuma is **An Equal Experts open-source project** — maintained by
[Equal Experts](https://www.equalexperts.com/), the software consultancy that
helps clients build the things they need to run their business.

The project was created by Thorben Louw and is now under EE stewardship. EE
engineers use Satsuma across client engagements in data engineering and
integration work, and we contribute the language and its tooling back to the
community under the MIT licence so other teams can use it too.

## License

This project is licensed under the [MIT License](LICENSE).

## Citing Satsuma

If you use Satsuma in academic or technical writing, please cite it. See
[CITATION.cff](CITATION.cff) for machine-readable citation metadata.
