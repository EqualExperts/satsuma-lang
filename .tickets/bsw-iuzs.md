---
id: bsw-iuzs
status: open
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-sweep-2026-10, grammar, namespaces]
---
# grammar: source { ns::`backtick name` } is not accepted though the docs show it

`qualified_name` (`tooling/tree-sitter-satsuma/grammar.js:122`) is `identifier "::" identifier`, so a backtick-quoted schema name after `::` does not parse as one qualified name. AI-AGENT-REFERENCE.md lines 106 and 206 document the form.

```satsuma
namespace raw { schema `crm-contacts` { id INT } }
schema t { id INT }
mapping m { source { raw::`crm-contacts` } target { t } id -> id }
```

`satsuma validate` reports two `undefined-ref` warnings, for source `raw` and source `crm-contacts`, with the hint "did you mean 'raw::crm-contacts'?". The LSP reports a syntax error at `::`.

## Acceptance Criteria

- `qualified_name` accepts a backtick name on either side of `::`; corpus test added; the repro validates clean and resolves in the CLI and the LSP.
