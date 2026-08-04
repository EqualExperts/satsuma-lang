# Satsuma CLI — Deterministic Structural Extraction

Command-line tool that uses the tree-sitter Satsuma v2 parser to index Satsuma workspaces and provide structured output for agent composition, validation, and navigation. **The CLI extracts structural facts and delivers NL content verbatim — it does not interpret natural language.**

---

## Requirements

- Node.js 20+

The grammar WASM this package loads is built for you: it is a declared dependency,
so Turborepo builds `tree-sitter-satsuma` before this package.

## Installation (local dev)

```bash
npm install                   # from the repo root — npm workspaces, one lockfile
npm run build:all             # or: npx turbo run build --filter=satsuma-cli
npm --prefix tooling/satsuma-cli link    # makes `satsuma` available on PATH
```

## Usage

```
satsuma <command> [options] [path]
```

`path` defaults to the current directory (looks for `*.stm` files).

---

## Commands

### Workspace Extractors — retrieve whole blocks

| Command | Description |
|---------|-------------|
| `satsuma summary [path]` | Overview of all schemas, metrics, and mappings |
| `satsuma schema <name> [path]` | Full field list for a schema |
| `satsuma metric <name> [path]` | Metric definition and source schemas |
| `satsuma mapping <name> [path]` | Arrows, source, and target for a mapping |
| `satsuma find --tag <token> [path]` | Fields carrying a metadata token (e.g. `pii`) |
| `satsuma lineage [path]` | Schema-level graph traversal (`--from` / `--to`) |
| `satsuma where-used <name> [path]` | All references to a schema or fragment |
| `satsuma warnings [path]` | All `//!` warning and `//?` question comments |
| `satsuma context <query> [path]` | Keyword-ranked block extraction for LLM context |

### Structural Primitives — slice below block level

| Command | Description |
|---------|-------------|
| `satsuma arrows <schema.field> [path]` | All arrows involving a field with transform classification |
| `satsuma nl <scope> [path]` | NL content (notes, transforms, comments) within a scope |
| `satsuma meta <scope> [path]` | Metadata entries (tags, types, constraints) for a block or field |
| `satsuma fields <schema> [path]` | Field list with types; `--unmapped-by` for coverage gaps |
| `satsuma match-fields [path]` | Deterministic normalized name matching between two schemas |

### Structural Analysis

| Command | Description |
|---------|-------------|
| `satsuma validate [path]` | Parse errors + semantic reference checks |
| `satsuma diff <a> <b>` | Structural comparison of two Satsuma files or directories |

---

## Transform Classification

Every arrow returned by the CLI carries a classification derived from CST node types:

| Marker | CST Condition | Meaning |
|--------|---------------|---------|
| `[structural]` | All steps are `token_call`, `map_literal`, or `fragment_spread` | Deterministic pipeline — fully specified |
| `[nl]` | All steps are `nl_string` or `multiline_string` | Natural language — agent must interpret |
| `[mixed]` | Both structural and NL steps present | Partially deterministic — review NL portion |
| `[none]` | No transform body (bare `src -> tgt`) | Direct mapping, no transformation |

This classification is a **mechanical CST check** — it tells agents exactly where structural certainty ends.

---

## What the CLI Does Not Do

The CLI does not include `impact`, `coverage`, `audit`, `scaffold`, or `inventory` commands. These are **workflows that agents compose from primitives**, applying their own reasoning to the NL content the CLI surfaces. The correctness of such workflows depends on NL interpretation, which is outside the CLI's scope.

---

## Architecture

```
src/
  index.js           Entry point; registers commands on the commander program
  commands/          One module per satsuma sub-command
  extract.js         CST extraction functions (schemas, mappings, arrows, etc.)
  classify.js        Transform classification (structural/nl/mixed/none)
  index-builder.js   Builds ExtractedWorkspace from parsed files
  nl-extract.js      NL content extraction from CST subtrees
  meta-extract.js    Structured metadata extraction
  normalize.js       Deterministic name normalization for field matching
  validate.js        Structural and semantic validation
  diff.js            Structural comparison of two ExtractedWorkspace instances
  parser.js          Tree-sitter parser wrapper
  workspace.js       Satsuma file discovery
  errors.js          Shared error handling and exit codes
```

---

## Development

```bash
# Run directly without linking
node src/index.js summary ../../examples/

# Run tests (from the repo root — builds dependencies first)
npx turbo run test --filter=satsuma-cli
```
