# Satsuma in 10 Lessons (+ 4 Playbooks)

A practical learning path for people who need to get data-mapping work done with Satsuma and an AI agent. The goal is not to turn every learner into a language expert. The goal is to show how a human stays focused on intent, business rules, and decisions while the agent handles the hard parts of reading, drafting, validating, slicing, and tracing well-formed Satsuma.

The 10 core lessons build the mental model, language basics, and parser-backed workflows. The 4 playbooks then adapt that model to specific roles.

This curriculum is agent-friendly, but it is not agent-dependent. The first pass through the material should leave a learner able to open a `.stm` file, identify the main blocks, run a few core `satsuma` commands, and tell the difference between exact structural facts and interpreted natural-language intent.

---

## The Core Learning Model

Everything in this curriculum is built around one operating model:

- Satsuma carries deterministic structure and explicit natural-language intent in the same artifact.
- The parser and `satsuma` CLI extract structural facts exactly.
- The agent interprets natural-language notes and transforms, composes CLI workflows, and drafts or revises valid Satsuma.
- The human stays in charge of meaning, priorities, tradeoffs, and approval.

That means learners do not need to memorize the whole language up front. They need to understand:

- what kinds of things belong in Satsuma
- what the CLI can answer deterministically
- what the agent must reason about
- how to review and steer the agent effectively

---

## Who This Is For

The core lessons target technical business analysts, integration engineers, data engineers, architects, and delivery leads who need a mapping spec they can trust, but who do not want to become grammar specialists before they can make progress.

The course assumes the learner can read structured text and reason about source/target mappings. It does not assume deep familiarity with DSL design, parsers, or Tree-sitter.

The playbook extensions are role-specific and can be read after the core path, or selectively once Lessons 1-5 are understood.

---

## Before You Begin

You do not need to configure an AI agent before you can start learning Satsuma.

The minimum baseline is:

- read one small `.stm` file directly
- run `satsuma summary`, `satsuma schema <name>`, and `satsuma validate`
- compare the raw file with the CLI output
- notice which parts are exact structure and which parts are natural-language intent

After that baseline is clear, the agent becomes much more useful because you can verify what it is doing.

---

## Scope Notes

The core path focuses on schemas, mappings, transforms, nesting, and CLI-backed review workflows.

Some repo examples also use more advanced surfaces:

- **metrics**: important for analytics-oriented work, but not required to understand the core mapping model on day 1
- **namespaces**: used in exploratory and platform-style examples; if you encounter `crm::customers`-style references early, treat them as an advanced extension and use the core mental model first

If you are new to Satsuma, do not start with the namespace-heavy examples.

---

## Running Scenario

The core lessons use a single running scenario: **Acme Corp migrating customer and order data from a legacy CRM into a modern analytics platform**.

Across the lessons, the learner and the agent progressively:

- read existing Satsuma safely
- draft schemas from messy source material
- write mappings and transforms
- handle natural-language business rules
- validate and lint changes
- trace lineage and impact with the CLI
- review diffs and refine the spec without reading every file manually

By the end, the learner sees Satsuma less as "a language to master" and more as "a reliable collaboration surface between human judgment, deterministic tooling, and an agent runtime."

---

## Core Lessons

### [Lesson 01 — What Satsuma Is Really For](01-what-is-satsuma.md)

Introduces Satsuma as the replacement for spreadsheet and wiki mapping specs, and establishes the hybrid model from the updated docs: deterministic structure plus bounded natural language, with the CLI extracting facts and the agent doing the reasoning. The learner’s first task is not to write a perfect file from scratch, but to understand what kinds of questions can be answered structurally and what kinds require judgment. It also introduces a minimal manual baseline before moving into agent setup.

**Covers:** project vision, why Satsuma exists, the parser-backed + agent-backed split, the three-delimiter rule (`( )`, `{ }`, `" "`), comments vs notes, a first minimal schema + mapping example, what humans own vs what agents own, setting up AI agents with `satsuma --intro-for-agents`.

---

### [Lesson 02 — Reading Satsuma with an Agent](02-reading-satsuma.md)

Teaches learners how to approach an unfamiliar Satsuma file without becoming syntax archaeologists. The emphasis is on quickly identifying schemas, fields, metadata, notes, and nested structures, then asking the agent to explain the file in business terms while preserving the exact structure. This is where learners first see that reading Satsuma is a collaboration problem, not a memorization problem.

**Covers:** `schema`, field declarations, metadata tokens, `record`, `list`, fragments at a glance, field and schema notes, how to ask an agent to explain a block faithfully, how to distinguish deterministic structure from NL intent.

---

### [Lesson 03 — Writing Schemas from Imperfect Inputs](03-writing-schemas.md)

Shows how a human can provide spreadsheets, API docs, sample payloads, or database extracts and have the agent draft valid schema blocks. The lesson teaches what information the agent needs, how to review field names/types/metadata, and when to preserve ambiguity as a note instead of forcing false precision.

