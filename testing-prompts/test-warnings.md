# Exploratory Testing: `satsuma warnings`

## Context

You are an exploratory QA agent for the Satsuma CLI. Your job is to thoroughly test the `satsuma warnings` subcommand, find bugs, and log them as tickets. **Do not fix any bugs — only report them.**

## Setup

1. Read these files to understand the language and CLI contract:
   - `AI-AGENT-REFERENCE.md` — compact grammar and conventions reference
   - `SATSUMA-CLI.md` — full CLI command reference
   - `docs/developer/SATSUMA-V2-SPEC.md` — authoritative language specification
2. Read the `satsuma warnings --help` output.
3. Review existing open bug tickets with `tk list` to avoid duplicating known issues.
4. Explore the `examples/` folder for files containing `//!` and `//?` comments.

## What to test

`satsuma warnings [file.stm]` lists all `//!` and `//?` comments across the workspace.

Test areas:
- **`//!` comments**: Warning comments. All found across workspace?
- **`//?` comments**: Question/todo comments. All found?
- **Regular `//` comments**: Should NOT be included. Verify they're excluded.
- **Comment locations**: Inside schemas, mappings, metrics, at file level. All locations captured?
- **Comment context**: Does output show which block (schema/mapping/metric) the comment is in?
- **Multi-file workspace**: Comments from all files collected?
- **`--json` flag**: Valid JSON? Includes file, line, type (warning vs question), and context?
- **No warnings**: Workspace with only regular `//` comments. Exit code? Output?
- **Empty workspace**: No `.stm` files. Behavior?
- **Inline comments on fields**: `field_name TYPE (meta) //! watch out`. Found?
- **Comments with special characters**: Unicode, quotes, backticks in comment text.
- **Adjacent comments**: Multiple `//!` lines in a row. Each listed separately?
- **Comment after metadata**: `field TYPE (pk) //? is this right`. Correctly parsed?
- **Single file**: `satsuma warnings examples/sfdc-to-snowflake/pipeline.stm`.
- **Long comment text**: Very long `//!` comments. Truncated or complete?

## Creating test fixtures

Create all temporary test files under `/tmp/satsuma-test-warnings/`. Include diverse comment placements and edge cases.

## Logging bugs

When you find a bug:
1. Check `tk list` for existing tickets describing the same issue.
2. If no duplicate exists, create a ticket:
   ```bash
   tk create "warnings: <concise bug title>" \
     -t bug \
     -d "<detailed description including:
     - What you did (exact command)
     - What you expected
     - What actually happened (paste actual output)
     - Path to the test file that reproduces it>"
   ```
3. Tag it with `--tags cli,warnings,exploratory-testing`.

## Rules

- **Do not fix bugs.** Only log them.
- **Do not modify any existing files** in the repo. Only create files in `/tmp/`.
- Be systematic and paste actual CLI output in tickets.
