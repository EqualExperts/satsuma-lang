# Exploratory Testing: `satsuma diff`

## Context

You are an exploratory QA agent for the Satsuma CLI. Your job is to thoroughly test the `satsuma diff` subcommand, find bugs, and log them as tickets. **Do not fix any bugs — only report them.**

## Setup

1. Read these files to understand the language and CLI contract:
   - `AI-AGENT-REFERENCE.md` — compact grammar and conventions reference
   - `SATSUMA-CLI.md` — full CLI command reference
   - `docs/developer/SATSUMA-V2-SPEC.md` — authoritative language specification
2. Read the `satsuma diff --help` output.
3. Review existing open bug tickets with `tk list` to avoid duplicating known issues.
4. Explore the `examples/` folder for test material.

## What to test

`satsuma diff <a.stm> <b.stm>` performs structural comparison of two Satsuma entry files.

Test areas:
- **Identical files**: Diff a file against itself. No differences?
- **Added schema**: File B has an extra schema not in A. Shown as addition?
- **Removed schema**: File A has a schema not in B. Shown as removal?
- **Modified schema - added field**: Same schema, but B has an extra field. Shown as field addition?
- **Modified schema - removed field**: Field in A not in B. Shown as field removal?
- **Modified schema - changed type**: Same field, different type. Shown as type change?
- **Modified schema - changed metadata**: Same field, different metadata. Shown?
- **Added mapping**: New mapping in B.
- **Removed mapping**: Mapping in A not in B.
- **Modified mapping - added arrow**: New arrow in the same mapping.
- **Modified mapping - removed arrow**: Arrow in A not in B.
- **Modified mapping - changed transform**: Same arrow, different transform body.
- **Added/removed metric**: Metric changes.
- **Added/removed fragment**: Fragment changes.
- **Multi-file diff**: Compare two entry files that import from multiple files. Are transitive imports included?
- **File vs file**: Compare two individual `.stm` files.
- **Directory argument**: What happens if you pass a directory instead of a `.stm` file? Expected error?
- **`--json` flag**: Valid JSON with structured change records?
- **Renamed schema**: Schema with same fields but different name. Detected as rename or add+remove?
- **Reordered fields**: Same fields in different order. Shown as change or identical?
- **Changed comments**: Only comment changes. Structural diff or ignored?
- **Changed notes**: Note content changes. Shown?
- **Non-existent path**: One path doesn't exist. Error handling?
- **Empty files**: One or both files empty.
- **Namespace changes**: Schema moved to a different namespace.

## Creating test fixtures

Create all temporary test files under `/tmp/satsuma-test-diff/`. Create pairs of files/directories representing "before" and "after" states with various types of changes.

## Logging bugs

When you find a bug:
1. Check `tk list` for existing tickets describing the same issue.
2. If no duplicate exists, create a ticket:
   ```bash
   tk create "diff: <concise bug title>" \
     -t bug \
     -d "<detailed description including:
     - What you did (exact command)
     - What you expected
     - What actually happened (paste actual output)
     - Paths to the test files that reproduce it>"
   ```
3. Tag it with `--tags cli,diff,exploratory-testing`.

## Rules

- **Do not fix bugs.** Only log them.
- **Do not modify any existing files** in the repo. Only create files in `/tmp/`.
- Be systematic and paste actual CLI output in tickets.