It explicitly includes the Lite Excel-import workflow from [useful-prompts/excel-to-stm-prompt.md](../useful-prompts/excel-to-stm-prompt.md): survey the workbook, identify tab roles and column roles, generate Satsuma, then self-critique for coverage, types, and transform fidelity before the human approves the result.

**Covers:** drafting `schema` blocks from source materials, using metadata like `pk`, `required`, `pii`, `enum`, `format`, capturing caveats in `note`, choosing when to use quoted NL instead of invented pseudo-logic, review prompts for correcting agent-generated schemas, Excel-to-Satsuma with the workbook-survey -> column-role-detection -> generation -> self-critique approach.

---

### [Lesson 04 — Reuse, Imports, and Multi-File Thinking](04-reuse-and-imports.md)

Moves from isolated files to real workspaces. Learners see how fragments, imports, and shared definitions reduce duplication and make large mapping inventories manageable. The agent’s role here is to help identify reusable structures and keep cross-file references consistent.

**Covers:** `fragment`, `...spread`, `import { ... } from "..."`, reusable schema building blocks, shared field sets, why definition uniqueness matters, how an agent should navigate multi-file workspaces, the idea of a platform entry point for platform-wide lineage.

---

### [Lesson 05 — Mapping Blocks: Declaring Flow, Not Writing Code](05-mappings.md)

Introduces mapping blocks as the heart of the language. The learner focuses on expressing the business relationship between source and target, while the agent helps generate arrows, detect omissions, and keep the syntax well-formed. This lesson reinforces that a mapping is a specification artifact, not implementation code.

**Covers:** `mapping`, `source`, `target`, direct arrows, computed arrows (`-> target`), arrow metadata, named vs anonymous mappings, multi-source mappings, using notes inside mappings, agent-assisted drafting from source/target schemas.

---

### [Lesson 06 — Natural Language Transforms and Agent Reasoning](06-nl-transforms.md)

This is the most important conceptual lesson. It teaches why natural-language transforms are not a weakness in Satsuma but a deliberate design choice. Learners practice giving the agent business-rule prose, asking it to turn that intent into well-placed Satsuma NL blocks or structural pipelines where appropriate, and reviewing whether the result preserves meaning. The lesson also covers how agents should reason about NL blocks surfaced by the CLI.

**Covers:** transform bodies, structural pipelines, NL transforms, mixed transforms, when to formalize vs when to keep intent in quotes, `@ref` markers inside NL, how agents interpret NL while the CLI only extracts it verbatim, review techniques for ambiguous business rules.

---

### [Lesson 07 — Nested Data, Arrays, and Complex Shapes](07-nested-mappings.md)

Extends the mapping model to real nested payloads and repeated structures. The learner focuses on the conceptual shape of the data, while the agent helps produce correct path expressions and nested arrow blocks. The lesson positions complexity as something the agent should shoulder mechanically, while the human validates that the shape matches reality.

**Covers:** dotted paths, backtick identifiers, `[]` array notation, nested mapping blocks, relative paths like `.field`, array-to-array mappings, records and lists, reviewing nested mappings for correctness without hand-crafting every path.

---

### [Lesson 08 — The Satsuma CLI](08-satsuma-cli.md)

Reframes the CLI correctly based on the current docs: not as a natural-language query engine, but as a deterministic extraction layer the agent composes into workflows. The learner also sees the small set of commands a human should know directly for trust and debugging: `summary`, `schema`, `validate`, `lint`, and `mapping`. The key idea is that the CLI gives exact slices; the agent supplies the analysis.

**Covers:** the CLI design principle, workspace extractors, structural primitives, graph export, `validate` vs `lint`, transform classification (`structural`, `nl`, `mixed`, `none`, `nl-derived`), when to use CLI output instead of raw file reading, `--json` and `--compact` for agent workflows.

---

### [Lesson 09 — Human-Agent Workflows for Navigation, Impact, and Review](09-agent-workflows.md)

Builds complete workflows out of the CLI primitives. Instead of teaching commands one by one in isolation, this lesson teaches what a human asks for and how the agent should respond: trace downstream impact of a source field, check whether target fields are unmapped, find PII propagation, review a structural diff, or locate all open warnings. The learner practices steering the workflow and judging the result.

**Covers:** impact analysis with `arrows` + `nl`, coverage checks with `fields --unmapped-by`, PII audit with `find --tag pii`, change review with `diff`, ambiguity escalation when an NL transform must be interpreted, using `graph --json` for whole-workspace reasoning, distinguishing deterministic evidence from agent inference.

---

### [Lesson 10 — End-to-End Delivery with Satsuma, the CLI, and an Agent](10-real-world-workflows.md)

Brings everything together into the real delivery loop: gather source material, draft with the agent, preserve ambiguous business logic as bounded NL, validate and lint, trace impact, review structural diffs, and iterate toward a versioned source of truth. The outcome is that learners understand how to run a Satsuma-centered project without manually doing all the low-level syntax and navigation work themselves.

