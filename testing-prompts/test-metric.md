# Exploratory Testing: `satsuma metric`

## Context

You are an exploratory QA agent for the Satsuma CLI. Your job is to thoroughly test the `satsuma metric` subcommand, find bugs, and log them as tickets. **Do not fix any bugs — only report them.**

## Setup

1. Read these files to understand the language and CLI contract:
   - `AI-AGENT-REFERENCE.md` — compact grammar and conventions reference
   - `SATSUMA-CLI.md` — full CLI command reference
   - `docs/developer/SATSUMA-V2-SPEC.md` — authoritative language specification
2. Read the `satsuma metric --help` output.
3. Review existing open bug tickets with `tk list` to avoid duplicating known issues.
4. Explore `examples/metrics.stm` and `examples/metrics-platform/metric_sources.stm` for existing metric definitions.

## What to test

`satsuma metric <name> [file.stm]` shows a full metric definition from the parse tree.

Test areas:
- **Basic retrieval**: Retrieve metrics from `examples/metrics.stm`. Verify all fields, metadata, and notes are present.
- **Display labels**: Metrics with display label strings like `metric revenue "Monthly Revenue"`. Is the display label shown?
- **Metric metadata**: `source`, `grain`, `slice`, `filter` entries. All rendered correctly?
- **Multiple sources**: `source {schema_a, schema_b}` syntax.
- **Measure additivity**: Fields with `(measure additive)`, `(measure non_additive)`, `(measure semi_additive)`. Correctly displayed?
- **Notes inside metrics**: `note { }` blocks within metric bodies.
- **Comments**: `//`, `//!`, `//?` inside metrics.
- **`--json` flag**: Valid JSON with all metric data?
- **`--compact` flag**: What gets omitted in compact mode?
- **Not found**: Non-existent metric name. Exit code?
- **Quoted metric names**: Metrics with quoted labels.
- **Namespace-qualified metrics**: If applicable.
- **Fields with all metadata types**: Fields in metrics with various metadata.
- **Edge case: metric with no fields**: Empty metric body.
- **Edge case: metric with only notes**: Body containing only `note {}` and comments.

## Creating test fixtures

Create all temporary test files under `/tmp/satsuma-test-metric/`. Construct metrics exercising all metadata variants and edge cases.

## Logging bugs

When you find a bug:
1. Check `tk list` for existing tickets describing the same issue.
2. If no duplicate exists, create a ticket:
   ```bash
   tk create "metric: <concise bug title>" \
     -t bug \
     -d "<detailed description including:
     - What you did (exact command)
     - What you expected
     - What actually happened (paste actual output)
     - Path to the test file that reproduces it>"
   ```
3. Tag it with `--tags cli,metric,exploratory-testing`.

## Rules

- **Do not fix bugs.** Only log them.
- **Do not modify any existing files** in the repo. Only create files in `/tmp/`.
- Be systematic and paste actual CLI output in tickets.
