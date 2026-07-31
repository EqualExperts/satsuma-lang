# tree-sitter-satsuma v2

Tree-sitter grammar package for Satsuma v2. Produces a concrete syntax tree (CST) covering all block types, metadata, transforms, and arrow declarations in the Satsuma v2 language.

## Scope

This package is responsible for syntax parsing only. It does not implement semantic validation, import resolution, type checking, or code generation.

Downstream tooling that depends on this CST:
- `satsuma-cli` — LLM context slicer (Feature 09)
- VS Code syntax highlighting (Feature 07)
- Future linter / formatter

## Source of Truth

- Language spec: `docs/developer/SATSUMA-V2-SPEC.md`
- Grammar PRD: `features/08-treesitter-parser-v2/PRD.md`
- CST node reference: `docs/cst-reference.md`
- Example files: `examples/`

## Package Layout

```
grammar.js               Tree-sitter grammar (v2, CommonJS)
queries/
  highlights.scm         Syntax highlighting captures
  folds.scm              Fold-range captures
  locals.scm             Scope / definition / reference captures
test/
  corpus/                Corpus tests (one .txt per grammar area)
    lexical.txt          Identifier, string, comment tokens
    imports.txt          Import declarations
    metadata.txt         Metadata block ( ) entries
    comments.txt         All three comment types
    schemas.txt          Schema and field declarations
    fragments.txt        Fragment blocks and spreads
    notes.txt            Note blocks
    transforms.txt       Transform blocks and pipe chains
    metrics.txt          Metric blocks
    mappings.txt         Mapping block structure
    arrows.txt           Arrow types and path types
    transforms_in_arrows.txt  Transform bodies on arrows
    value_maps.txt       Map literal corpus
    nested_arrows.txt    Nested arrow bodies
    recovery.txt         Error-recovery cases
scripts/
  smoke-check.js          Parses .stm files, emits JSON summary (Node.js)
docs/
  cst-reference.md       Complete CST node type reference
CONFLICTS.expected       Documented expected grammar conflicts (count = 3)
```

## Building

Requires Node.js 20+, `tree-sitter-cli`, and a C toolchain (macOS: Command Line Tools or Xcode).

```bash
cd tooling/tree-sitter-satsuma

# Install dev dependencies (tree-sitter-cli)
npm install

# Generate parser.c from grammar.js, then compile the native binding
npm run build
# equivalent: tree-sitter generate && node-gyp build
```

## Running Tests

```bash
# Run all corpus tests (requires compiled parser)
npm test
# equivalent: tree-sitter test

# Smoke-test against examples/
node scripts/smoke-check.js ../../examples/
```

## Grammar Generation

Whenever `grammar.js` is changed:

1. Run `npm run build` to regenerate `src/parser.c` and recompile the binding.
2. Run `npm test` to verify all corpus tests pass.
3. If the conflict count changes, update `CONFLICTS.expected` to match.

```bash
tree-sitter generate --wasm
tree-sitter test --wasm
```

## Grammar Conflicts

Three LR(1) conflicts are declared in `grammar.js` and resolved by the GLR algorithm. See `CONFLICTS.expected` for detailed explanations.

| Conflict | Resolution |
|---|---|
| `key_value_pair` vs `tag_token` in metadata | Next `,`/`)` → tag; next value token → kv-pair |
| `map_arrow` vs `nested_arrow` after `src -> tgt` | No `{` or `{pipe_step` → map; `{arrow` → nested |
| `namespaced_path` vs `field_path` | Next `::` → namespaced; next `.`/`->`  → field |

## Node Types Quick Reference

See `docs/cst-reference.md` for the full reference. Key node types:

| Node | Description |
|------|-------------|
| `source_file` | Root node |
| `schema_block` | Schema definition |
| `fragment_block` | Reusable field set |
| `transform_block` | Named pipe transform |
| `mapping_block` | Source→target mapping |
| ~~`metric_block`~~ | Removed in v2 — metrics are `schema_block` with `(metric, ...)` metadata |
| `note_block` | Structural documentation block |
| `import_decl` | Import declaration |
| `field_decl` | Field name + type + metadata |
| `metadata_block` | `( )` metadata list |
| `tag_token` | Bare metadata flag (pii, pk, required) |
| `key_value_pair` | Metadata key-value (format email) |
| `enum_body` | `enum { val, ... }` in metadata |
| `slice_body` | `slice { dim, ... }` in metric metadata |
| `note_tag` | `note "..."` in metadata |
| `map_arrow` | `src -> tgt` with optional transform |
| `computed_arrow` | `-> tgt` derived field |
| `nested_arrow` | `src[] -> tgt[] { arrows }` |
| `src_path` | Source path wrapper |
| `tgt_path` | Target path wrapper |
| `field_path` | `a.b.c` dotted path |
| `namespaced_path` | `ns::schema.field` |
| `backtick_path` | `` `Foo`.field `` |
| `relative_field_path` | `.field` relative path |
| `pipe_chain` | Transform steps |
| `map_literal` | `map { key: value }` |
| `comment` | `//` regular comment |
| `warning_comment` | `//!` warning (surfaced by linter) |
| `question_comment` | `//?` question/TODO (surfaced by linter) |

## Version

Grammar version: 2.0.0 (Satsuma v2)

## Non-Goals

- Semantic lint rules
- Formatting output
- Import graph resolution
- Type checking
- Code generation
