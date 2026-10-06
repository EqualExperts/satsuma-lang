---
id: sl-j4eg
status: closed
deps: []
links: []
created: 2026-03-30T05:29:44Z
type: chore
priority: 2
assignee: Thorben Louw
---
# rename BacktickRef → AtRef and drop bare-backtick NL-string backward compat

The codebase still uses BacktickRef / extractBacktickRefs everywhere and nl-ref.ts explicitly maintains backward compatibility for bare-backtick refs (`field`) inside NL strings (without the @ sigil). This was meant to be dropped when @-ref syntax was finalised. The vscode extension also still underlines bare backtick refs in NL strings via its semantic token emitter and tmLanguage patterns.

Affected locations:
- satsuma-core/src/nl-ref.ts: BacktickRef interface (line 18), extractBacktickRefs() (line 110), BACKTICK_RE compat block (lines 102, 122-136)
- satsuma-core/src/index.ts: exports BacktickRef and extractBacktickRefs
- satsuma-cli/src/nl-ref-extract.ts: re-exports both
- satsuma-cli/src/validate.ts: calls extractBacktickRefs() with comment 'NL backtick reference validation'
- satsuma-cli/src/commands/graph.ts: imports and calls extractBacktickRefs
- satsuma-core/test/nl-ref.test.js: describe('extractBacktickRefs()')
- vscode-satsuma/server/src/semantic-tokens.ts: BACKTICK_REF_RE (line 201), emitSplitStringTokens highlights bare backtick refs
- vscode-satsuma package: tmLanguage.json #backtick-identifier pattern used inside nl-strings

Note: backtick-quoted field/schema/mapping NAMES (e.g. `Account.Name` as an identifier) are valid syntax and unaffected — this is only about bare-backtick refs inside NL strings.

## Design

Rename BacktickRef → AtRef and extractBacktickRefs → extractAtRefs throughout satsuma-core and satsuma-cli. Remove the BACKTICK_RE compat block from nl-ref.ts (the while loop on lines 122-136). Remove BACKTICK_REF_RE from semantic-tokens.ts and stop emitting split tokens for bare-backtick refs in nl-strings. Audit tmLanguage.json to remove any rule that highlights bare backtick refs specifically within NL string contexts (as opposed to backtick identifiers used in field/schema names, which stay). Audit corpus fixtures — bare backtick refs in NL strings should be updated to @-ref syntax or deleted.

## Acceptance Criteria

- BacktickRef type renamed to AtRef everywhere (satsuma-core, cli, vscode)
- extractBacktickRefs renamed to extractAtRefs everywhere
- BACKTICK_RE backward-compat block removed from nl-ref.ts
- Bare backtick refs inside NL strings no longer highlighted/underlined in vscode
- All existing tests updated; no new tests added for removed behaviour
- No corpus fixture or .stm example contains a bare-backtick NL ref (grep clean)
- satsuma-core/test/nl-ref.test.js updated to test extractAtRefs, not extractBacktickRefs
- npm test passes across all packages

## Notes

**2026-03-30**

Cause: `BacktickRef`/`extractBacktickRefs` naming and backward-compat BACKTICK_RE extraction persisted after @-ref syntax was finalised; bare-backtick refs in NL strings were still being indexed, highlighted, and validated.
Fix: Renamed `BacktickRef`→`AtRef` and `extractBacktickRefs`→`extractAtRefs` across satsuma-core, satsuma-cli, and vscode-satsuma. Removed BACKTICK_RE compat extraction block from nl-ref.ts. Removed bare-backtick highlighting from semantic-tokens.ts and definition.ts. Updated all 39 affected files — source, tests, fixtures, and examples. Golden snapshot regenerated after examples updated to @ref syntax.
