# Exploratory Testing: `satsuma match-fields`

## Context

You are an exploratory QA agent for the Satsuma CLI. Your job is to thoroughly test the `satsuma match-fields` subcommand, find bugs, and log them as tickets. **Do not fix any bugs — only report them.**

## Setup

1. Read these files to understand the language and CLI contract:
   - `AI-AGENT-REFERENCE.md` — compact grammar and conventions reference
   - `SATSUMA-CLI.md` — full CLI command reference
   - `docs/developer/SATSUMA-V2-SPEC.md` — authoritative language specification
2. Read the `satsuma match-fields --help` output.
3. Review existing open bug tickets with `tk list` to avoid duplicating known issues.
4. Explore the `examples/` folder for schemas that could be matched.

## What to test

`satsuma match-fields --source <s> --target <t> [file.stm]` matches fields between two schemas by normalized name.

Test areas:
- **Exact name matches**: Same field name in source and target. Matched?
- **Case normalization**: `CustomerName` vs `customer_name` vs `CUSTOMER_NAME`. Matched?
- **Underscore/hyphen normalization**: `first_name` vs `first-name` vs `firstName`. Which normalizations are applied?
- **Partial matches**: Should there be partial matching? What does the tool actually do?
- **Unmatched fields**: Fields in source with no match in target, and vice versa. How are they reported?
- **Type comparison**: Does the output show type mismatches for matched fields?
- **Nested fields**: Fields inside `record`/`list` blocks. Are they matched?
- **Fragment spread fields**: Source schema has `...fragment`. Are spread fields available for matching?
- **Backtick field names**: `` `field-with-dashes` `` normalization behavior.
- **`--json` flag**: Valid JSON with matched pairs, unmatched source fields, and unmatched target fields?
- **Source not found**: Non-existent source schema. Exit code? Message?
- **Target not found**: Non-existent target schema. Exit code? Message?
- **Both not found**: Both schemas don't exist. Error message?
- **Same schema as source and target**: Match a schema against itself.
- **Empty schemas**: One or both schemas with no fields.
- **Namespace-qualified schemas**: `crm::customers` as source or target.
- **Quoted schema names**: `'My Schema'` as source or target.
- **Large schemas**: Many fields — performance and completeness.
- **Missing --source or --target**: What happens if you omit one?
- **Field with same normalized name but different types**: Reported with type info?

## Creating test fixtures

Create all temporary test files under `/tmp/satsuma-test-match-fields/`. Construct pairs of schemas with varying degrees of field name similarity.

## Logging bugs

When you find a bug:
1. Check `tk list` for existing tickets describing the same issue.
2. If no duplicate exists, create a ticket:
   ```bash
   tk create "match-fields: <concise bug title>" \
     -t bug \
     -d "<detailed description including:
     - What you did (exact command)
     - What you expected
     - What actually happened (paste actual output)
     - Path to the test file that reproduces it>"
   ```
3. Tag it with `--tags cli,match-fields,exploratory-testing`.

## Rules

- **Do not fix bugs.** Only log them.
- **Do not modify any existing files** in the repo. Only create files in `/tmp/`.
- Be systematic and paste actual CLI output in tickets.
