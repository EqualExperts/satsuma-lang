# Exploratory Testing: `satsuma meta`

## Context

You are an exploratory QA agent for the Satsuma CLI. Your job is to thoroughly test the `satsuma meta` subcommand, find bugs, and log them as tickets. **Do not fix any bugs — only report them.**

## Setup

1. Read these files to understand the language and CLI contract:
   - `AI-AGENT-REFERENCE.md` — compact grammar and conventions reference
   - `SATSUMA-CLI.md` — full CLI command reference
   - `docs/developer/SATSUMA-V2-SPEC.md` — authoritative language specification
2. Read the `satsuma meta --help` output.
3. Review existing open bug tickets with `tk list` to avoid duplicating known issues.
4. Explore the `examples/` folder for schemas with varied metadata.

## What to test

`satsuma meta <scope> [file.stm]` extracts metadata for a schema, field, mapping, or metric.

Test areas:
- **Schema metadata**: `satsuma meta schema_name`. Schema-level metadata in `()`.
- **Field metadata**: `satsuma meta schema_name.field_name`. Field-level metadata.
- **Mapping metadata**: `satsuma meta 'mapping name'`. Mapping-level metadata.
- **Metric metadata**: `satsuma meta metric_name`. Metric-level metadata including `source`, `grain`, `slice`, `filter`.
- **All tag types**: `pk`, `required`, `unique`, `indexed`, `pii`, `encrypt`, `encrypt AES-256-GCM`.
- **Tags with values**: `default "value"`, `format email`, `ref table.field`.
- **Enum metadata**: `enum {A, B, C}`. Shown correctly?
- **Note metadata**: `note "..."`. Extracted?
- **Xpath metadata**: `xpath "..."`. Extracted?
- **Namespace metadata**: `namespace prefix "uri"`. Extracted?
- **Filter metadata**: `filter "condition"`. Extracted?
- **Multiple metadata entries**: `(pk, required, pii, note "important")`. All shown?
- **Nested field metadata**: Metadata on fields inside `record` or `list` blocks.
- **Arrow metadata**: `src -> tgt (note "transform note")`. Can you query arrow metadata?
- **`--json` flag**: Valid JSON with key-value pairs for all metadata?
- **No metadata**: Schema or field with no metadata. Exit code? Output?
- **Scope not found**: Non-existent scope. Exit code?
- **Metric-specific metadata entries**: `source`, `grain`, `slice`, `filter`. All extracted?
- **Backtick field names**: `satsuma meta schema.\`field-name\``.
- **Namespace-qualified scopes**: `satsuma meta crm::schema.field`.

## Creating test fixtures

Create all temporary test files under `/tmp/satsuma-test-meta/`. Construct files with every metadata type on schemas, fields, mappings, and metrics.

## Logging bugs

When you find a bug:
1. Check `tk list` for existing tickets describing the same issue.
2. If no duplicate exists, create a ticket:
   ```bash
   tk create "meta: <concise bug title>" \
     -t bug \
     -d "<detailed description including:
     - What you did (exact command)
     - What you expected
     - What actually happened (paste actual output)
     - Path to the test file that reproduces it>"
   ```
3. Tag it with `--tags cli,meta,exploratory-testing`.

## Rules

- **Do not fix bugs.** Only log them.
- **Do not modify any existing files** in the repo. Only create files in `/tmp/`.
- Be systematic and paste actual CLI output in tickets.
