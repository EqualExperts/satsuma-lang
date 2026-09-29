# Lesson 08 — The Satsuma CLI

## What the CLI Is For

The Satsuma CLI (`satsuma`) is a **deterministic extraction layer**: each command answers one structural question about a workspace, and you — or your agent — combine the answers into workflows. In day-to-day work, the agent often runs the commands for you. You should still know a small core set directly so you can verify outputs, debug problems, and build trust in the tooling.

The key principle: **the CLI gives exact slices; the agent supplies the analysis.**

---

## Why This Design

A workspace might have dozens of files with thousands of lines, and most questions are about a small part of it. The CLI lets you, or the agent, ask for exactly that part:

- "Show me just the `customers` schema" — not the entire file.
- "List all arrows involving `email`" — not every mapping in the workspace.
- "Find all fields tagged `pii`" — not a full-text search.

The answers are exact, because they come from the parse tree rather than from reading the text.

---

## The CLI Commands

The CLI command surface is organized into four groups:

### Workspace Extractors

These pull out specific named blocks:

| Command | What it returns |
|---|---|
| `summary [path]` | Overview of all schemas, mappings, metrics, and counts |
| `schema <name>` | Full definition of one schema |
| `metric <name>` | Full definition of one metric |
| `mapping <name>` | Full mapping with all arrows |
| `find --tag <token>` | All fields carrying a specific metadata tag |
| `lineage --from/--to <schema>` | Schema-level data flow graph |
| `where-used <name>` | All references to a definition across the workspace |
| `warnings` | All `//!` and `//?` comments |
| `context <query>` | Keyword-ranked block extraction |

### Structural Primitives

These extract specific structural elements:

| Command | What it returns |
|---|---|
| `arrows <schema.field>` | All arrows involving a field, with transform classification |
| `nl <scope>` | All natural-language content (notes, transforms, comments) |
| `meta <scope>` | All metadata entries for a block or field |
| `fields <schema>` | Field list with types and metadata |
| `match-fields --source <s> --target <t>` | Normalized name comparison between schemas |

### Workspace Graph

| Command | What it returns |
|---|---|
| `graph [path]` | Complete semantic graph (nodes, edges, field-level flow) |

The `graph` command exports the full workspace structure as a graph. Flags control the output:
- `--json` — machine-readable JSON
- `--compact` — reduced output for smaller context windows
- `--schema-only` — skip field-level detail
- `--namespace <ns>` — filter to a namespace
- `--no-nl` — exclude natural-language content

### Structural Analysis

| Command | What it returns |
|---|---|
| `validate [path]` | Parse errors and semantic reference checks |
| `lint [path]` | Policy and convention checks |
| `diff <a> <b>` | Structural comparison of two snapshots |

---

## validate vs. lint

These two commands serve different purposes:

