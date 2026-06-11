# Satsuma CLI

The `satsuma` command-line tool is a deterministic structural extraction tool for Satsuma workspaces. It sits on top of the tree-sitter parser and provides structured, query-driven access to schemas, mappings, metrics, lineage, and workspace metadata — without requiring callers to read or parse raw `.stm` files.

**The CLI extracts structural facts. It does not interpret natural language.** Satsuma uses NL strings in transform bodies, notes, and comments to express intent that cannot be captured as deterministic pipelines. The CLI parses the structure around that NL content and delivers it verbatim — the consuming agent or human decides what it means. The CLI is the toolkit. The agent is the runtime.

## Installation

The CLI lives in `tooling/satsuma-cli/`. To install it locally:

```bash
cd tooling/satsuma-cli
npm install
npm link    # makes `satsuma` available globally
```

## Design Principle

Every CLI command produces **100% deterministically correct results from the parse tree**. If a result's correctness depends on interpreting natural language, that operation does not belong in the CLI — it belongs in the agent that calls the CLI.

The CLI's role is to make workspace navigation token-efficient: instead of pulling entire files into an agent's context window, the agent makes precise structural queries and gets back exactly the slice it needs. The agent then composes these primitives into higher-level workflows (impact analysis, coverage assessment, audit) where it applies its own reasoning to the NL content the CLI surfaces.

## Commands

### Workspace Extractors

Block-level extraction — retrieve whole blocks or workspace-level summaries.

| Command | Operation | Example |
|---|---|---|
| `summary [path]` | Workspace overview — all schemas, mappings, metrics, counts | `satsuma summary pipeline.stm` |
| `schema <name>` | Full schema definition from parse tree | `satsuma schema hub_customer` |
| `metric <name>` | Full definition of a schema decorated with `metric` metadata | `satsuma metric monthly_revenue` |
| `mapping <name>` | Full mapping with all arrows and transforms | `satsuma mapping "sfdc to hub_customer"` |
| `find --tag <token>` | Fields carrying a metadata tag | `satsuma find --tag pii` |
| `lineage --from/--to <schema>` | Schema-level graph traversal | `satsuma lineage --from loyalty_sfdc` |
| `where-used <name>` | All references to a schema, fragment, or transform | `satsuma where-used hub_product` |
| `warnings` | All `//!` and `//?` comments across the workspace | `satsuma warnings` |
| `context <query>` | Keyword-ranked block extraction (heuristic) | `satsuma context "customer mapping"` |

### Structural Primitives

Fine-grained extraction — slice below block level to get specific arrows, NL content, metadata, or field lists.

| Command | Operation | Example |
|---|---|---|
| `arrows <schema.field>` | All arrows involving a field, with transform classification | `satsuma arrows loyalty_sfdc.LoyaltyTier` |
| `field-lineage <schema.field>` | Full upstream + downstream field lineage chain in one command | `satsuma field-lineage sat_customer_demographics.loyalty_tier --json` |
| `nl <scope>` | NL content (notes, transforms, comments) in a scope | `satsuma nl "demographics to mart"` |
| `nl-refs [path]` | All `@ref` references in NL transform bodies, with resolution status | `satsuma nl-refs pipeline.stm --unresolved` |
| `meta <scope>` | Metadata entries for a block or field | `satsuma meta loyalty_sfdc.Email` |
| `fields <schema>` | Field list with types and metadata | `satsuma fields sat_customer_demographics` |
| `match-fields --source <s> --target <t>` | Normalized name comparison between two schemas | `satsuma match-fields --source loyalty_sfdc --target sat_customer_demographics` |

### Workspace Graph

Full workspace topology export for one-shot reasoning.

| Command | Operation | Example |
|---|---|---|
| `graph [path]` | Complete semantic graph — nodes, edges, and field-level data flow | `satsuma graph pipeline.stm --json` |

Flags: `--json` (full graph), `--compact` (schema-level adjacency list), `--schema-only` (omit field-level edges), `--namespace <ns>` (filter to namespace), `--no-nl` (strip NL text from edges).

The `schema_edges` array includes edges with roles: `source`, `target`, `metric_source`, and `nl_ref`. The `nl_ref` role marks schemas referenced in NL text but not declared in the mapping's source/target list — these represent data dependencies discovered through NL analysis. Fragments do not appear as graph nodes or edges — per ADR-008, fragments are macros whose fields are inlined into consuming schemas before analysis.

