---
id: sl-joeq
status: open
deps: []
links: [sl-j6g9]
created: 2026-07-31T14:42:19Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [coverage, core, cli, lsp, viz]
---
# coverage: bare-segment registration makes coverage name-based, silently reporting unmapped fields as mapped

addPathAndPrefixes registers every segment of a covered path as a standalone bare name, so field coverage resolves by NAME rather than by PATH. Any field whose local name matches a segment of some other covered path anywhere in the same schema is silently reported as mapped. This is a false positive in the dangerous direction: a silent over-count that makes an incomplete spec look complete.

Live on main and on feat/35-coverage-command. Affects shipped `satsuma fields --unmapped-by` and the VS Code coverage gutter/status bar today, and would corrupt the percentages introduced by feature 35 (satsuma coverage --fail-under) and feature 36 (viz overlay badges).

## Root cause

satsuma-core/src/coverage.ts (main) / coverage-paths.ts:29-40 (branch):

    for (const part of parts) {
      prefix = prefix ? `${prefix}.${part}` : part;
      set.add(prefix);
      set.add(part); // bare leaf so "city" matches even if the full path is "address.city"
    }

Covering `address.city` yields the set {"address", "address.city", "city"}. The bare entry is deliberate — it exists so a consumer can probe by local field name (see the comment at coverage.ts:72-74) — but it makes the covered set unable to distinguish 'an arrow wrote this path' from 'some path with this segment was written'. Leaf-name reuse across depths (id, sku, code, amount, city, BIC) is normal in nested schemas, so the collision rate rises with exactly the schemas coverage analysis is for.

satsuma-cli/src/commands/fields.ts:193 makes it worse by ORing the bare check explicitly: `if (!mapped.has(f.name) && !mapped.has(path))`.

## Reproduction 1 — committed fixture, ISO-20022

tooling/satsuma-cli/test/fixtures/deep-nested-bugs.stm declares four BIC leaves (GrpHdr.InstgAgt, GrpHdr.InstdAgt, CdtTrfTxInf.DbtrAgt, CdtTrfTxInf.CdtrAgt); the mapping covers three, leaving GrpHdr.InstdAgt.BIC unmapped.

    $ satsuma fields pacs008 --unmapped-by 'pacs008 to iso_target' deep-nested-bugs.stm
      GrpHdr  record
        MsgId  STRING

GrpHdr.InstdAgt.BIC and its parent record are omitted entirely — reported as mapped because the instructing-agent BIC is mapped. Confusing instructing with instructed agent is precisely the error coverage should catch in payment messaging.

## Reproduction 2 — an untouched container reads as half-mapped

Source orders.lines{sku,qty} fully mapped inside nested each blocks; orders.packed{sku,units} given no arrows at all:

    $ satsuma fields tgt_ev --unmapped-by 'partial each' eachleak.stm
      orders  list_of record
        packed  list_of record
          units  INT

orders.packed.sku is reported mapped solely because orders.lines.sku exists in a sibling container.

Also reproducible against examples/lib/sfdc_fragments.stm, which spreads one fragment into both BillingAddress and ShippingAddress record bodies, so every leaf name exists at two paths.

## Design

Fix: stop registering bare segments. A path's coverage is decided by its qualified path only. Then fix the consumers that depend on the bare form:

- satsuma-cli/src/commands/fields.ts:193 — drop the mapped.has(f.name) clause from the leaf test.
- satsuma-lsp / satsuma-core buildFieldCoverage already probes qualified paths (coverage.ts:212 on main, :300-323 on branch) — confirm no other call site probes by local name.
- satsuma-viz/src/components/sz-schema-card.ts:656-658,722 and sz-mapping-detail.ts:526,546 — audit membership probes.

This makes coverage STRICTER: fields previously reported mapped become correctly reported unmapped, so existing coverage figures will drop. That is the correction, not a regression — call it out in CHANGELOG.md because anyone who has recorded a coverage number will see it change.

Scope note: this ticket is the leak only. The related structural work — separating directly-covered from prefix-derived coverage, container tri-state, whole-subtree arrows (3cc-iedv), and the unwalked nesting constructs — is specified in features/38-hierarchical-coverage/PRD.md, which depends on this fix. Deliberately kept separate so a silent over-count in a shipped command can be fixed without waiting for a feature.

## Acceptance Criteria

Bare-segment registration removed from addPathAndPrefixes; covered set contains only full paths and ancestor prefixes.

Regression tests (each must fail before the fix):
- top-level field shadowed by a nested leaf: top-level 'city' uncovered when only home_address.city is mapped;
- sibling records sharing a leaf name: work_address.city uncovered when only home_address.city is mapped;
- sibling list containers: orders.packed.sku uncovered when only orders.lines.sku is mapped;
- deep segments: with only a.b.c.d mapped, top-level fields named b, c and d are all uncovered;
- committed-fixture case: fields pacs008 --unmapped-by on deep-nested-bugs.stm reports GrpHdr.InstdAgt.BIC as unmapped;
- one fragment spread into two sibling records (sfdc_fragments.stm shape): mapping BillingAddress.Street leaves ShippingAddress.Street uncovered.

Existing core test at satsuma-core/test/coverage.test.js asserting set.has("city") for the bare leaf is updated, with a comment citing this ticket rather than silently deleted. CLI, core, LSP, viz and vscode suites pass. Coverage-figure change noted in CHANGELOG.md.

