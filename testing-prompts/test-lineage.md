# Exploratory Testing: `satsuma lineage`

## Context

You are an exploratory QA agent for the Satsuma CLI. Your job is to thoroughly test the `satsuma lineage` subcommand, find bugs, and log them as tickets. **Do not fix any bugs — only report them.**

## Setup

1. Read these files to understand the language and CLI contract:
   - `AI-AGENT-REFERENCE.md` — compact grammar and conventions reference
   - `SATSUMA-CLI.md` — full CLI command reference
   - `docs/developer/SATSUMA-V2-SPEC.md` — authoritative language specification
2. Read the `satsuma lineage --help` output.
3. Review existing open bug tickets with `tk list` to avoid duplicating known issues.
4. Explore the `examples/` folder — especially `multi-source-hub.stm` and `multi-source-join.stm` for lineage chains.

## What to test

`satsuma lineage --from/--to <schema> [file.stm]` traces data lineage through the workspace.

Test areas:
- **Forward lineage (`--from`)**: Trace from a source schema. Verify all downstream schemas reachable via mappings are listed.
- **Backward lineage (`--to`)**: Trace to a target schema. Verify all upstream sources are listed.
- **Multi-hop chains**: Source → intermediate → target. Are all hops shown?
- **Multi-source mappings**: A mapping with multiple sources. Does lineage correctly trace from each?
- **Diamond dependencies**: Schema A feeds B and C, both feed D. Is the full graph shown?
- **Disconnected schemas**: Schema with no mappings. What happens with `--from`/`--to`?
- **Circular references**: Create a circular mapping chain (A→B→A). Does it handle cycles?
- **Cross-file lineage**: Source in one file, mapping in another, target in a third. Correctly traced?
- **Namespace-qualified schemas**: Lineage through namespaced schemas.
- **Metrics as terminal nodes**: Metrics reference schemas via `source`. Does lineage stop at metrics?
- **`--json` flag**: Valid JSON? Graph structure with nodes and edges?
- **`--compact` flag**: What gets omitted?
- **Both `--from` and `--to`**: What happens if both are specified? Error?
- **Neither `--from` nor `--to`**: What happens? Error message?
- **Non-existent schema**: Exit code and message?
- **Single file**: `satsuma lineage --from schema examples/sfdc-to-snowflake/pipeline.stm`.
- **@ref lineage edges**: Do `@ref` references in NL strings (e.g., `"Join with @other_schema"`) create lineage edges?
- **@ref in NL transforms**: `"Sum @line_amount grouped by @order_id"` — do @refs create lineage edges? These are the primary ref syntax in v2.
- **@ref to undeclared schema**: A mapping's NL transform references `@external_lookup.code` but `external_lookup` is not in source/target. Does lineage show it as an `nl_ref` dependency?
- **@ref with dot-qualified nested paths**: `@schema.record.subfield` (3+ segments) — does lineage resolve nested record paths correctly?
- **@ref in note blocks**: Do @refs in `note { "references @schema" }` create lineage edges? Test standalone notes, schema notes, and mapping-body notes.
- **@ref in source join descriptions**: `source { a, b, "Join on @a.id = @b.id" }` — does lineage track @refs from join NL?
- **@ref in each/flatten blocks**: `each items -> output { .sku -> .code { "Look up @catalog.sku" } }` — does lineage trace through each/flatten NL?
- **Multiple @refs in one NL string**: `"Join @orders.id with @customers.customer_id and lookup @products.sku"` — are all three schemas tracked?
- **Multi-hop @ref lineage**: Schema A maps to B, B maps to C where the NL references @A — does lineage show A as upstream of C?
- **@ref in named transforms**: `transform enricher { "Look up @lookup.code" }` spread into a mapping. Does lineage follow through the spread?

## Creating test fixtures

Create all temporary test files under `/tmp/satsuma-test-lineage/`. Build multi-file workspaces with complex lineage chains, diamonds, and edge cases.

## Logging bugs

When you find a bug:
1. Check `tk list` for existing tickets describing the same issue.
2. If no duplicate exists, create a ticket:
   ```bash
   tk create "lineage: <concise bug title>" \
     -t bug \
     -d "<detailed description including:
     - What you did (exact command)
     - What you expected
     - What actually happened (paste actual output)
     - Path to the test file that reproduces it>"
   ```
3. Tag it with `--tags cli,lineage,exploratory-testing`.

## Rules

- **Do not fix bugs.** Only log them.
- **Do not modify any existing files** in the repo. Only create files in `/tmp/`.
- Be systematic and paste actual CLI output in tickets.
