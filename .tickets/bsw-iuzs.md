---
id: bsw-iuzs
status: closed
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

## Notes

**2026-10-06T17:52:06Z**

Cause: `qualified_name` (and `qualified_dotted_name` and the structural `at_ref` branch) accepted only a bare identifier after `::`, so `` raw::`crm-contacts` `` was a syntax error in imports, `source`/`target`, spreads and metadata. Behind the grammar, `qualifiedNameText` read identifier children only and `(ref ...)` validation split its text on the first `.`, so even a parsed quoted name would not have resolved.
Fix: the grammar takes `_path_seg` after `::`; namespace names stay bare identifiers, as the user decided, which narrows the "either side" criterion. Core gained `importNameText`/`spreadLabelText` (with `pathSegmentText` moved to cst-utils) and the CLI where-used, viz-backend index and LSP symbols now use them instead of their own copies; `(ref ...)` uses the backtick-aware `splitRefSchemaKey`. Spec §2.2, the agent references and useful-prompts document `` ns::`name` `` and mark whole-name backticks as deprecated; the namespace examples and site page are migrated. The deprecation diagnostic is follow-up bsw-qdep. (commit immediately after e142abd8)
