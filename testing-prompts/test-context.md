# Exploratory Testing: `satsuma context`

## Context

You are an exploratory QA agent for the Satsuma CLI. Your job is to thoroughly test the `satsuma context` subcommand, find bugs, and log them as tickets. **Do not fix any bugs — only report them.**

## Setup

1. Read these files to understand the language and CLI contract:
   - `AI-AGENT-REFERENCE.md` — compact grammar and conventions reference
   - `SATSUMA-CLI.md` — full CLI command reference
   - `docs/developer/SATSUMA-V2-SPEC.md` — authoritative language specification
2. Read the `satsuma context --help` output.
3. Review existing open bug tickets with `tk list` to avoid duplicating known issues.
4. Explore the `examples/` folder for test material.

## What to test

`satsuma context <query> [file.stm]` performs keyword-ranked block extraction (heuristic).

Test areas:
- **Basic keyword matching**: Query for schema names, field names, or terms that appear in notes. Relevant blocks returned?
- **Ranking**: When multiple blocks match, are the most relevant ranked higher?
- **Schema matches**: Query that matches a schema name. Schema block returned?
- **Mapping matches**: Query for a mapping-related term. Mapping block returned?
- **Metric matches**: Query for a metric. Metric block returned?
- **Note content matching**: Query for text that appears inside `note { }` blocks. Found?
- **Comment matching**: Query for text in `//`, `//!`, `//?` comments. Found?
- **NL transform matching**: Query for text inside NL transform strings. Found?
- **Multi-word queries**: `"customer mapping"` — does it match blocks containing both words?
- **Partial word matching**: Query for `cust` when schemas contain `customer`. Matched?
- **No matches**: Query for something completely unrelated. Exit code? Message?
- **`--json` flag**: Valid JSON with ranked blocks and scores?
- **`--compact` flag**: What gets omitted?
- **Case sensitivity**: Is query matching case-insensitive?
- **Cross-file results**: Results from multiple files. Correctly ranked?
- **Single file**: `satsuma context "customer" examples/sfdc-to-snowflake/pipeline.stm`.
- **Empty query**: What happens with an empty string?
- **Special characters in query**: Queries with dots, backticks, quotes.

## Creating test fixtures

Create all temporary test files under `/tmp/satsuma-test-context/`. Build files with varied content to test ranking behavior.

## Logging bugs

When you find a bug:
1. Check `tk list` for existing tickets describing the same issue.
2. If no duplicate exists, create a ticket:
   ```bash
   tk create "context: <concise bug title>" \
     -t bug \
     -d "<detailed description including:
     - What you did (exact command)
     - What you expected
     - What actually happened (paste actual output)
     - Path to the test file that reproduces it>"
   ```
3. Tag it with `--tags cli,context,exploratory-testing`.

## Rules

- **Do not fix bugs.** Only log them.
- **Do not modify any existing files** in the repo. Only create files in `/tmp/`.
- Be systematic and paste actual CLI output in tickets.
