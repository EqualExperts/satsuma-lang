# Exploratory Testing: `satsuma graph`

## Context

You are an exploratory QA agent for the Satsuma CLI. Your job is to thoroughly test the `satsuma graph` subcommand, find bugs, and log them as tickets. **Do not fix any bugs — only report them.**

## Setup

1. Read these files to understand the language and CLI contract:
   - `AI-AGENT-REFERENCE.md` — compact grammar and conventions reference
   - `SATSUMA-CLI.md` — full CLI command reference
   - `docs/developer/SATSUMA-V2-SPEC.md` — authoritative language specification
2. Read the `satsuma graph --help` output.
3. Review existing open bug tickets with `tk list` to avoid duplicating known issues.
4. Explore the `examples/` folder for workspaces with schemas, mappings, and metrics.

## What to test

`satsuma graph [file.stm]` exports the complete workspace semantic graph — nodes, edges, and field-level data flow.

Test areas:
- **`--json` flag**: Full graph output. Valid JSON? Contains nodes (schemas, mappings, metrics, fragments, transforms), edges (field-level with classification), and schema-level topology?
- **`--compact` flag**: Flat schema-level adjacency list. Correct? Matches the full graph's topology?
- **`--schema-only` flag**: Omit field-level edges. Only schema-level topology remains?
- **`--namespace <ns>` flag**: Filter to a specific namespace. Only nodes in that namespace? What about cross-namespace edges?
- **`--no-nl` flag**: Strip NL text from edges. Reduces payload size? All NL content removed?
- **Flag combinations**: `--json --schema-only --no-nl`, `--json --namespace crm --no-nl`, etc.
- **Node completeness**: All schemas, mappings, metrics, fragments, transforms present as nodes?
- **Edge completeness**: Every arrow in every mapping represented as an edge? Field-level data flow correct?
- **Edge classification**: Transform classifications on edges match what `satsuma arrows` reports?
- **`unresolved_nl` section**: NL arrows listed for agent interpretation? Note: this section name may be misleading — it contains ALL NL content, not just unresolved refs.
- **Schema-level edges**: `schema_edges` section correctly represents which schemas are connected via mappings?
- **Metric connections**: Metrics connected to their source schemas?
- **Fragment connections**: Fragment spreads create connections?
- **Import handling**: Cross-file imports correctly wired?
- **Namespace-qualified names**: Nodes use correct namespace-qualified names?
- **Empty workspace**: No `.stm` files. Output?
- **Single file**: `satsuma graph examples/sfdc-to-snowflake/pipeline.stm --json`.
- **Large workspace**: Entry file that imports from many files (e.g. `examples/namespaces/ns-platform.stm`). Performance? Completeness?
- **Disconnected nodes**: Schemas with no mappings. Present as isolated nodes?
- **Self-referencing**: Mapping where source and target are the same schema.
- **Derived arrows**: `-> tgt` arrows in graph edges.
- **@ref edges (nl_ref role)**: NL transforms with `@other_schema` refs should create `nl_ref` role entries in `schema_edges`. Do they?
- **@ref in each/flatten blocks**: Do @refs inside each/flatten NL transforms create graph edges? Or are they invisible?
- **@ref vs --no-nl**: Does `--no-nl` strip NL text but preserve `nl_ref` edges (since they're structural)?
- **@ref vs --schema-only**: Are `nl_ref` edges preserved in schema-only mode?
- **Namespaced mapping edge duplication**: In `--schema-only` mode, do namespaced mappings produce duplicate edges (one with bare name, one with qualified name)?
- **Edge classification accuracy**: Do `mixed` classifications match what `satsuma arrows` reports? Test with transforms that have both structural and NL tokens in the same pipe step.
- **Source join description NL**: `source { a, b, "join on @a.id = @b.id" }` — does graph capture this NL content and its @refs?
- **@ref in note blocks**: @refs in schema/metric/standalone notes — do they produce graph edges?

## Creating test fixtures

Create all temporary test files under `/tmp/satsuma-test-graph/`. Build multi-file workspaces with complex topologies.

## Logging bugs

When you find a bug:
1. Check `tk list` for existing tickets describing the same issue.
2. If no duplicate exists, create a ticket:
   ```bash
   tk create "graph: <concise bug title>" \
     -t bug \
     -d "<detailed description including:
     - What you did (exact command)
     - What you expected
     - What actually happened (paste actual output)
     - Path to the test file that reproduces it>"
   ```
3. Tag it with `--tags cli,graph,exploratory-testing`.

## Rules

- **Do not fix bugs.** Only log them.
- **Do not modify any existing files** in the repo. Only create files in `/tmp/`.
- Be systematic and paste actual CLI output in tickets.
