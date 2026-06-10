# Satsuma: Source-To-Target Mapping Language

## Project Overview & Vision

---

## The Problem

Data integration is one of the most common activities in enterprise software engineering. Every migration, every system integration, every ETL pipeline starts with the same question: *"How does data in system A map to data in system B?"*

The answer to that question today lives in **source-to-target mapping documents** — and they are almost universally terrible.

### What mapping documents look like today

**Excel spreadsheets.** The overwhelming majority of mapping specs are created in Excel. They are:

- **Inconsistent.** Every team, every project, every consultant invents their own column layout. Source Field, Target Field, Transformation, Comments, Data Type, Required... but the columns change every time, the naming varies, and the structure is ad-hoc.
- **Ambiguous.** Transformation logic is described in free-text cells: *"Convert to uppercase and validate"* — but what does "validate" mean? What happens on failure? These questions get answered in Slack threads and lost.
- **Unversioned.** Excel files get emailed, copied to SharePoint, edited by multiple people. Which version is current? Nobody knows for certain.
- **Unparseable.** No tool can reliably consume an arbitrary mapping spreadsheet. Every new project requires a human to read the Excel, interpret the intent, and manually translate it to code.
- **Disconnected from implementation.** The mapping doc says one thing; the code does another. Drift is inevitable because there's no mechanical link between the spec and the implementation.

**Wiki pages and Confluence docs.** Slightly better for narrative context, but even worse for structure. Tables in Confluence are painful to maintain and impossible to parse programmatically.

**YAML/JSON specs (our previous attempt).** More structured, but verbose. A simple field mapping that a human would express as `CUST_TYPE → customer_type (R=retail, B=business)` becomes 5-7 lines of YAML. The signal-to-noise ratio is poor, and the format is hostile to both quick scanning and large-scale specs.

### Why this matters now

The rise of AI coding agents changes the equation. We are entering an era where:

1. **AI agents will generate integration code** — but they need a structured, unambiguous spec to work from. An Excel spreadsheet with free-text transformation descriptions is not that.
2. **AI agents will help *write* mapping specs** — by reading source system documentation, interviewing stakeholders, and proposing mappings. But they need a format they can produce reliably.
3. **AI agents will validate implementations** — comparing generated code against the mapping spec to detect drift. This requires a parseable spec, not prose.
4. **Integration complexity is increasing** — microservices, event-driven architectures, multi-cloud, and real-time streaming create orders of magnitude more integration points than traditional batch ETL.

The world needs a **lingua franca** for data mapping that is simultaneously human-readable and machine-parseable.

It also needs a format that acknowledges a hard truth: not all integration intent
should be forced into a fully formal expression language. Some parts of a
mapping are best represented as deterministic structure. Some parts are best
represented as carefully scoped natural language. Satsuma is built around that
split.

---

## The Vision

**Satsuma is to data mapping what DBML is to database schemas** — a concise,
beautiful, parseable domain-specific language that becomes the single source of
truth for how data transforms between systems.

But that analogy is only half the story. Satsuma is also designed as an
**AI-native mapping spec**: a language where deterministic structure and natural
language live together intentionally, so parser-backed tools and LLM reasoning
can work side by side.

### Design goals

1. **A business analyst should be able to read it.** If a BA can't scan a mapping spec and understand what's happening, the format has failed. Readability is not a nice-to-have; it's the primary design constraint.

2. **An AI agent should be able to write it.** The syntax borrows heavily from languages LLMs already know well (SQL, TypeScript, HCL, DBML). The grammar is compact enough to fit in a system prompt. An agent given a source schema and a target schema should be able to produce valid Satsuma on the first attempt.

3. **A parser should be able to validate it.** Unlike free-text Excel cells, every structural element of Satsuma is formally specified. A linter can catch missing mappings, type mismatches, broken references, and schema inconsistencies automatically.

4. **Natural language should be first-class, but bounded.** Notes, review context, and underspecified business rules should travel with the mapping instead of being pushed into Slack threads or detached documents. That natural language should be explicitly located and easy for tooling to extract.

5. **It should be 40-60% smaller than equivalent YAML.** Token efficiency matters for AI consumption, but it also matters for human scanning. Less ceremony means faster comprehension.

6. **It should handle the real world.** Not just clean REST-to-REST API mappings, but legacy SQL Server databases with dates stored as VARCHAR, EDI fixed-length messages with qualifier-filtered segments, COBOL copybooks with field names that contain spaces, and XML with deeply nested namespaces.

### What Satsuma enables