### Agent Setup

| Command | Operation | Example |
|---|---|---|
| `agent-reference` | Print the AI Agent Reference — grammar, conventions, CLI guide, and workflow patterns | `satsuma agent-reference` |

Pipe the output into your agent's instructions file (e.g., `satsuma agent-reference > .github/copilot-instructions.md`) or paste it into a conversation. The content is baked into the CLI at build time from `AI-AGENT-REFERENCE.md`.

### Formatting

| Command | Operation | Example |
|---|---|---|
| `fmt [path]` | Format file and its imports (opinionated, zero-config) | `satsuma fmt pipeline.stm` |
| `fmt --check` | Exit 1 if any file would change (for CI) | `satsuma fmt --check pipeline.stm` |
| `fmt --diff` | Print unified diff without writing | `satsuma fmt --diff file.stm` |
| `fmt --stdin` | Read from stdin, write formatted output to stdout | `cat file.stm \| satsuma fmt --stdin` |

The formatter is opinionated and zero-configuration — one canonical style for all Satsuma files. It walks the tree-sitter CST to produce parser-backed, semantics-preserving output. Files with parse errors are skipped with a warning.

Exit codes: `0` = success (or already formatted), `1` = files would change (`--check` mode), `2` = parse errors.

### Structural Analysis

Operations that check or compare workspace structure.

| Command | Operation | Example |
|---|---|---|
| `validate [path]` | Parse errors and semantic reference checks | `satsuma validate pipeline.stm` |
| `lint [path]` | Policy and convention checks with optional autofix | `satsuma lint pipeline.stm --json` |
| `diff <a> <b>` | Structural comparison of two Satsuma files | `satsuma diff v1.stm v2.stm` |

### validate vs lint

`validate` checks **structural correctness**: parse errors, undefined references, missing schemas. It answers "is this workspace well-formed?"

`lint` checks **policy and conventions**: duplicate definitions, hidden schema dependencies in NL text, unresolved NL `@ref` references. It answers "does this workspace follow best practices?" Some lint rules support `--fix` for safe, deterministic autofix.

Flags: `--json` (structured output), `--fix` (apply safe fixes), `--select <rules>` / `--ignore <rules>` (filter rules), `--quiet` (exit code only), `--rules` (list available rules).

| Rule | Severity | Fixable | Description |
|---|---|---|---|
| `hidden-source-in-nl` | error | yes | NL text references a schema not in the mapping's source/target list |
| `unresolved-nl-ref` | warning | no | `@ref` in NL does not resolve to any known identifier |
| `duplicate-definition` | error | no | Named definition is declared more than once in a namespace |

## Transform Classification

Every arrow the CLI returns carries a classification:

| Classification | Meaning |
|---|---|
| `none` | No transform body (bare `src -> tgt`) |
| `nl` | Transform body present — all pipe step content is natural language |
| `nl-derived` | Implicit arrow inferred from an `@ref` in NL — not declared in any mapping |

All pipe steps — bare tokens like `trim`, quoted strings, and map literals — are natural language interpreted by a human or LLM. The classification is a simple presence check: any transform body → `nl`, no body → `none`. `nl-derived` arrows are synthetic: they are created when an NL `@ref` (e.g., `@schema.field`) resolves to a known field, and they carry `derived: true` with `transform_raw: "(NL ref)"`.

## field-lineage

`satsuma field-lineage <schema.field>` traces the full upstream and downstream lineage of a single field in one command, following both declared arrows and NL-derived references.

```
satsuma field-lineage sat_customer_demographics.loyalty_tier
satsuma field-lineage sat_customer_demographics.loyalty_tier --upstream
satsuma field-lineage sat_customer_demographics.loyalty_tier --downstream
satsuma field-lineage sat_customer_demographics.loyalty_tier --json
```

JSON output shape:

```json
{
  "field": "::schema.field",
  "upstream":   [{ "field": "::src.f", "via_mapping": "::m", "classification": "none" }, ...],
  "downstream": [{ "field": "::tgt.f", "via_mapping": "::m", "classification": "none" }, ...]
}
```

Flags: `--upstream` (upstream chain only), `--downstream` (downstream chain only), `--depth <n>` (limit traversal depth, default 10), `--json` (structured output).

Namespace-qualified fields work: `satsuma field-lineage pos::stores.STORE_ID --json`.

