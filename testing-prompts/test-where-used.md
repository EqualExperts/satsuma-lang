# Exploratory Testing: `satsuma where-used`

## Context

You are an exploratory QA agent for the Satsuma CLI. Your job is to thoroughly test the `satsuma where-used` subcommand, find bugs, and log them as tickets. **Do not fix any bugs — only report them.**

## Setup

1. Read these files to understand the language and CLI contract:
   - `AI-AGENT-REFERENCE.md` — compact grammar and conventions reference
   - `SATSUMA-CLI.md` — full CLI command reference
   - `docs/developer/SATSUMA-V2-SPEC.md` — authoritative language specification
2. Read the `satsuma where-used --help` output.
3. Review existing open bug tickets with `tk list` to avoid duplicating known issues.
4. Explore the `examples/` folder for schemas, fragments, and transforms that reference each other.

## What to test

`satsuma where-used <name> [file.stm]` finds all references to a schema, fragment, or transform.

Test areas:
- **Schema in source/target**: Schema referenced in `source { \`schema\` }` or `target { \`schema\` }` blocks.
- **Fragment spreads**: Fragment referenced via `...fragment_name`. Found?
- **Transform spreads**: Named transform referenced via `...transform_name` in mapping bodies.
- **Import references**: Schema or fragment referenced in `import { name } from "file.stm"`.
- **Metric source references**: Schema referenced as `source schema_name` in metric metadata.
- **@ref references in NL**: Schema or field names referenced via `@ref` syntax in NL strings (e.g., `"Sum @schema.field"`). Are these surfaced?
- **Cross-file references**: Name used in a different file from its definition.
- **Namespace-qualified references**: `crm::customers` references.
- **Quoted names**: Fragments or schemas with quoted labels like `'Common Fields'`.
- **No references**: Name that exists but is never referenced elsewhere. Exit code?
- **Non-existent name**: Name that doesn't exist at all. Exit code? Message?
- **`--json` flag**: Valid JSON with reference locations and types?
- **Multiple reference types**: Same name used as source, in NL, and in import. All listed?
- **Self-reference**: Schema that references itself somehow.
- **Case sensitivity**: Is lookup case-sensitive?
- **Ref metadata**: `(ref schema.field)` — is this caught as a reference?
- **@ref references in NL**: `"Sum @schema.field"` — does where-used find this as a reference to the schema?
- **@ref in each/flatten blocks**: Schema referenced via @ref inside each/flatten NL — found by where-used?
- **@ref in standalone notes**: Schema referenced via @ref in a file-level `note { }` — found?
- **@ref in source join descriptions**: Schema referenced via @ref in `source { a, b, "Join @a.id = @b.id" }` — found?
- **@ref in named transforms**: Schema referenced via @ref in a named transform definition — found when the transform is spread?

## Creating test fixtures

Create all temporary test files under `/tmp/satsuma-test-where-used/`. Build files with cross-references of every type.

## Logging bugs

When you find a bug:
1. Check `tk list` for existing tickets describing the same issue.
2. If no duplicate exists, create a ticket:
   ```bash
   tk create "where-used: <concise bug title>" \
     -t bug \
     -d "<detailed description including:
     - What you did (exact command)
     - What you expected
     - What actually happened (paste actual output)
     - Path to the test file that reproduces it>"
   ```
3. Tag it with `--tags cli,where-used,exploratory-testing`.

## Rules

- **Do not fix bugs.** Only log them.
- **Do not modify any existing files** in the repo. Only create files in `/tmp/`.
- Be systematic and paste actual CLI output in tickets.
