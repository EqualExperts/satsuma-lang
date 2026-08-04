---
id: saf-3zn6
status: closed
deps: []
links: []
created: 2026-08-04T20:51:42Z
type: bug
priority: 2
assignee: Thorben Louw
parent: saf-dmvx
tags: [site, learn]
---
# Remove false SCD Type 2 / Kimball star schema claim from site/learn.njk

The Data & ML Engineers pathway's Example Walkthroughs blurb claims the examples gallery includes 'multi-source joins, SCD Type 2, Kimball star schemas, and more' -- only the multi-source-joins part is true; grep of site/examples.njk finds zero matches for 'scd' or 'kimball'. See PRD Finding B.4.

## Acceptance Criteria

site/learn.njk's Example Walkthroughs blurb only names patterns that actually exist in site/examples.njk (e.g. multi-source joins, namespace/platform modelling, governance metadata, merge strategies), or the missing patterns are added as real example cards instead (out of scope for this ticket unless trivial).


## Notes

**2026-08-04T21:14:17Z**

## Notes

**2026-08-04T00:00:00Z**

Cause: learn.njk's Data & ML Engineers "Example Walkthroughs" blurb claimed
the examples gallery includes SCD Type 2 and Kimball star schema patterns,
but no such card existed in site/examples.njk -- the real content lived
only in the separate docs/data-modelling/kimball/ directory (a full,
well-written RetailCo Kimball model including a genuine SCD Type 2
dim_customer.stm), never surfaced in the gallery itself. On review with the
project owner, decided this warranted adding a real example rather than
just softening the sentence, since the underlying content already exists
and is high quality.
Fix: added a "Kimball Star Schema (SCD Type 2)" card to the examples
gallery (convention category) built from the real dim-customer.stm
(dimension/scd 2/track/ignore metadata convention + a representative
mapping), linking out to the full docs/data-modelling/kimball/ guide for
the complete star schema. Updated the learn.njk sentence to accurately
name what's in the gallery (multi-source joins, Kimball SCD Type 2, Data
Vault hubs/satellites -- the last already existed in the "Enterprise
Platform" card) (commit immediately after 9a44adff).
