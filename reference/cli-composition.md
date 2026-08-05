
### field-lineage vs arrows

`arrows <field>` returns the **immediate** arrows for a field (one hop).
`field-lineage <field>` traverses the **full chain** — all the way upstream and downstream, following both declared arrows and NL-derived `@ref` references, in one call.

```
arrows loyalty_sfdc.LoyaltyTier --json        # immediate: [{source, target, classification}, ...]
field-lineage loyalty_sfdc.LoyaltyTier --json # full: {field, upstream: [...], downstream: [...]}
```

Use `arrows` when you need classification details on a specific hop. Use `field-lineage` for impact analysis, PII audit, and coverage — anywhere you need the full reachability picture.

JSON shape for `field-lineage --json`:
```json
{
  "field":      "::schema.field",
  "maxDepth":   10,
  "upstream":   [{"field": "::src.f", "via_mapping": "::m", "classification": "none", "depth": 1}, ...],
  "downstream": [{"field": "::tgt.f", "via_mapping": "::m", "classification": "nl-derived", "depth": 1}, ...]
}
```

`maxDepth` echoes the `--depth` you requested. Each hop's `depth` is its hop
distance from the focus field; a hop whose depth equals `maxDepth` sits
exactly on the traversal boundary — it may have further neighbours that were
never traced, not a confirmed dead end.

### Transform classification

Every arrow the CLI returns carries one of three classifications:

| Marker | Meaning | Your responsibility |
| --- | --- | --- |
| `[none]` | Bare `src -> tgt`, no transform body | None |
| `[nl]` | Has a transform body; all pipe-step content is NL | Read it and interpret intent |
| `[nl-derived]` | Implicit arrow from NL `@ref` | Synthetic — verify the referenced field exists |

**When you author a mapping, the classification is a claim you are making.** A bare
`src -> tgt` asserts the value passes through *unchanged* — including its type — and
`satsuma lint` checks that assertion against both declared types
(`type-mismatch-direct-arrow`). Adding a transform body, even one NL string like
`{ "parse as ISO-8601" }`, suppresses the check: you have said something happens
here, and the CLI leaves judging it to a reader. So write the transform body
whenever a conversion is intended, rather than leaving a bare arrow between two
different types — an honest bare arrow is one you would be happy for a linter to
verify.

Two more authoring rules `lint` enforces: an arrow onto a record needs either a
record source or child arrows saying which fields it fills
(`unenumerated-record-target`), and mappings must not form a cycle across distinct
schemas (`lineage-cycle`). Mapping a schema to *itself* is fine and expected — that
is how an increment is expressed.

### Composing workflows

**Whole-workspace reasoning:** Call `satsuma graph <entry-file>.stm --json` to load the entire workspace topology for that file's import-reachable graph in one call — nodes (schemas, mappings, metrics, fragments, transforms), field-level edges with transform classification, and schema-level topology. Use `--schema-only` for topology-only queries, `--namespace <ns>` to scope, `--no-nl` to reduce payload size. The `unresolved_nl` section lists all NL arrows requiring interpretation.

**Impact analysis:** Call `satsuma arrows <field> --as-source --json`, follow each target with another `arrows` call, recurse. At `[nl]` hops, call `satsuma nl` to read the transform or note content and reason about it yourself.

**Coverage check:** Call `satsuma coverage <entry-file>.stm --json` once. Do **not** compose this from `fields --unmapped-by` calls — the CLI performs the aggregation because that is where hand-composed versions went wrong.

The output has two sections making different claims about the same field. `mappings[].schemas[].fields[]` says whether *that mapping* touches it; `aggregate.schemas[].fields[]` says whether *any* mapping does. A target field populated by mapping A and ignored by mapping B is a gap in B's section and covered in the aggregate — so read the aggregate to decide a field is unmapped, and the per-mapping section to find which mapping to edit. (This is the "intersect across mappings" step you would otherwise do yourself, and the reason to stop doing it: treating a field as unmapped because one mapping ignores it is the classic error.)

A field populated only by prose in a note block is uncovered by definition — coverage is structural. Check `nl-refs` for those, and `satsuma arrows` for the classification of a covered field, to judge whether a gap or a cover is real.

**PII audit:** Call `satsuma find --tag pii --json`, then `satsuma arrows` for each tagged field, recurse downstream. At `[nl]` hops, read the transform text to judge whether PII survives.

**Drafting a mapping:** Call `satsuma match-fields` for deterministic name matches. Call `satsuma nl` on both schemas to read field notes. For multi-source work, describe joins/filters in the `source { }` block with `@ref`s. Apply your own judgment for non-obvious matches and transforms.

**Reviewing a change:** Call `satsuma diff` for the structural delta. Call `satsuma arrows` for affected fields. Call `satsuma nl` to read NL content on changed arrows.

### When to use the CLI vs. reading files

| Situation | Approach |
| --- | --- |
| Need full workspace topology in one call | `satsuma graph <file>.stm --json` — all nodes, edges, and field-level flow |
| Need to understand a workspace | `satsuma summary <file>.stm`, then drill with `satsuma schema` / `satsuma mapping` |
| Need arrows for a specific field | `satsuma arrows <schema.field>` — not reading the whole mapping |
| Need NL content for interpretation | `satsuma nl <scope>` — not pulling the entire block |
| Need extracted refs inside NL text | `satsuma nl-refs <file>.stm` — inspect `@ref` usage without rereading whole files |
| Need metadata on a field | `satsuma meta <schema.field>` — not parsing raw text |
| Need one schema's gaps against one mapping | `satsuma fields <schema> --unmapped-by <mapping>` — a field tree with types |
| Need workspace-wide, aggregated, or percentage coverage | `satsuma coverage <file>.stm --json` — never compose it from `--unmapped-by` calls |
| Need coverage to gate CI | `satsuma coverage <file>.stm --fail-under <pct>` — exit 3 when below |
| Need to validate after editing | `satsuma validate <file>.stm` for correctness, `satsuma lint <file>.stm` for conventions |
| Need to compare versions | `satsuma diff` — not text diff |
| Need full file content for editing | Read the file directly — CLI is for querying, not raw content |

### CLI output in prompts

Use `--json` when you need to process output programmatically (which is most of the time in composed workflows). Use `--compact` to minimize tokens when you only need structure. Text output is for human readability.

When reporting results to humans, be transparent about which parts of your analysis came from structural CLI output vs. your own interpretation of NL content.

---
