# Exploratory Testing: `satsuma field-lineage`

## Context

You are an exploratory QA agent for the Satsuma CLI. Your job is to thoroughly test the `satsuma field-lineage` subcommand, find bugs, and log them as tickets. **Do not fix any bugs — only report them.**

## Setup

1. Read these files to understand the language and CLI contract:
   - `AI-AGENT-REFERENCE.md` — compact grammar and conventions reference
   - `SATSUMA-CLI.md` — full CLI command reference
   - `docs/developer/SATSUMA-V2-SPEC.md` — authoritative language specification
2. Read the `satsuma field-lineage --help` output.
3. Review existing open bug tickets with `tk list` to avoid duplicating known issues.
4. Explore `tooling/satsuma-cli/src/commands/field-lineage.ts` to understand the implementation surface.

## What to test

`satsuma field-lineage <schema.field> [file.stm]` traces the full upstream and downstream field-level lineage in a single pass.

### A. Input parsing and error handling

- **No dot in reference**: `satsuma field-lineage justschema` — expected exit 2 with message.
- **Schema not found**: Valid dot form but schema doesn't exist — expected exit 1.
- **Field not found**: Schema exists, field doesn't — expected exit 1.
- **Namespace-qualified**: `ns::schema.field` — does `indexOf(".")` correctly split at the schema–field boundary?
- **Deeply nested field path**: `schema.record.child` — does the parser split at the first dot, yielding `schema` + `record.child`? Does validation find the nested field?
- **Backtick-quoted schema name in path**: `` `schema-name`.field `` — does quoting survive command parsing?

### B. Basic traversal correctness

- **Single-hop upstream**: Source → target. `field-lineage target` should show `source` in upstream.
- **Single-hop downstream**: Source → target. `field-lineage source` should show `target` in downstream.
- **Multi-hop upstream chain**: A → B → C. `field-lineage C` upstream should show B and A (BFS order).
- **Multi-hop downstream chain**: A → B → C. `field-lineage A` downstream should show B and C.
- **Middle node**: `field-lineage B` should show A upstream and C downstream.
- **Field with no lineage**: Schema has a field, no arrows involve it. Both upstream and downstream empty. Exit 0.

### C. Direction flags

- **`--upstream` only**: Produces upstream, no downstream key in text output; JSON still has both keys but downstream is `[]`.
- **`--downstream` only**: Produces downstream, no upstream in text; JSON has empty upstream.
- **Both `--upstream` and `--downstream` together**: What happens? Should produce same result as no flags (both directions). Verify — this may be a bug.
- **No flags**: Both directions shown.

### D. Depth limiting

- **`--depth 1`**: Only immediate neighbors (1 hop). No transitive hops.
- **`--depth 0`**: Zero hops — both upstream and downstream empty. Exit 0 (not exit 1).
- **`--depth 2`**: Only fields reachable in 2 hops.
- **Chain longer than default depth (10)**: Build an 11-hop chain. Verify the 10th is included and the 11th is not. Is the depth limit documented/signaled?
- **`--depth` combined with `--upstream`**: Only upstream limited to N hops.

### E. Multi-source arrows

- **`a, b -> c`**: Trace upstream of `c` — should show both `a` and `b`.
- **`a, b -> c` and `d -> c`**: Multiple mappings feeding same target field — all sources should appear in upstream.
- **`a -> c` and `a -> d`**: One source feeds two targets — downstream of `a` should show both.

### F. Derived (no-source) arrows

- **`-> target { "compute" }` bare derived arrow**: Upstream of `target` should be empty (no source). `from` is `null`, skipped by BFS. Verify this matches documented behavior.
- **`-> target { "Sum @amount" }` NL-derived computed**: Should `@amount` create an nl-derived upstream edge to `target`?

### G. NL-derived lineage edges

- **`@ref` in NL transform body**: `a -> b { "process @s.c before writing to @b" }` — does `s.c` appear as upstream of `b` via nl-derived edge?
- **Multiple `@ref` in one NL string**: `"Join @s1.id with @s2.id and copy to target"` — both `s1.id` and `s2.id` upstream.
- **`@ref` in source block join NL**: `source { s1, s2, "Join on @s1.id = @s2.id" }` — are `@s1.id` and `@s2.id` followed as lineage sources?
- **@ref to undeclared schema**: NL references `@external.col` which is not in source/target. Does field-lineage follow it as nl-derived? Does it handle gracefully if schema not in index?
- **nl-derived dedup**: If `a -> b { ... }` is a declared arrow AND the NL body says `@a`, should the nl-derived edge be suppressed (already covered)? Verify dedup works.

### H. Diamond and fan-out patterns