**`validate`** checks correctness:
- Parse errors (malformed syntax)
- Unresolved references (a mapping refers to a schema that doesn't exist)
- Missing required blocks

If `validate` reports errors, the file is broken. Fix these first.

**`lint`** checks conventions:
- `hidden-source-in-nl` — NL text references a schema not declared in the mapping's source/target list
- `unresolved-nl-ref` — an `@ref` in NL that can't be resolved to a known identifier
- `duplicate-definition` — two definitions with the same name

Lint warnings are advisory. They might indicate real problems or acceptable patterns.

Lint supports additional flags:
- `--fix` — auto-fix certain issues
- `--select` / `--ignore` — choose which rules to run
- `--json` — machine-readable output
- `--quiet` — suppress non-error output
- `--rules` — list available lint rules

---

## Transform Classification

When the agent runs `satsuma arrows`, each arrow is annotated with its transform classification:

| Classification | Meaning | Agent action |
|---|---|---|
| `[structural]` | Deterministic pipeline | Can be validated mechanically |
| `[nl]` | Natural language | Agent interprets the intent |
| `[mixed]` | Pipeline + NL | Agent interprets NL, validates pipeline |
| `[none]` | Direct mapping, no transform | Passthrough — nothing to interpret |
| `[nl-derived]` | Implicit from `@ref` in NL | Agent traces the lineage dependency |

This classification helps the agent decide how to handle each arrow: structural transforms can be checked for correctness, while NL transforms need interpretation and human review.

---

## The Five Commands Humans Should Know

Even in an agent-first workflow, learners should be comfortable running these directly:

- `satsuma summary <path>` — what is in the workspace?
- `satsuma schema <name>` — what does one schema look like?
- `satsuma mapping <name>` — what does one mapping say?
- `satsuma validate <path>` — is the workspace structurally valid?
- `satsuma lint <path>` — what conventions or NL-reference issues need review?

If you can use those five commands, you can sanity-check most agent output.

---

## Output Formats for Agent Workflows

Most CLI commands support `--json` and `--compact` flags:

- **`--json`** produces structured output the agent can parse programmatically.
- **`--compact`** reduces output size for smaller context windows.

The agent typically uses `--json` when it needs to process results programmatically (e.g., building a lineage graph) and default text output when presenting results to you.

---

## How the Agent Composes CLI Commands

When you ask a question like "What fields are marked as PII in this workspace?", the agent:

1. Runs `satsuma find --tag pii <path>`
2. Receives the list of PII-tagged fields with their locations
3. Formats the result as a readable answer

For more complex questions, the agent chains commands:

**"Trace the impact of changing the `CUST_ID` field":**
1. `satsuma arrows legacy_sqlserver.CUST_ID` — find all arrows that use `CUST_ID`
2. `satsuma lineage --from legacy_sqlserver` — see where data flows downstream
3. `satsuma nl` — check NL transforms that reference `@CUST_ID` via @ref

**"Are there any unmapped target fields?":**
1. `satsuma fields <target_schema> --unmapped-by '<mapping>'` — list target fields not covered by a specific mapping
2. Repeat for other mappings that target the same schema if needed
3. Report any fields that remain uncovered

---

## When to Use CLI Output vs. Raw File Reading

| Situation | Approach |
|---|---|
| You need one schema from a large file | `satsuma schema <name>` |
| You need all PII fields across the workspace | `satsuma find --tag pii` |
| You need to understand data flow | `satsuma lineage --from <schema>` |
| You need to read the full file (small file, first time) | Read the file directly |
| You need to edit the file | Read the file, then edit |
| You need to check for errors after editing | `satsuma validate` then `satsuma lint` |

The CLI is most valuable in large workspaces where reading entire files would overwhelm the context. For small files (under 200 lines), reading the file directly is fine.

---

## Exercise: CLI-Assisted Exploration

Imagine you've inherited a Satsuma workspace with 20 files you've never seen before. Here's how the agent would help you explore it:

1. **Get the big picture:** `satsuma summary pipeline.stm`
   - How many schemas? Mappings? Metrics?
   - What systems are represented?

2. **Find risk areas:** `satsuma warnings pipeline.stm`
   - What data quality issues are flagged (`//!`)?
   - What questions are unresolved (`//?`)?

3. **Understand a specific mapping:** `satsuma mapping 'customer migration'`
   - What are the source and target?
   - How many arrows? What classifications?

4. **Check compliance:** `satsuma find --tag pii pipeline.stm`
   - Which fields are PII?
   - Are they encrypted? (Check `meta` for encryption tags.)

5. **Trace lineage:** `satsuma lineage --from crm_customers pipeline.stm`
   - Where does CRM data flow?
   - What downstream targets are affected by a schema change?

Each step gives you exact, parseable information. The agent combines it into a narrative you can act on.

---

## Hands-On Check

Do one direct, non-agent walkthrough on the repo corpus:

```bash
satsuma summary examples/sfdc-to-snowflake/pipeline.stm
satsuma schema country_codes
satsuma mapping `customer migration`
satsuma validate examples/sfdc-to-snowflake/pipeline.stm
satsuma lint examples/sfdc-to-snowflake/pipeline.stm
```

What you should get out of this:

- `summary` gives you the inventory
- `schema` and `mapping` give you exact slices
- `validate` tells you whether the workspace is structurally sound
- `lint` tells you where conventions or NL references need human review

Once that feels normal, handing the CLI to an agent becomes much safer.

---

## Key Takeaways

1. The CLI is a deterministic extraction layer for the agent, but humans should know a small core command set directly.
2. The command surface covers workspace exploration, structural extraction, graph export, and analysis.
3. `validate` checks correctness (parse errors, broken references). `lint` checks conventions.
4. Transform classification (`[structural]`, `[nl]`, `[mixed]`, `[none]`, `[nl-derived]`) tells the agent how to handle each arrow.
5. `--json` and `--compact` flags make CLI output efficient for agent workflows.
6. The agent composes multiple CLI commands to answer complex questions.

---

**Next:** [Lesson 09 — Human-Agent Workflows for Navigation, Impact, and Review](09-agent-workflows.md) — complete workflows built from CLI primitives.
