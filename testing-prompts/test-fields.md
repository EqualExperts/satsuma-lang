# Exploratory Testing: `satsuma fields`

## Context

You are an exploratory QA agent for the Satsuma CLI. Your job is to thoroughly test the `satsuma fields` subcommand, find bugs, and log them as tickets. **Do not fix any bugs — only report them.**

## Setup

1. Read these files to understand the language and CLI contract:
   - `AI-AGENT-REFERENCE.md` — compact grammar and conventions reference
   - `SATSUMA-CLI.md` — full CLI command reference
   - `docs/developer/SATSUMA-V2-SPEC.md` — authoritative language specification
2. Read the `satsuma fields --help` output.
3. Review existing open bug tickets with `tk list` to avoid duplicating known issues.
4. Explore the `examples/` folder for schemas with varied field structures.

## What to test

`satsuma fields <schema> [file.stm]` lists fields in a schema with types.

Test areas:
- **Basic field listing**: List fields for a schema. Verify all fields present with correct types.
- **Nested fields**: `record` and `list` blocks inside schemas. Are nested fields shown? With hierarchy?
- **Fragment spreads**: Schema with `...fragment_name`. Are spread fields shown? Expanded or just the spread marker?
- **Field types**: All type variants — `INT`, `STRING(200)`, `CHAR(1)`, `UUID`, `BOOLEAN`, `DECIMAL(10,2)`, `DATE`, `TIMESTAMP`, `BYTES`, custom types.
- **Metadata display**: Are field metadata tags shown alongside types?
- **`--unmapped-by <mapping>` flag**: Fields that have no arrow in the specified mapping. This is a critical feature. Test thoroughly:
  - Target fields with arrows → should NOT be listed
  - Target fields without arrows → SHOULD be listed
  - Does it work with quoted mapping names?
  - What if the mapping doesn't exist?
  - What about derived fields (`-> tgt`)? Do they count as mapped?
- **Backtick field names**: Fields like `` `field-with-dashes` ``.
- **`--json` flag**: Valid JSON with field names, types, and metadata?
- **Schema not found**: Exit code and message?
- **Namespace-qualified schema names**: `crm::customers`.
- **Quoted schema names**: `'My Schema'`.
- **Schema vs fragment**: Can you list fields of a fragment? Should you be able to?
- **Metric fields**: Can you list fields of a metric?
- **Large schemas**: Schema with many fields. All listed?
- **Comments between fields**: Are comments excluded from field list?
- **File path**: Specifying a `.stm` entry file.
- **Directory argument rejected**: Specifying a directory instead of a `.stm` file. Expected error?

## Creating test fixtures

Create all temporary test files under `/tmp/satsuma-test-fields/`. Construct schemas with diverse field types and nesting.

## Logging bugs

When you find a bug:
1. Check `tk list` for existing tickets describing the same issue.
2. If no duplicate exists, create a ticket:
   ```bash
   tk create "fields: <concise bug title>" \
     -t bug \
     -d "<detailed description including:
     - What you did (exact command)
     - What you expected
     - What actually happened (paste actual output)
     - Path to the test file that reproduces it>"
   ```
3. Tag it with `--tags cli,fields,exploratory-testing`.

## Rules

- **Do not fix bugs.** Only log them.
- **Do not modify any existing files** in the repo. Only create files in `/tmp/`.
- Be systematic and paste actual CLI output in tickets.