Cycles are handled gracefully — each field is visited at most once. NL-derived references (`@schema.field` in transform strings) are followed as implicit lineage edges.

## Common Flags

| Flag | Purpose |
|---|---|
| `--json` | Structured JSON output — the primary agent interface |
| `--help` | What the command does and what it does not do |

### Per-command flags

| Flag | Available on | Purpose |
|---|---|---|
| `--compact` | `summary`, `schema`, `metric`, `mapping`, `find`, `lineage`, `context`, `graph` | Minimal output, omitting notes, NL strings, and transform bodies |

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Not found or no results |
| 2 | Parse error or filesystem error |

## How Agents Use the CLI

The CLI is a set of structural primitives the agent composes into workflows. The agent — not the CLI — performs higher-level analysis like impact tracing, coverage assessment, and audit.

### Impact analysis

```bash
# 1. Get arrows from the source field
satsuma arrows loyalty_sfdc.LoyaltyTier --as-source --json

# 2. Follow the chain — call arrows again on each target
satsuma arrows sat_customer_demographics.loyalty_tier --as-source --json

# 3. When a hop is classified [nl], read the NL content
satsuma nl mart_customer_360.loyalty_tier

# 4. Agent interprets the NL, discovers implicit dependencies,
#    and calls arrows again to chase them
```

### Coverage assessment

```bash
# 1. Which target fields have no arrows from this mapping?
satsuma fields mart_customer_360 --unmapped-by "demographics to mart" --json

# 2. Repeat for other mappings targeting the same schema
satsuma fields mart_customer_360 --unmapped-by "online to mart" --json

# 3. Agent intersects results to find fields unmapped by ALL mappings
# 4. For mapped fields, agent checks arrow classification via satsuma arrows
```

### PII audit

```bash
# 1. Find all PII-tagged fields
satsuma find --tag pii --json

# 2. For each, trace outbound arrows
satsuma arrows loyalty_sfdc.Email --as-source --json

# 3. Recurse downstream
satsuma arrows sat_customer_demographics.email --as-source --json

# 4. At [nl] hops, agent reads the NL to judge whether PII survives
satsuma nl mart_customer_360.email
```

### Drafting a new mapping

```bash
# 1. Deterministic name matches between source and target
satsuma match-fields --source loyalty_sfdc --target sat_customer_demographics --json

# 2. Agent reads NL notes on both schemas to verify matches
satsuma nl loyalty_sfdc
satsuma nl sat_customer_demographics

# 3. Agent reads metadata to understand constraints
satsuma meta sat_customer_demographics.country_code

# 4. Agent writes the mapping, applying its own judgment
```

### Whole-workspace reasoning (single load)

```bash
# 1. Load the full workspace graph in one call
satsuma graph platform.stm --json > workspace.json

# 2. Agent has all nodes, edges, and field-level data flow
#    — impact analysis, PII audit, coverage check without round-trips
#    — schema_edges for topology, edges for field-level detail
#    — unresolved_nl section surfaces all NL arrows for interpretation

# 3. For large workspaces, narrow the scope:
satsuma graph platform.stm --json --namespace warehouse
satsuma graph platform.stm --json --schema-only    # topology only
satsuma graph platform.stm --json --no-nl          # smaller payload
```

### Reviewing a change

```bash
# 1. Structural diff
satsuma diff main-branch.stm feature-branch.stm --json

# 2. For changed fields, check downstream arrows
satsuma arrows changed_schema.changed_field --as-source --json

# 3. Agent reads NL on affected arrows to assess semantic impact
```

## What the CLI Does Not Do

- **Does not interpret NL.** Transform strings, notes, and comments are extracted verbatim. The CLI never assesses whether an NL transform is correct, complete, or semantically equivalent to another.
- **Does not compose analysis workflows.** There are no `impact`, `coverage`, `audit`, `scaffold`, or `inventory` commands. These are agent workflows built from primitives — their correctness depends on NL interpretation that the CLI cannot perform.
- **Does not call language models.** The CLI is deterministic, fast, and reproducible. Same input, same output, every time.
- **Does not accept NL queries.** Commands take explicit structural arguments. The agent decides which commands to call based on the user's question.

## Source

- CLI source: `tooling/satsuma-cli/`
- Tree-sitter grammar: `tooling/tree-sitter-satsuma/`
- Feature 09 (workspace extractors): `features/09-stm-cli-llm-context/`
- Feature 10 (structural primitives): `features/10-stm-cli-enhancements/`
