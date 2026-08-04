---
id: saf-jha9
status: closed
deps: []
links: []
created: 2026-08-04T20:51:42Z
type: bug
priority: 1
assignee: Thorben Louw
parent: saf-dmvx
tags: [site, examples]
---
# Fix fabricated example snippets in site/examples.njk

Seven example cards show syntax/values that don't match the real examples/*.stm file they claim to summarize (beyond acceptable truncation): db-to-db (uuid_v5() call not in real file, which uses an NL string), sfdc-to-snowflake (backtick reference where real file uses @fx_spot_rates), edi-to-json (fabricated ITEMQTY field merging two distinct schema blocks), sap-po-to-mfcs (fabricated pk on EBELP, dropped required on MATNR, wrong type DECIMAL vs real NUMBER on MENGE/NETPR), merge-strategies (now_utc() with parens vs real bare now_utc), governance (metadata line-wrapping doesn't match real file or formatter output, drops a real note), multi-source-hub (drops one of two real sources, rewrites @ref text to ref-free prose). See PRD Finding A for exact line references.

## Acceptance Criteria

Each of the 7 named snippets is re-derived from its real source file: same functions/fields/types/constraints as the file it claims to summarize (truncation for length is fine, incorrect content is not). Re-verify by re-reading the real file alongside the new snippet HTML for each of the 7 cards.


## Notes

**2026-08-04T21:01:39Z**

## Notes

**2026-08-04T00:00:00Z**

Cause: 7 example cards on site/examples.njk showed hand-authored illustrative
snippets that had drifted from the real examples/*.stm files they claim to
summarize -- not just truncated for length, but fabricated (uuid_v5() call,
a merged/renamed EDI field, an invented pk and wrong NUMBER->DECIMAL type on
SAP fields) or using unsupported reference styles (backtick reference instead
of @ref; now_utc() with parens the real file never uses; dropped/rewritten
sources and NL text).
Fix: re-derived all 7 snippets (db-to-db, sfdc-to-snowflake, edi-to-json,
sap-po-to-mfcs, merge-strategies, governance, multi-source-hub) directly from
their real source files so every field, type, constraint, and NL string shown
is a verbatim (whitespace/truncation aside) subset of the actual fixture
(commit immediately after e9fae41a).
