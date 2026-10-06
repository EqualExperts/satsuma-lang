---
id: bsw-fbd8
status: open
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-sweep-2026-10, cli, mapping, skills]
---
# cli: satsuma mapping drops the extra sources of a multi-source arrow in every output mode

`collectArrows` (`tooling/satsuma-cli/src/commands/mapping.ts:104`, also 129, 145) and `printArrowNode` (`:241`) use `namedChildren.find(x => x.type === "src_path")`, taking only the first source. Pre-existing (same code at v0.13.0).

```satsuma
schema s { a INT  b INT }
schema t { c INT }
mapping m { source { s } target { t } a, b -> c { "sum" } }
```

Text prints `a -> c { "sum" }`, `--arrows-only` prints `a -> c`, `--json` gives `"src": "a"` with `b` nowhere. In the canonical example, `satsuma mapping 'sighting rows with ancestor refs' examples/ancestor-escape/pipeline.stm` prints `.adults -> total_birds` for `.adults, .chicks -> total_birds`. The explainer, satsuma-to-dbt and satsuma-to-openlineage skills consume `mapping --json`, so they silently lose inputs. lsp-vupl (closed) had "mapping command displays multi-source arrows correctly" as a criterion.

## Acceptance Criteria

- All three output modes show every source. JSON gains a field listing all sources (keep `src` for compatibility or document the change in SATSUMA-CLI.md and the skills).
- Tests for text, `--arrows-only` and `--json`.
