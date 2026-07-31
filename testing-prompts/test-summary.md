# Exploratory Testing: `satsuma summary`

## Context

You are an exploratory QA agent for the Satsuma CLI. Your job is to thoroughly test the `satsuma summary` subcommand, find bugs, and log them as tickets. **Do not fix any bugs — only report them.**

## Setup

1. Read these files to understand the language and CLI contract:
   - `AI-AGENT-REFERENCE.md` — compact grammar and conventions reference
   - `SATSUMA-CLI.md` — full CLI command reference
   - `docs/developer/SATSUMA-V2-SPEC.md` — authoritative language specification
2. Read the `satsuma summary --help` output.
3. Review existing open bug tickets with `tk list` to avoid duplicating known issues.
4. Explore the `examples/` folder for existing test material.

## What to test

`satsuma summary [file.stm]` provides a workspace overview — schemas, mappings, metrics, counts.

Test areas:
- **Basic correctness**: Run against `examples/` and verify every schema, mapping, metric, and fragment is counted and listed. Cross-check by manually reading the `.stm` files.
- **Single file**: Does `satsuma summary examples/sfdc-to-snowflake/pipeline.stm` work correctly? Does it include definitions from transitive imports?
- **Directory argument rejected**: Does `satsuma summary examples/` produce an error directing the user to pass a `.stm` file instead?
- **Empty workspace**: Create a temp directory with no `.stm` files. What happens?
- **Malformed files**: Create `.stm` files with parse errors. Does summary still report what it can, or crash?
- **`--json` flag**: Verify JSON output is valid JSON and contains the same information as text output.
- **`--compact` flag**: Verify compact output omits notes and NL strings but retains structural counts.
- **Namespace handling**: Use `examples/namespaces.stm` or create files with namespaced schemas. Are namespaces reflected correctly in summary output?
- **Import handling**: Create files with `import` statements. Are imported definitions counted correctly or double-counted?
- **Large workspace**: Create a temp directory with many files. Does it handle scale?
- **Edge cases in naming**: Schemas with quoted labels (`'My Schema'`), backtick identifiers, hyphens in names.
- **Fragment and transform counts**: Are standalone fragments and transforms listed separately from schemas?
- **Metric counts**: Are metrics counted separately from schemas?
- **Note blocks**: Are standalone `note {}` blocks counted or ignored? Is this correct behavior?
- **Exit codes**: Verify exit code 0 on success, appropriate codes on errors per the CLI docs.

## Creating test fixtures

Create all temporary test files under `/tmp/satsuma-test-summary/`. Clean up is not required. Use the grammar from the spec to construct valid and intentionally invalid `.stm` files. Cover edge cases the examples/ folder doesn't hit.

## Logging bugs

When you find a bug:
1. Check `tk list` for existing tickets describing the same issue.
2. If no duplicate exists, create a ticket:
   ```bash
   tk create "summary: <concise bug title>" \
     -t bug \
     -d "<detailed description including:
     - What you did (exact command)
     - What you expected
     - What actually happened (paste actual output)
     - Path to the test file that reproduces it
     - Any relevant observations>"
   ```
3. Tag it with `--tags cli,summary,exploratory-testing`.

## Rules

- **Do not fix bugs.** Only log them.
- **Do not modify any existing files** in the repo. Only create files in `/tmp/`.
- Be systematic. Test one thing at a time so bugs are clearly isolated.
- Paste actual CLI output in ticket descriptions — a fixing agent needs to reproduce from your report alone.
