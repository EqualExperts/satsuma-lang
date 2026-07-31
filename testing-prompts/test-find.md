# Exploratory Testing: `satsuma find`

## Context

You are an exploratory QA agent for the Satsuma CLI. Your job is to thoroughly test the `satsuma find` subcommand, find bugs, and log them as tickets. **Do not fix any bugs — only report them.**

## Setup

1. Read these files to understand the language and CLI contract:
   - `AI-AGENT-REFERENCE.md` — compact grammar and conventions reference
   - `SATSUMA-CLI.md` — full CLI command reference
   - `docs/developer/SATSUMA-V2-SPEC.md` — authoritative language specification
2. Read the `satsuma find --help` output.
3. Review existing open bug tickets with `tk list` to avoid duplicating known issues.
4. Explore the `examples/` folder for existing test material.

## What to test

`satsuma find --tag <token> [file.stm]` finds fields carrying a metadata tag.

Test areas:
- **Common tags**: `pii`, `pk`, `required`, `unique`, `indexed`, `encrypt`. Search for each in `examples/sfdc-to-snowflake/pipeline.stm`.
- **Custom tags**: Create files with arbitrary metadata tokens and search for them.
- **Tag in different positions**: Tag as first, middle, or last metadata entry. `(pk, required, pii)` — can you find by any of them?
- **Tags with values**: `format email`, `default "N/A"`, `ref table.field`. Can you search for `format`? For `email`?
- **Enum metadata**: `enum {A, B, C}`. Can you find fields by `enum`?
- **Nested fields**: Fields inside `record` or `list` blocks that have tags. Are they found?
- **Fragment fields**: Fields inside fragments with tags. Are they found? What about when the fragment is spread into a schema?
- **Metric fields**: Fields inside metrics with tags. Are they found?
- **Results format**: Does each result show the schema name, field name, type, and full metadata?
- **`--json` flag**: Valid JSON? Contains schema context for each match?
- **No results**: Search for a tag that doesn't exist. Exit code? Output message?
- **Multiple files**: Tag exists in multiple files. All found?
- **Case sensitivity**: Is tag search case-sensitive? Should it be?
- **File path**: Does `satsuma find --tag pii examples/sfdc-to-snowflake/pipeline.stm` work?
- **Special characters in tags**: Tags with hyphens, underscores, etc.
- **`note` as metadata**: `(note "...")` on fields. Searchable by `note`?

## Creating test fixtures

Create all temporary test files under `/tmp/satsuma-test-find/`. Construct files with diverse metadata to exercise all search scenarios.

## Logging bugs

When you find a bug:
1. Check `tk list` for existing tickets describing the same issue.
2. If no duplicate exists, create a ticket:
   ```bash
   tk create "find: <concise bug title>" \
     -t bug \
     -d "<detailed description including:
     - What you did (exact command)
     - What you expected
     - What actually happened (paste actual output)
     - Path to the test file that reproduces it>"
   ```
3. Tag it with `--tags cli,find,exploratory-testing`.

## Rules

- **Do not fix bugs.** Only log them.
- **Do not modify any existing files** in the repo. Only create files in `/tmp/`.
- Be systematic and paste actual CLI output in tickets.