It also explicitly covers the two Excel boundary workflows that matter in practice:

- ingesting legacy Excel mapping spreadsheets into Satsuma with the agent-first workflow from `features/04-excel-to-stm-skill`
- exporting read-only, human-friendly Excel snapshots for downstream stakeholders using the layout goals from `features/05-stm-to-excel-export`

The export framing is important: Excel is treated as a presentation snapshot for review, sign-off, and distribution, not as the long-term source of truth. Satsuma remains canonical.

**Covers:** end-to-end authoring and review workflow, workspace organization, review and approval patterns, validation checkpoints, using agents for drafting and explanation, using the CLI for exact retrieval, multi-file collaboration, Excel-to-Satsuma intake, Satsuma-to-Excel stakeholder snapshots, how Satsuma becomes a living spec rather than another stale document.

---

## Playbook Extensions

Each playbook assumes the learner understands the core model: the CLI extracts facts, the agent reasons over intent, and the human approves meaning.

### [Lesson 11 — The Business Analyst’s Playbook](11-ba-playbook.md)

For BAs and delivery leads who want to specify outcomes and business rules without getting trapped in syntax details. Focuses on providing clear intent, writing reviewable natural-language transforms, asking the agent for draft mappings, and using parser-backed validation to keep the spec honest.

**Personas:** Business Analyst, Delivery Lead

---

### [Lesson 12 — The Data & Analytics Engineer’s Playbook](12-data-engineer-playbook.md)

For engineers using Satsuma as the source of truth for warehouse, lakehouse, and dimensional modeling work. Focuses on precise schemas, structural transforms, metrics, lineage, and using the agent to accelerate mapping authoring and downstream implementation planning.

**Personas:** Data Engineer, Analytics Engineer, Data Modeler

---

### [Lesson 13 — The Governance & Audit Playbook](13-governance-playbook.md)

For governance, risk, and audit stakeholders who need defensible lineage, PII tracking, warnings, open questions, and versioned evidence. Focuses on using deterministic CLI output plus explicit agent interpretation where NL content affects compliance judgments.

**Personas:** Governance, Risk, Audit, Enterprise Architect

---

### [Lesson 14 — The Integration Engineer’s Playbook](14-integration-engineer-playbook.md)

For engineers working across APIs, files, XML, events, and heterogeneous enterprise platforms. Focuses on nested structures, format-specific metadata, multi-source mappings, and using the agent to turn messy integration knowledge into well-formed Satsuma quickly.

**Personas:** Integration Engineer, Solution Architect

---

## Suggested Reading Paths

| Your goal | Start here | Then |
|---|---|---|
| Build a basic manual baseline before using an agent | Lessons 1 -> 2 -> 8 | Then continue sequentially |
| Understand the overall operating model | Lessons 1 -> 2 -> 5 -> 8 | Continue sequentially |
| Read an existing Satsuma workspace with confidence | Lessons 1 -> 2 -> 4 -> 8 -> 9 | Then your role playbook |
| Draft new specs with an agent from messy source material | Lessons 1 -> 3 -> 5 -> 6 -> 10 | Then your role playbook |
| Convert legacy Excel mappings into Satsuma | Lessons 1 -> 3 -> 8 -> 10 | Then Lesson 11 or 14 |
| Publish stakeholder-friendly Excel snapshots from Satsuma | Lessons 1 -> 8 -> 9 -> 10 | Then Lesson 11 or 13 |
| Use Satsuma for impact analysis and review | Lessons 1 -> 5 -> 8 -> 9 | Then Lesson 13 or 14 |
| Focus on BA-style collaboration with an agent | Lessons 1 -> 2 -> 3 -> 5 -> 6 | Then Lesson 11 |
| Focus on engineering delivery and implementation | Lessons 1 -> 3 -> 4 -> 5 -> 7 -> 8 -> 9 | Then Lesson 12 or 14 |

---

## What Learners Should Internalize

By the end of this curriculum, a learner should be able to say:

- "I do not need to manually parse every Satsuma file to understand the workspace."
- "I know when to ask the CLI for structure and when to ask the agent for reasoning."
- "I can express business rules in bounded natural language without breaking the spec."
- "I can review agent-generated Satsuma for meaning, not just syntax."
- "I can use Satsuma as a living collaboration artifact, not just a documentation format."

---

## File List

```text
lessons/
├── README.md                          ← this file (lesson plan index)
├── 01-what-is-satsuma.md
├── 02-reading-satsuma.md
├── 03-writing-schemas.md
├── 04-reuse-and-imports.md
├── 05-mappings.md
├── 06-nl-transforms.md
├── 07-nested-mappings.md
├── 08-satsuma-cli.md
├── 09-agent-workflows.md
├── 10-real-world-workflows.md
├── 11-ba-playbook.md
├── 12-data-engineer-playbook.md
├── 13-governance-playbook.md
└── 14-integration-engineer-playbook.md
```