- **Diamond**: A feeds B and C; both B and C feed D. Upstream of D should show B, C, and A (transitively). No duplicate A.
- **Fan-out**: A feeds B, C, D. Downstream of A shows B, C, D.
- **Fan-in**: B, C, D all feed A. Upstream of A shows B, C, D.

### I. Cycle handling

- **Simple cycle**: A → B → A. `field-lineage A` must terminate. Neither A appears in its own lineage. Check exit code 0.
- **3-node cycle**: A → B → C → A. Traversal terminates. Only non-start nodes appear in results.
- **Self-loop**: Mapping where `s.f -> s.f` (same field as source and target). Does it handle gracefully?

### J. Namespace-qualified fields

- **Namespaced schema as input**: `ns::schema.field` input. Does it resolve correctly?
- **Cross-namespace chain**: Source schema in `ns1::`, target in `ns2::`. Does field-lineage traverse the cross-ns edge?
- **Unqualified input resolving to namespaced schema**: `schema.field` when schema only exists under a namespace — does it resolve or error?
- **via_mapping value**: Is the `via_mapping` in the result correctly namespace-qualified (e.g., `::ns::mapping_name`)?

### K. Fragment spread fields

- **Spread field on consuming schema**: Fragment `F` has field `x`. Schema `S` spreads `...F`. `field-lineage S.x` — does it find the field and trace lineage?
- **Upstream through a spread field**: Arrow `source.val -> S.x` where `x` is a spread field. Does upstream of `S.x` show `source.val`?

### L. Each/flatten block fields

- **Relative field path in each**: `each items -> out { .sku -> .code { trim } }`. `field-lineage out.code` — should show `items.sku` as upstream.
- **Nested record traversal**: Does lineage follow through records inside each blocks?

### M. Output format

- **JSON shape**: `{ "field": "::schema.field", "upstream": [...], "downstream": [...] }` — validate exact keys and types.
- **field value is always canonical**: `::schema.field` form (double-colon prefix even for unnamespaced schemas).
- **via_mapping is always canonical**: `::mapping_name` or `::ns::mapping_name`.
- **classification values**: Must be one of `structural`, `nl`, `mixed`, `none`, `nl-derived`. No unexpected values.
- **Text output format**: Header line shows field name and connection count. Sections labeled "upstream (N):" and "downstream (N):". Each entry: `    ::field  via ::mapping  [classification]`.
- **Text when empty**: Shows "upstream: (none)" and "downstream: (none)" — not missing sections.
- **`--upstream` with JSON**: Both `upstream` and `downstream` arrays present in JSON? Or only `upstream`? Verify the JSON contract is consistent.

### N. Path argument

- **No path**: Uses current directory (`.`). Works if run from workspace root.
- **Explicit file path**: `satsuma field-lineage schema.field /path/to/workspace/pipeline.stm`.
- **Directory argument**: `satsuma field-lineage schema.field /path/to/workspace/` — expected error (directories are rejected, must pass a `.stm` file).
- **Non-existent path**: `satsuma field-lineage schema.field /nonexistent/file.stm` — expected error, exit 2.

### O. Multiple files / cross-file lineage

- **Source in file A, target in file B, mapping in file C**: Lineage traversal crosses all three files.
- **Import chains**: Platform entry file imports from two sub-files. Lineage traverses imports.

### P. Edge classification preservation

- **Structural arrow in chain**: The classification in the lineage result matches the arrow's classification.
- **NL arrow in chain**: `[nl]` classification preserved.
- **nl-derived edge classification**: Always `"nl-derived"`.
- **Multi-hop: different classifications per hop**: A→B is `structural`, B→C is `nl`. In C's upstream, B shows as `nl` and A shows as `structural`.

## Creating test fixtures

Create all temporary test files under `/tmp/satsuma-test-field-lineage/`. Build workspaces for each test group with minimal, targeted fixtures that isolate the behavior being tested.

## Logging bugs

When you find a bug:
1. Check `tk list` for existing tickets describing the same issue.
2. If no duplicate exists, create a ticket:
   ```bash
   tk create "field-lineage: <concise bug title>" \
     -t bug \
     -d "<detailed description including:
     - What you did (exact command)
     - What you expected
     - What actually happened (paste actual output)
     - Path to the test file that reproduces it>"
   ```
3. Tag it with `--tags cli,field-lineage,exploratory-testing`.

## Rules

- **Do not fix bugs.** Only log them.
- **Do not modify any existing files** in the repo. Only create files in `/tmp/`.
- Base expected behavior on `docs/developer/SATSUMA-V2-SPEC.md` and `SATSUMA-CLI.md`, not on what the code currently does.
- Be systematic — paste actual CLI output in tickets, include exact commands and fixture paths.
