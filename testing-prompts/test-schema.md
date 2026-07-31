# Exploratory Testing: `satsuma schema`

## Context

You are an exploratory QA agent for the Satsuma CLI. Your job is to thoroughly test the `satsuma schema` subcommand, find bugs, and log them as tickets. **Do not fix any bugs — only report them.**

## Setup

1. Read these files to understand the language and CLI contract:
   - `AI-AGENT-REFERENCE.md` — compact grammar and conventions reference
   - `SATSUMA-CLI.md` — full CLI command reference
   - `docs/developer/SATSUMA-V2-SPEC.md` — authoritative language specification
2. Read the `satsuma schema --help` output.
3. Review existing open bug tickets with `tk list` to avoid duplicating known issues.
4. Explore the `examples/` folder for existing test material.

## What to test

`satsuma schema <name> [file.stm]` shows a full schema definition from the parse tree.

Test areas:
- **Basic retrieval**: Retrieve schemas from `examples/sfdc-to-snowflake/pipeline.stm` by name. Verify output matches the source file content.
- **Quoted labels**: Schemas with labels like `'My Complex Schema'`. Can they be retrieved by their quoted name?
- **Namespace-qualified names**: Retrieve `crm::customers` style names from `examples/namespaces/ns-platform.stm`.
- **Fragment spreads**: Schemas containing `...fragment_name`. Does the output show the spread correctly, or does it expand it? What is the correct behavior per the spec?
- **Nested structures**: Schemas with `record` and `list` blocks. Are they fully rendered?
- **All metadata types**: Fields with `pk`, `required`, `enum {}`, `ref`, `note ""`, `format`, `xpath`, `namespace`, `filter`, etc.
- **All field types**: `INT`, `STRING(200)`, `CHAR(1)`, `UUID`, `BOOLEAN`, `DECIMAL(10,2)`, `DATE`, `TIMESTAMP`, custom types.
- **Comments**: `//`, `//!`, `//?` comments inside schemas. Are they preserved in output?
- **`--json` flag**: Valid JSON? Contains all fields, types, metadata?
- **`--compact` flag**: Omits notes/NL but retains fields and types?
- **Not found**: What happens when the schema name doesn't exist? Exit code?
- **Ambiguous names**: Two schemas with the same name in different files or namespaces. What happens?
- **Case sensitivity**: Is lookup case-sensitive? Should it be?
- **Single file path**: `satsuma schema <name> examples/lib/common.stm` — does the path argument work correctly?
- **Backtick identifiers**: Fields using `` `field-with-dashes` `` syntax.

## Creating test fixtures

Create all temporary test files under `/tmp/satsuma-test-schema/`. Use the grammar from the spec to construct valid and edge-case `.stm` files.

## Logging bugs

When you find a bug:
1. Check `tk list` for existing tickets describing the same issue.
2. If no duplicate exists, create a ticket:
   ```bash
   tk create "schema: <concise bug title>" \
     -t bug \
     -d "<detailed description including:
     - What you did (exact command)
     - What you expected
     - What actually happened (paste actual output)
     - Path to the test file that reproduces it>"
   ```
3. Tag it with `--tags cli,schema,exploratory-testing`.

## Rules

- **Do not fix bugs.** Only log them.
- **Do not modify any existing files** in the repo. Only create files in `/tmp/`.
- Be systematic and paste actual CLI output in tickets.
