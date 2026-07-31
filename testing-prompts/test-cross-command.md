# Exploratory Testing: Cross-Command Workflows

## Context

You are an exploratory QA agent for the Satsuma CLI. Your job is to test **multi-command workflows** — sequences of CLI commands that compose to answer real questions. Bugs here are often about inconsistency between commands, not individual command failures. **Do not fix any bugs — only report them.**

## Setup

1. Read these files to understand the language and CLI contract:
   - `AI-AGENT-REFERENCE.md` — compact grammar and conventions reference
   - `SATSUMA-CLI.md` — full CLI command reference
   - `docs/developer/SATSUMA-V2-SPEC.md` — authoritative language specification
2. Review existing open bug tickets with `tk list` to avoid duplicating known issues.
3. Explore the `examples/` folder for realistic workspaces.

## What to test

Each workflow below chains multiple commands. The key question is: **do the commands agree with each other?**

### Workflow 1: Impact Analysis
Trace a field from source to downstream consumers.
```bash
# 1. Find all arrows from a source field
satsuma arrows source_schema.field --as-source --json

# 2. For each target found, trace further
satsuma arrows target_schema.field --as-source --json

# 3. At NL hops, read the NL content
satsuma nl mapping_name.field

# 4. Check lineage for the full picture
satsuma lineage --from source_schema --json
```
- Does the arrow chain match what lineage reports?
- Do @ref-derived arrows from `nl-refs` appear in the `arrows` output?
- Does `nl` find the same NL content that `arrows` reports as `transform_raw`?

### Workflow 2: Coverage Assessment
Find unmapped target fields across all mappings.
```bash
# 1. Get target fields
satsuma fields target_schema --json

# 2. Check unmapped fields for each mapping
satsuma fields target_schema --unmapped-by "mapping_name" --json

# 3. Cross-reference with mapping arrow count
satsuma mapping "mapping_name" --json
```
- Does the unmapped count plus mapped arrows equal total fields?
- Are fragment-spread fields counted correctly by both commands?

### Workflow 3: Graph vs Lineage Consistency
```bash
# 1. Get the full graph
satsuma graph path/pipeline.stm --json

# 2. Get lineage for a specific schema
satsuma lineage --from schema_name path/pipeline.stm --json

# 3. Compare
```
- Does every edge in lineage output appear in the graph?
- Does `graph --schema-only` produce the same topology as lineage?
- Do `nl_ref` edges in graph match what `nl-refs` reports?

### Workflow 4: Lint vs Validate Consistency
```bash
satsuma validate path/pipeline.stm --json
satsuma lint path/pipeline.stm --json
```
- Do both commands find the same duplicate-definition errors?
- Does validate's `[nl-ref-unresolved]` warning match lint's `unresolved-nl-ref` rule?
- If lint `--fix` is applied, does validate pass afterward?

### Workflow 5: PII Audit Trail
```bash
# 1. Find PII fields
satsuma find --tag pii --json

# 2. Trace each downstream
satsuma arrows schema.pii_field --as-source --json

# 3. Check if downstream has pii tag
satsuma meta target_schema.target_field --json

# 4. Read any NL transforms for PII survival
satsuma nl mapping.target_field
```
- At NL hops, is the @ref chain intact so agents can reason about PII survival?
- Does `find --tag pii` match what `meta` reports for each field?

### Workflow 6: @ref Consistency Across Commands
Create a fixture with @refs in various positions and verify all commands agree:
```bash
# Does nl-refs find the ref?
satsuma nl-refs path/pipeline.stm --json

# Does lineage trace through it?
satsuma lineage --from ref_target path/pipeline.stm --json

# Does graph include it as an nl_ref edge?
satsuma graph path/pipeline.stm --json

# Does where-used find the reference?
satsuma where-used ref_target path/pipeline.stm --json

# Does lint flag it if undeclared?
satsuma lint path/pipeline.stm --json

# Does validate warn if unresolved?
satsuma validate path/pipeline.stm --json
```
- Do all 6 commands agree on which @refs exist and whether they resolve?
- Test with @refs in: arrow transforms, note blocks, source join descriptions, each/flatten blocks, named transforms.

### Workflow 7: Classification Consistency
```bash
satsuma arrows schema.field --json            # classification field
satsuma mapping mapping_name --json           # kind field on arrows
satsuma graph path/pipeline.stm --json        # classification on field edges
```
- Do all three commands agree on the classification of every arrow?
- Pay special attention to: empty `{ }` bodies, mixed NL+structural in same pipe step, map transforms.

### Workflow 8: Namespace Consistency
```bash
satsuma summary path/pipeline.stm --json          # namespace counts
satsuma graph path/pipeline.stm --namespace ns     # filtered graph
satsuma lineage --from ns::schema                  # namespace-qualified lineage
satsuma where-used ns::schema path/pipeline.stm    # namespace-qualified search
```
- Are namespace-qualified names consistent across commands?
- Does `graph --namespace` match what summary reports for that namespace?
- Does `graph --schema-only` use qualified or bare mapping names?

### Workflow 9: Format Round-Trip
```bash
satsuma fmt --diff path/file.stm      # see what would change
satsuma fmt path/file.stm             # apply formatting
satsuma validate path/file.stm        # still valid?
satsuma graph path/file.stm --json    # same topology?
```
- Does formatting preserve all semantics?
- Does the graph before and after formatting have identical nodes/edges?

### Workflow 10: Diff Accuracy
```bash
# Create two versions of a workspace
satsuma diff v1/pipeline.stm v2/pipeline.stm    # structural diff
satsuma summary v1/pipeline.stm --json           # baseline counts
satsuma summary v2/pipeline.stm --json           # updated counts
```
- Does the diff correctly capture all additions/removals between the two summaries?
- Are renamed schemas detected as renames or as add+remove?

## Creating test fixtures

Create all temporary test files under `/tmp/satsuma-test-cross-cmd/`. Build workspaces that exercise multi-command composition, especially around @refs, each/flatten blocks, and namespaces.

## Logging bugs

When you find an inconsistency:
1. Check `tk list` for existing tickets.
2. If no duplicate:
   ```bash
   tk create "cross-cmd: <concise title>" \
     -t bug \
     -d "<description including:
     - Commands run in sequence
     - Output from each command
     - Where the inconsistency lies
     - Path to test fixture>"
   ```
3. Tag with `--tags cli,cross-command,exploratory-testing`.

## Rules

- **Do not fix bugs.** Only log them.
- **Do not modify any existing files** in the repo. Only create files in `/tmp/`.
- Be systematic — run each workflow end-to-end and compare outputs.
- Focus on **consistency between commands**, not individual command behavior.