| Capability | How Satsuma enables it |
|---|---|
| **AI-generated integration code** | Agent reads `.stm` file → generates Python/Java/SQL implementation |
| **AI-assisted spec writing** | Agent reads system docs → proposes `.stm` mapping → human reviews |
| **Automated validation** | Parser checks completeness, type safety, referential integrity |
| **Living documentation** | `.stm` files live in Git alongside code, versioned and reviewed |
| **Cross-team communication** | BAs, data engineers, and architects share one format |
| **Tool ecosystem** | Visualizers, diff tools, code generators, IDE extensions |
| **Migration from Excel** | AI agent reads existing Excel mapping → outputs `.stm` file |

### Why the natural-language layer matters

Many mapping languages make one of two mistakes:

- they stay mostly prose, so tooling cannot trust them
- they over-formalize everything, so real project intent escapes into side documents anyway

Satsuma tries to avoid both failures.

The parser-backed parts of the language carry the structure that must be exact:

- schemas and field shapes
- mapping arrows and references
- metadata tags and constraints
- imports, fragments, and reusable transforms

The natural-language parts carry the intent that humans and agents still need:

- business rule explanations
- partially specified transforms
- caveats, assumptions, and warnings
- review context and implementation guidance

This is the key product idea: **Satsuma lets deterministic tools extract facts,
and lets AI agents reason over the parts that remain intentionally human.**

That makes the language unusually well suited to agent workflows:

- the CLI can answer structural questions exactly
- the agent can read the extracted NL content without scraping arbitrary files
- validation, lineage, and impact analysis stay grounded in the parser
- implementation generation can combine hard constraints with contextual judgment

---

## How Satsuma Works

### The three-part structure

Every Satsuma file has three kinds of blocks:

```
┌─────────────────────────────────────────────┐
│  1. SCHEMA BLOCKS                           │
│     Describe the structure of each system   │
│     (fields, types, nesting, annotations)   │
├─────────────────────────────────────────────┤
│  2. MAPPING BLOCKS                          │
│     Describe how data flows between schemas │
│     (field mappings, transforms, logic)     │
├─────────────────────────────────────────────┤
│  3. METADATA                                │
│     Integration context, notes, imports     │
│     (author, cardinality, documentation)    │
└─────────────────────────────────────────────┘
```

This separation of **structure** from **logic** from **context** is fundamental. It means:

- Schema blocks can be imported and reused across integrations
- Mapping blocks can be reviewed independently of schema definitions
- Notes and context travel with the spec, not in separate documents

It also means Satsuma is compatible with a hybrid deterministic-plus-LLM tool
model. Structural tooling extracts the parseable facts. Agents then reason over
the explicit natural-language content in context, instead of treating the whole
spec as opaque prose.

### A taste of the syntax

```satsuma
schema legacy_db (note "Legacy CUSTOMER table") {
  CUST_ID       INT          (pk)
  CUST_TYPE     CHAR(1)      (enum {R, B, G})       //! NULL means Retail
  FIRST_NM      VARCHAR(100)
  LAST_NM       VARCHAR(100)
  EMAIL_ADDR    VARCHAR(255)  (pii)
}

schema new_db (note "Modernized customer schema") {
  customer_id   UUID          (pk, required)
  customer_type VARCHAR(20)   (enum {retail, business, government})
  display_name  VARCHAR(200)  (required)
  email         VARCHAR(255)  (format email, pii)
}

mapping {
  source { `legacy_db` }
  target { `new_db` }

  CUST_ID -> customer_id { uuid_v5(NS, CUST_ID) }

  CUST_TYPE -> customer_type {
    map { R: "retail", B: "business", G: "government", null: "retail" }
  }

  -> display_name {
    "If @CUST_TYPE is 'R' or null, trim and concat @FIRST_NM + ' ' + @LAST_NM.
     Otherwise 'UNKNOWN'."
  }

  EMAIL_ADDR -> email { trim | lowercase | validate_email | null_if_invalid }
}
```

Compare this to the equivalent YAML (~35 lines) or Excel (a table with 6 columns and ambiguous free-text transforms). The Satsuma version is scannable, parseable, and complete.

The important detail is that the natural-language line for `display_name` is
not a failure of the language. It is a deliberate choice. Some transforms are
better represented as business intent than as a prematurely formal mini-language.
Satsuma keeps that intent in-band so both humans and AI agents can use it.

---

## Competitive Landscape & Inspiration

| Existing approach | Strengths | Satsuma advantage |
|---|---|---|
| **Excel spreadsheets** | Familiar, flexible | Parseable, versionable, validated, AI-readable |
| **YAML-based specs** (our v3) | Structured, machine-readable | 40-60% fewer tokens, far more readable |
| **DBML** | Beautiful syntax, great tooling | Satsuma extends the paradigm to transformations, not just schema |
| **dbt** | SQL-native, tested, versioned | Satsuma covers non-SQL sources (EDI, XML, events) and documents the *mapping intent* not just the implementation |
| **Informatica / Talend mappings** | Visual, enterprise-grade | Satsuma is open, text-based, Git-friendly, vendor-neutral |
| **AsyncAPI / OpenAPI** | Standardized API descriptions | Satsuma describes *transformations between* systems, not individual system interfaces |

