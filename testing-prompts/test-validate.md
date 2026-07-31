# Exploratory Testing: `satsuma validate`

## Context

You are an exploratory QA agent for the Satsuma CLI. Your job is to thoroughly test the `satsuma validate` subcommand, find bugs, and log them as tickets. **Do not fix any bugs — only report them.**

## Setup

1. Read these files to understand the language and CLI contract:
   - `AI-AGENT-REFERENCE.md` — compact grammar and conventions reference
   - `SATSUMA-CLI.md` — full CLI command reference
   - `docs/developer/SATSUMA-V2-SPEC.md` — authoritative language specification
2. Read the `satsuma validate --help` output.
3. Review existing open bug tickets with `tk list` to avoid duplicating known issues.
4. Explore the `examples/` folder — all examples should validate cleanly.

## What to test

`satsuma validate [file.stm]` checks for parse errors and semantic reference checks. It answers "is this workspace well-formed?"

Test areas:
- **Valid files**: Run against each example entry file (e.g. `examples/sfdc-to-snowflake/pipeline.stm`). Should pass with no errors.
- **Parse errors**: Create files with syntax errors — missing braces, bad keywords, invalid types. Are errors reported with file and line?
- **Undefined schema references**: Mapping references a schema in `source { \`nonexistent\` }`. Caught?
- **Undefined fragment references**: `...nonexistent_fragment`. Caught?
- **Undefined transform references**: `...nonexistent_transform` in mapping body. Caught?
- **Undefined import references**: `import { nonexistent } from "file.stm"`. Caught?
- **Missing import file**: `import { name } from "nonexistent.stm"`. Caught?
- **Duplicate schema names**: Two schemas with the same name in the same namespace. Caught?
- **Metric source validation**: Metric references a non-existent source schema. Caught?
- **Arrow field validation**: Arrow references a field not in the source/target schema. Caught? (Check ticket `sg-u8sh` about fragment spread expansion.)
- **Cross-file validation**: References between files. All resolved?
- **`--json` flag**: Valid JSON with error details including file, line, severity?
- **Exit codes**: 0 for valid, 2 for errors per the CLI docs?
- **Multiple errors**: File with several problems. All reported, or just the first?
- **Partial parse**: File with one valid schema and one broken schema. Both reported?
- **Empty file**: `.stm` file with no content. Error or valid?
- **Non-`.stm` files**: Directory containing `.txt` files alongside `.stm` files. Only `.stm` parsed?
- **Namespace validation**: Invalid namespace syntax. Caught?
- **Import cycle detection**: Circular imports. Handled gracefully?
- **Ref metadata validation**: `(ref nonexistent.field)`. Is the reference checked?
- **@ref resolution in NL**: `"Sum @line_amount grouped by @order_id"` — are @refs validated against known schemas/fields?
- **@ref with nested dot paths**: `@schema.record.subfield` (3+ segments) — correctly resolved against nested record structures?
- **@ref in each/flatten blocks**: NL with @refs inside each/flatten — are they validated?
- **@ref in standalone notes**: `note { "References @some_schema" }` — are @refs in top-level notes validated?
- **@ref in source join descriptions**: `source { a, b, "Join on @a.id = @b.id" }` — are these @refs validated?
- **Duplicate definitions across files**: Two files define the same mapping name. Does validate produce false field-not-in-schema warnings due to schema resolution confusion?
- **False warning with cross-file duplicates**: When `mapping "order headers"` exists in two files with different source schemas, does validate attribute arrow fields to the wrong source schema?

## Creating test fixtures

Create all temporary test files under `/tmp/satsuma-test-validate/`. Create a mix of valid, partially invalid, and completely broken files.

## Logging bugs

When you find a bug:
1. Check `tk list` for existing tickets describing the same issue.
2. If no duplicate exists, create a ticket:
   ```bash
   tk create "validate: <concise bug title>" \
     -t bug \
     -d "<detailed description including:
     - What you did (exact command)
     - What you expected
     - What actually happened (paste actual output)
     - Path to the test file that reproduces it>"
   ```
3. Tag it with `--tags cli,validate,exploratory-testing`.

## Rules

- **Do not fix bugs.** Only log them.
- **Do not modify any existing files** in the repo. Only create files in `/tmp/`.
- Be systematic and paste actual CLI output in tickets.
