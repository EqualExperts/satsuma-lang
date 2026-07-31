# Exploratory Testing: `satsuma mapping`

## Context

You are an exploratory QA agent for the Satsuma CLI. Your job is to thoroughly test the `satsuma mapping` subcommand, find bugs, and log them as tickets. **Do not fix any bugs — only report them.**

## Setup

1. Read these files to understand the language and CLI contract:
   - `AI-AGENT-REFERENCE.md` — compact grammar and conventions reference
   - `SATSUMA-CLI.md` — full CLI command reference
   - `docs/developer/SATSUMA-V2-SPEC.md` — authoritative language specification
2. Read the `satsuma mapping --help` output.
3. Review existing open bug tickets with `tk list` to avoid duplicating known issues.
4. Explore the `examples/` folder for existing test material.

## What to test

`satsuma mapping <name> [file.stm]` shows a full mapping with all arrows and transforms.

Test areas:
- **Basic retrieval**: Retrieve named mappings from `examples/sfdc-to-snowflake/pipeline.stm`. Verify all arrows, source/target declarations, and transforms are present.
- **Quoted mapping names**: Mappings with labels like `'sfdc to hub_customer'`. Test retrieval with exact quoting.
- **Unnamed mappings**: Mappings without labels. How are they referenced?
- **Arrow types**: Direct (`src -> tgt`), with transform (`src -> tgt { ... }`), derived (`-> tgt { ... }`), nested array (`src[] -> tgt[] { ... }`).
- **Transform classification**: Does output correctly classify arrows as `[structural]`, `[nl]`, `[mixed]`, `[none]`?
- **Pipeline transforms**: Multi-step pipelines with `|`. Are all steps shown?
- **NL transforms**: `"natural language string"` transforms. Extracted verbatim?
- **Mixed transforms**: Pipeline steps combined with NL strings in the same transform body.
- **Map transforms**: `map { key: value }` syntax including `null:`, `_:`, `default:`, `< 1000:`.
- **Nested arrow blocks**: `src -> tgt { nested mapping body }` for array mappings.
- **Source/target declarations**: `source { \`schema\` }` and `target { \`schema\` }` blocks.
- **Notes inside mappings**: `note { }` blocks within mapping bodies.
- **Comments inside mappings**: `//`, `//!`, `//?` inside mapping blocks.
- **Metadata on arrows**: `src -> tgt (note "...") { transform }`.
- **Fragment/transform spreads**: `...transform_name` in transform bodies.
- **`--json` flag**: Valid JSON with complete arrow data and classifications?
- **`--compact` flag**: What gets omitted?
- **Not found**: Non-existent mapping name. Exit code?
- **Multiple mappings same name**: In different files or namespaces.
- **Field paths with dots**: `record.child -> target.child` arrow paths.
- **Each blocks**: `each items -> output.list { .field -> .field }` — are each block arrows shown with correct nesting?
- **Flatten blocks**: `flatten lines -> flat { .field -> .field }` — are flatten block arrows included?
- **Nested each blocks**: `each outer -> target { each inner -> .nested { ... } }` — correct nesting representation?
- **Multi-source arrows**: `a, b -> c { "combine" }` — both sources shown?
- **@ref in NL transforms**: `{ "Sum @line_amount grouped by @order_id" }` — @refs preserved in transform output?
- **Source join descriptions**: `source { a, b, "Join condition" }` — is the join NL shown in mapping output?
- **`--compact --json` consistency**: Does `--compact` omit transforms and notes in JSON mode too (not just text mode)?
- **Empty transform body**: `a -> x { }` — what kind is it classified as?

## Creating test fixtures

Create all temporary test files under `/tmp/satsuma-test-mapping/`. Construct mappings exercising every arrow type, transform variant, and edge case.

## Logging bugs

When you find a bug:
1. Check `tk list` for existing tickets describing the same issue.
2. If no duplicate exists, create a ticket:
   ```bash
   tk create "mapping: <concise bug title>" \
     -t bug \
     -d "<detailed description including:
     - What you did (exact command)
     - What you expected
     - What actually happened (paste actual output)
     - Path to the test file that reproduces it>"
   ```
3. Tag it with `--tags cli,mapping,exploratory-testing`.

## Rules

- **Do not fix bugs.** Only log them.
- **Do not modify any existing files** in the repo. Only create files in `/tmp/`.
- Be systematic and paste actual CLI output in tickets.
