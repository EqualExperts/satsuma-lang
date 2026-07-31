# Exploratory Testing: `satsuma lint`

## Context

You are an exploratory QA agent for the Satsuma CLI. Your job is to thoroughly test the `satsuma lint` subcommand, find bugs, and log them as tickets. **Do not fix any bugs — only report them.**

## Setup

1. Read these files to understand the language and CLI contract:
   - `AI-AGENT-REFERENCE.md` — compact grammar and conventions reference
   - `SATSUMA-CLI.md` — full CLI command reference
   - `docs/developer/SATSUMA-V2-SPEC.md` — authoritative language specification
2. Read the `satsuma lint --help` output and `satsuma lint --rules` to see available lint rules.
3. Review existing open bug tickets with `tk list` to avoid duplicating known issues. Note especially `sl-04pv` about `hidden-source-in-nl`.
4. Explore the `examples/` folder for test material.

## What to test

`satsuma lint [file.stm]` checks policy and convention rules. It answers "does this workspace follow best practices?"

Known lint rules (from SATSUMA-CLI.md):
- `hidden-source-in-nl` (warning, fixable) — NL text references a schema not in the mapping's source/target list
- `unresolved-nl-ref` (warning, not fixable) — `@ref` in NL does not resolve to any known identifier
- `duplicate-definition` (error, not fixable) — Named definition declared more than once in a namespace

Test areas:
- **`hidden-source-in-nl`**: Create a mapping where NL text references `@other_schema` but `other_schema` is not in source/target. Does the rule fire?
- **`unresolved-nl-ref`**: Create NL text with `@nonexistent_thing` — does the rule fire?
- **`duplicate-definition`**: Create two schemas with the same name. Does the rule fire?
- **`--fix` flag**: For fixable rules, does `--fix` apply corrections? What does it change? (Test on copies in `/tmp/`.)
- **`--json` flag**: Valid JSON with rule ID, severity, message, file, line?
- **`--quiet` flag**: Only exit code, no output?
- **`--select <rules>`**: Filter to run only specific rules. Works?
- **`--ignore <rules>`**: Exclude specific rules. Works?
- **`--rules` flag**: Lists available rules with descriptions?
- **Clean workspace**: Run against `examples/sfdc-to-snowflake/pipeline.stm`. Should be clean (no warnings). If not, note what fires.
- **Exit codes**: What exit code for warnings vs errors vs clean?
- **Multiple violations**: Same rule triggered multiple times. All reported?
- **Cross-file lint**: Violations spanning multiple files.
- **False positives**: Cases that look like violations but aren't. Fragment field names in NL that do resolve.
- **Fragment spread context**: NL references to fields that come from fragment spreads. False positive or correctly resolved?
- **Namespace context**: NL references using namespace-qualified names.
- **Metric source context**: NL in a metric body referencing its source schema.
- **Single file**: `satsuma lint examples/sfdc-to-snowflake/pipeline.stm`. Works?
- **@ref in `hidden-source-in-nl`**: `"Sum @external_schema.amount"` where `external_schema` is not in source/target — does the rule fire?
- **@ref in each/flatten blocks**: NL with @refs inside `each`/`flatten` blocks — does lint detect hidden sources there?
- **Dotted sub-field paths as hidden sources**: `PARENT_RECORD.CHILD_FIELD` where `PARENT_RECORD` IS in the source schema — is this a false positive?
- **Backtick emphasis vs field refs**: File-level `note { }` blocks using backticks for emphasis (e.g., `` `flatten` ``, `` `pii` ``) — should `unresolved-nl-ref` fire? Watch for false positives.
- **@ref in note blocks**: `note { "Based on @source" }` — does `hidden-source-in-nl` apply to note blocks?
- **@ref in source join descriptions**: `source { a, b, "Join on @a.id = @b.id" }` — are @refs in join NL checked by lint?
- **Duplicate definitions with --fix**: What happens when `--fix` is applied to a workspace with duplicate-definition errors?

## Creating test fixtures

Create all temporary test files under `/tmp/satsuma-test-lint/`. Construct files that trigger each lint rule and edge cases that should NOT trigger rules.

## Logging bugs

When you find a bug:
1. Check `tk list` for existing tickets describing the same issue.
2. If no duplicate exists, create a ticket:
   ```bash
   tk create "lint: <concise bug title>" \
     -t bug \
     -d "<detailed description including:
     - What you did (exact command)
     - What you expected
     - What actually happened (paste actual output)
     - Path to the test file that reproduces it>"
   ```
3. Tag it with `--tags cli,lint,exploratory-testing`.

## Rules

- **Do not fix bugs.** Only log them.
- **Do not modify any existing files** in the repo. Only create files in `/tmp/`.
- Be systematic and paste actual CLI output in tickets.