Satsuma is not trying to replace any of these. It fills a specific gap:
**a standardized, parseable, human-readable format for the mapping document
that sits between systems, with natural language retained as part of the spec
instead of pushed outside it.**

---

## Target Audience

### Primary users

- **Data Engineers** writing and maintaining integration pipelines
- **Integration Architects** designing system-to-system data flows
- **Business Analysts** reviewing and signing off mapping specifications
- **AI Agents** generating, consuming, and validating mapping specs

### Secondary users

- **QA Engineers** using mapping specs as test case sources
- **Data Governance teams** tracking PII/sensitivity across system boundaries
- **Project Managers** tracking mapping completeness and open questions

---

## Success Metrics

How we'll know Satsuma is working:

1. **Adoption:** Teams choose Satsuma over Excel for new mapping documents
2. **AI reliability:** Claude/GPT can produce valid Satsuma >90% of the time from a system prompt
3. **Agent leverage:** Teams use parser-backed Satsuma tooling plus LLM reasoning for code generation, review, lineage, or impact analysis
4. **Tooling ecosystem:** Parser, extraction CLI, validator/lint, and visualizer/editor tooling exist
5. **Community:** Others contribute examples, tools, or extensions
6. **Reduced rework:** Integration defects attributable to mapping ambiguity decrease

---

## Current State & Roadmap

### What exists today

- Formal language specification ([SATSUMA-V2-SPEC.md](../developer/SATSUMA-V2-SPEC.md))
- Canonical example library covering major integration patterns (16 `.stm` files)
- AI-oriented quick reference and compact grammar for prompts ([AI-AGENT-REFERENCE.md](../../AI-AGENT-REFERENCE.md))
- Tree-sitter parser (482 corpus tests)
- TypeScript CLI (`satsuma`) with 17 commands for structural extraction, analysis, validation, formatting, and diff — see [SATSUMA-CLI.md](../../SATSUMA-CLI.md)
- `satsuma fmt` — opinionated, zero-config formatter (CLI + VS Code Format Document)
- `satsuma lint` with 3 policy rules and `--fix` support
- VS Code extension with LSP server (go-to-definition, find-references, completions, hover, rename, code lens, semantic tokens, diagnostics, folding, document symbols, formatting)
- Namespace support for multi-team, multi-domain platform modelling
- Unified field syntax (`Name record { }`, `Name list_of record { }`, `Name list_of TYPE`)
- Data-modelling conventions and examples for Kimball and Data Vault patterns
- Self-contained [Excel-to-Satsuma prompt](../../useful-prompts/excel-to-stm-prompt.md) for web LLMs
- **Browser playground ("Try it Live!")** — a zero-install live editor at
  [equalexperts.github.io/satsuma-lang/playground/](https://equalexperts.github.io/satsuma-lang/playground/):
  edit Satsuma source (or open a local `.stm` file) and watch the lineage
  visualization update as you type. Everything — parsing, model building,
  rendering, persistence — runs client-side in the browser; **source is never
  uploaded**, which makes the playground safe for proprietary mapping specs.

### What is strategically important next

- **Agent workflows on top of deterministic tooling.** The parser and CLI are dependable primitives inside AI agents that draft mappings, explain lineage, review changes, and generate implementation scaffolding.
- **Editor intelligence.** The VS Code language server delivers go-to-definition, find-references, completions, hover, rename, code lens, semantic tokens, and live diagnostics. Lineage visualization is the next editor milestone.
- **Expanded linting.** `satsuma lint` ships with 3 rules today. Deeper convention checks and broader semantic analysis are next.
- **Excel and code-generation loops.** Excel-to-Satsuma, Satsuma-to-Excel, and code generation remain important. A lite conversion prompt is available; full tooling is deferred.
- **Explicit NL lineage.** Making natural-language transform dependencies machine-readable requires a language design review.

### Near-term roadmap

1. **Expand linting and validation.** More lint rules, convention checks, and cross-file semantic analysis.
2. **Lineage visualization.** Interactive lineage webview in VS Code, building on the LSP and `satsuma graph` command.
3. **Excel conversion tooling.** Full-featured Excel-to-Satsuma skill for Claude Code, building on the lite prompt already available.
4. **Code generation.** Generate implementation scaffolding (Python, SQL, dbt) from Satsuma specs.

---

## Getting Involved

Satsuma is an open specification. Contributions are welcome in the form of:

- Language design feedback
- Example mapping documents in Satsuma format
- Parser and tooling implementations
- IDE extension development
- Documentation and tutorials
