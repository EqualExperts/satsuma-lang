# Exploratory Testing: `satsuma nl-refs`

## Context

You are an exploratory QA agent for the Satsuma CLI. Your job is to thoroughly test the `satsuma nl-refs` subcommand, find bugs, and log them as tickets. **Do not fix any bugs — only report them.**

## Setup

1. Read these files to understand the language and CLI contract:
   - `AI-AGENT-REFERENCE.md` — compact grammar and conventions reference
   - `SATSUMA-CLI.md` — full CLI command reference
   - `docs/developer/SATSUMA-V2-SPEC.md` — authoritative language specification
2. Read the `satsuma nl-refs --help` output.
3. Review existing open bug tickets with `tk list` to avoid duplicating known issues.
4. Explore the `examples/` folder for files with NL content containing `@ref` references.

## What to test

`satsuma nl-refs [file.stm]` extracts `@ref` references from NL transform bodies.

Note: Backtick refs in NL strings are no longer valid Satsuma v2 syntax. All NL references use `@ref` syntax (e.g., `@schema.field`). Backticks are only for identifiers/labels (e.g., `` `My Schema` ``).

Test areas:

### @ref extraction
- **Basic @ref**: `"Sum @line_amount grouped by @order_id"`. Both @refs extracted?
- **@ref with dot-qualified names**: `@schema.field` — extracted and resolved?
- **@ref with nested paths (3+ segments)**: `@schema.record.subfield` — resolved against nested record structure?
- **Multiple @refs in one string**: `"Join @orders.id with @customers.customer_id"` — all extracted?
- **@ref in each/flatten blocks**: NL inside `each` or `flatten` block transforms — are @refs found?
- **@ref in standalone note blocks**: `note { "References @some_schema" }` at file level — extracted?
- **@ref in schema/metric/fragment notes**: `note { "Based on @source.field" }` inside a schema body — extracted?
- **@ref in source join descriptions**: `source { a, b, "Join on @a.id = @b.id" }` — @refs found?
- **@ref in named transforms**: `transform t { "Look up @lookup.code" }` — extracted with transform context?
- **@ref in triple-quoted strings**: `"""Multi-line with @some_ref"""` — tracked?
- **@ref resolution status**: Does output indicate resolved vs unresolved for @refs?
- **@ref to non-existent schema**: `@nonexistent.field` — flagged as unresolved?

### General
- **No refs at all**: NL content without any references. Exit code? Output?
- **`--json` flag**: Valid JSON? Each ref includes: the reference text, the containing block, file, line?
- **Resolution status**: Does output indicate whether each ref resolves to a known identifier?
- **Cross-file**: Refs across multiple files all collected?
- **Single file path**: Works with a single file argument?
- **Ref in mapping vs schema vs metric**: Refs in different block types. Context preserved?
- **Duplicate refs**: Same @ref reference appears multiple times. All occurrences listed?
- **Namespace-qualified @refs**: `@ns::schema.field` — extracted and resolved?

## Creating test fixtures

Create all temporary test files under `/tmp/satsuma-test-nl-refs/`. Construct files with diverse `@ref` patterns in NL content across all block types.

## Logging bugs

When you find a bug:
1. Check `tk list` for existing tickets describing the same issue.
2. If no duplicate exists, create a ticket:
   ```bash
   tk create "nl-refs: <concise bug title>" \
     -t bug \
     -d "<detailed description including:
     - What you did (exact command)
     - What you expected
     - What actually happened (paste actual output)
     - Path to the test file that reproduces it>"
   ```
3. Tag it with `--tags cli,nl-refs,exploratory-testing`.

## Rules

- **Do not fix bugs.** Only log them.
- **Do not modify any existing files** in the repo. Only create files in `/tmp/`.
- Be systematic and paste actual CLI output in tickets.
