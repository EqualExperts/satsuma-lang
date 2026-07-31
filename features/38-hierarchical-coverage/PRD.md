# Feature 38 — Hierarchical Field Coverage

> **Status: PROPOSED** (2026-07-31) — raised after reading the coverage
> implementation and reproducing its behaviour. Six defects were found: coverage
> resolves field names rather than paths and so reports unmapped fields as
> mapped, two nesting constructs were not walked at all, three different
> percentage conventions ship, two independent walkers derive the same paths, and
> the container semantics the CLI and LSP each rely on are mutually
> contradictory. The two unwalked constructs are fixed (`sl-qzy3`); the rest are
> open, and share one root cause.
>
> **State this PRD was written against:** branch `feat/35-coverage-command` at
> `47438ac`, since merged to `main` as **PR #405** (Feature 35 complete —
> `sl-gsxu`, `sl-5sjp`, `sl-4qvp`, `sl-oqsj`, `sl-3ms0`, `sl-268g`, `sl-tdfx`,
> plus **ADR-034**). Every claim below was verified against that commit.
>
> **Defects 2 and 3 have since been fixed** by `sl-qzy3`, which landed in
> PR #405 before it merged: the walk now recurses uniformly over all three
> container blocks, so `nested_arrow` and `flatten`-inside-`each` contribute
> coverage. They are kept below, with their pre-fix figures, because they are
> the evidence for R4 — three defects of that class were found by inspection
> and none by a test, which is the case for removing the duplicate walker
> rather than patching it a fourth time.
>
> **Defects 1, 4, 5 and 6 remain open.** Defect 5's *symptom* is gone — the two
> walkers agree again on the nested corpus — but the duplication that caused it
> is still there, which is what `sl-vu22` addresses. R1–R7 are unchanged.
>
> **Relationship to ADR-034 (Accepted).** This feature is not in tension with
> it — ADR-034 reaches the same conclusion from the same evidence and names the
> deferred work. It establishes leaf-only counting on each leaf's own flag
> (this feature's R3, already implemented), identifies the same root cause
> ("a record's `mapped` flag cannot distinguish the two cases that matter"),
> and defers the fix as requiring `computeMappingCoverage()` "to track
> directly-covered paths separately from prefix-registered ancestors" — which
> is precisely R1. ADR-034 also rules that "consumers must not compute their own
> coverage denominators", which makes the two surviving local denominators
> (R3) ADR violations rather than mere inconsistencies.
>
> R5 does modify ADR-034's letter — records "never vouch for their
> descendants" becomes "*directly-covered* records vouch for their subtree" —
> so this feature needs an ADR that supersedes or amends ADR-034. Per project
> convention the ADR-034 body stays immutable and only its Status line changes.

## Goal

Make field coverage correct and single-definition for hierarchical schemas —
nested records, lists of records, and fields whose names repeat at different
depths — so a coverage *number* can be trusted as a merge gate:

1. **No false positives.** A field with no arrow pointing at it is never
   reported covered, whatever else in the schema shares its name.
2. **No false negatives from unwalked syntax.** Every nesting construct the
   grammar permits contributes coverage.
3. **One definition of a covered container**, replacing the two contradictory
   ones in use, and **one percentage convention**, replacing three.
4. **Whole-subtree arrows have defined semantics** (folds in `3cc-iedv`).

## Background — verified behaviour

Confirmed by reading the implementation and running it, with reproductions on
files that pass `satsuma validate`. Corrects an earlier assessment of mine that
claimed no coverage percentage existed — three do.

### The data model, and why it is the root cause

`addPathAndPrefixes` (`satsuma-core/src/coverage-paths.ts:29-40` on the branch)
is the whole of the nested-path logic:

```ts
export function addPathAndPrefixes(set: Set<string>, path: string): void {
  if (!path) return;
  const normalised = path.replace(/\[\]/g, "");
  const parts = normalised.split(".");
  let prefix = "";
  for (const part of parts) {
    prefix = prefix ? `${prefix}.${part}` : part;
    set.add(prefix);
    set.add(part); // bare leaf so "city" matches even if the full path is "address.city"
  }
}
```

`isCoveredFieldPath` is then exact membership: `coveredPaths.has(path)`.

The covered set is therefore a **flat bag of strings that mixes three different
claims** — "an arrow wrote exactly this path", "this is an ancestor of a path an
arrow wrote", and "this is a bare segment of some path an arrow wrote" — with no
way to tell them apart afterwards. Almost everything below follows from that.

Empirically, one arrow covering `address.city` produces
`{"address", "address.city", "city"}`:

- **Upward propagation: yes**, by ancestor prefix. Intended and documented.
- **Downward propagation: no.** An arrow covering the record `address` yields
  `{"address"}` — its leaves stay uncovered.
- **Every path segment is also registered bare.** `a.b.c.d` adds standalone
  `a`, `b`, `c`, `d`.

### Defect 1 — coverage is name-based, so unrelated fields share it (false positives)

The bare-segment registration makes coverage match on *names*, not paths.
Field-name reuse across depths is normal in the schemas that most need coverage
analysis — XML/XSD, JSON, COBOL copybooks.

Reproduced. Fixture: top-level `city`, plus `home_address` and `work_address`
records each containing `city` and `line1`; one arrow mapping only
`home_address.city`.

```
$ satsuma fields tgt_decl --unmapped-by 'leak repro' leak.stm
  amount        STRING
  home_address  record
    line1  STRING
  work_address  record
    line1  STRING
```

Five fields are unmapped; three are reported. Top-level **`city`** and
**`work_address.city`** are silently treated as mapped because bare `"city"`
entered the set.

Worse with the shape real nested data takes — sibling list containers reusing
leaf names. `orders.lines{sku,qty}` fully mapped inside nested `each` blocks;
`orders.packed{sku,units}` given **no arrows at all**:

```
$ satsuma fields tgt_ev --unmapped-by 'partial each' eachleak.stm
  orders  list_of record
    packed  list_of record
      units  INT
```

`orders.packed.sku` is reported mapped. An untouched container reads as
half-mapped. For `--fail-under` this is the dangerous direction: a silent
**over**-count that passes an incomplete spec.

The repo already contains fixtures that would trip this — `examples/lib/
sfdc_fragments.stm:49-62` spreads one fragment into both `BillingAddress` and
`ShippingAddress` record bodies, so every leaf name exists at two paths; and
`satsuma-cli/test/fixtures/deep-nested-bugs.stm` declares four sibling `BIC`
leaves at different depths.

### Defect 2 — `nested_arrow` contributes no coverage (false negatives)

`collectBodyPaths` (branch `satsuma-core/src/coverage.ts:200-210`) switches on
`map_arrow`, `computed_arrow`, `each_block`, `flatten_block`. The grammar's
fourth nesting construct, `nested_arrow` — `src -> tgt { arrow* }`
(`grammar.js:404-414`) — is not handled and falls through.

So for `addr -> address { .street -> .street_line  .city -> .city }`, the shape
in `satsuma-cli/test/fixtures/nested-arrow-lookup.stm`, **every field on both
sides reports uncovered**, including the ones with explicit arrows.

### Defect 3 — nested blocks inside `each`/`flatten` are skipped (false negatives)

The `each` child loop (branch `coverage.ts:248-264`) handles `map_arrow`,
`computed_arrow` and `each_block` — **not `flatten_block`**.
`collectFlattenPaths` (`:287-294`) handles only `map_arrow` and
`computed_arrow` — no nested blocks at all.

The grammar permits both (`_nested_block_item`, `grammar.js:265-270`), the
corpus has a fixture (`test/corpus/each_flatten.txt:331-374`), and the repo's
canonical nested example uses it: `examples/nested-iteration/pipeline.stm:100`
is a `flatten parcels.contents -> .packed_items` inside `each orders`.

Reproduced by running the branch's `computeMappingCoverage` on that example.
The whole flatten subtree reports uncovered on both sides:

```
=== source  warehouse_dispatch_events        === target  dispatch_manifest_json
   COVERED    orders.lines.sku                  COVERED    orders.lines.sku
   COVERED    orders.lines.quantity             COVERED    orders.lines.qty
   uncovered  orders.parcels                    uncovered  orders.packed_items
   uncovered  orders.parcels.barcode            uncovered  orders.packed_items.sku
   uncovered  orders.parcels.contents           uncovered  orders.packed_items.units
   uncovered  orders.parcels.contents.sku
   uncovered  orders.parcels.contents.units
```

In leaf percentages: the target schema is **100% mapped** and reports
**75%** (6 of 8 leaves). The source is 89% read — `orders.parcels.barcode` is
the one genuine gap — and reports **67%** (6 of 9).

This is not theoretical: it is what the finished command on PR #405 prints.

```
$ satsuma coverage examples/nested-iteration/pipeline.stm
  source  ::warehouse_dispatch_events      6/9   67%
  target  ::dispatch_manifest_json         6/8   75%
```

So `--fail-under 90` fails a fully-mapped spec, on the example the repo ships
to demonstrate nested iteration — the gate's worst failure mode, since it errs
toward blocking correct work.

**It also regressed a shipped command.** `sl-oqsj` re-based
`fields --unmapped-by` onto the core function, which was the right call in
intent — two commands answering one question from separate code is the drift
Feature 35 exists to prevent — but the shared path it moved onto has this
defect, and the CLI's own path did not:

```
main:   orders.parcels.barcode                                 (correct)
#405:   orders.parcels.barcode, contents.sku, contents.units    (wrong)
```

Raised as **`sl-qzy3`** (P1, `gh-405`) so the immediate fix is not gated on this
feature.

This is the same defect class `sl-7236` fixed in `format.ts`, whose ticket noted
the cause: *"The corpus contains no nested each blocks so round-trip tests do
not catch it."*

**Note the CLI is not affected**, and that is itself the problem — see Defect 5.

### Defect 4 — three percentage conventions ship, all different

1. **VS Code status bar** — `vscode-satsuma/src/commands/coverage-logic.ts:78-86`
   counts **top-level fields only** (`filter(f => !f.path.includes("."))`), so a
   record is in the denominator and its leaves are not. `address record {line1,
   line2, line3}` with only `line1` mapped reports **100%**.
2. **viz schema card** — `satsuma-viz/src/components/sz-schema-card.ts:748-766`
   counts **every node including containers** in both numerator and
   denominator, so one covered leaf inflates the numerator once per ancestor
   level.
3. **New core rollup** (branch `coverage-rollup.ts:132`) counts **leaves only**,
   with the right rationale documented at `:43-56`: a record "is structure, not
   data — counting it alongside its children would count the same data twice
   and let a schema's nesting depth move the percentage".

(3) is correct, is now **ADR-034 (Accepted)**, and this feature keeps it.
ADR-034 further rules that consumers must not compute their own denominators, so
(1) and (2) are ADR violations. (1) is already raised on the branch as
**`3cc-t6uo`**; (2) — the viz card — is this feature's `sl-hcan`. Until both
land, a reviewer with the extension, a terminal and the viz panel open sees
three different figures for one mapping, and Feature 36's requirement that
overlay numbers equal `coverage --json` fails on the first nested schema.

### Defect 5 — two independent walkers, diverging on nesting

Coverage paths are derived twice from different sources:

- **`computeMappingCoverage`** walks the CST itself (the code above, now in
  core), with Defects 2 and 3.
- **`fields --unmapped-by`** builds its set from `index.fieldArrows`, produced
  by `satsuma-core/src/extract.ts`, which handles all nesting constructs
  uniformly and strips relative-path dots at `:911-921`.

So the CLI reports `examples/nested-iteration/pipeline.stm` correctly — one
unread source leaf, `orders.parcels.barcode` — while the promoted walker does
not. Feature 35's `sl-oqsj` requires `fields --unmapped-by` and
`coverage --uncovered --mapping` to report the identical field set; **on any
nested fixture they currently cannot**.

A third walker exists in viz (`field-coverage.ts:85-101`) with its own blind
spot: `viz-model`'s `EachBlock` has `nestedEach` but no `nestedFlatten`, and
`FlattenBlock` has no target field, justified by a comment
(`viz-backend/src/viz-model.ts:1040-1043`) asserting "the grammar does not
permit them" — which is incorrect.

### Defect 6 — container semantics are contradictory by construction

- **LSP/core** `buildFieldCoverage` (branch `coverage.ts:300-323`) sets
  `mapped = isCoveredFieldPath(path, ...)` for every field including records.
  Via ancestor prefixes, a record with **any** covered descendant is
  `mapped: true`. Its test asserts this (`items.mapped === true` when only
  `items.id` is mapped).
- **CLI** `filterUnmappedFields` (`commands/fields.ts:177-199`) does the
  opposite for records, deliberately and with a comment explaining why: a
  record is excluded only when **all** children are covered.

Both are right for their consumer — the gutter wants "something in here is
mapped", the review queue wants "is this record finished?" — and both are
called coverage. One boolean cannot carry both claims.

### Already-known and already-ticketed

`3cc-iedv` (open, on the branch) records that a whole-record arrow
`address -> address` leaves its leaves counted uncovered, and correctly
identifies the fix as *distinguishing directly-covered paths from
prefix-registered ancestors*. That is the same model change R1 makes, so this
feature subsumes the ticket rather than duplicating it.

`sc-xnxp` (closed on the branch) fixed a fourth defect of this class: relative
`.field` paths inside `each`/`flatten` produced `items..id` and matched nothing,
so the VS Code gutter had been mis-reporting every nested field since
`each`/`flatten` landed. Regression-lock it here; it is the precedent that this
walker's nesting handling needs systematic tests, not spot fixes.

## Problems

### P1 — Coverage claims to be path-based but resolves by name

Defect 1. Two unrelated fields that share a leaf name share coverage. The
collision rate rises with nesting depth and with name reuse — i.e. with exactly
the schemas coverage analysis is for.

### P2 — Coverage silently ignores syntax the grammar permits

Defects 2 and 3. `nested_arrow` and blocks nested inside `each`/`flatten` are
invisible, so explicitly mapped fields report as spec gaps. Reviewers chase
gaps that do not exist, and — worse for trust — the repo's own canonical
nested example is one of the affected cases.

### P3 — One workspace, three completeness figures

Defect 4. A number that differs between the status bar, the viz card and the
CLI cannot gate anything, and discredits the others when a reviewer notices.

### P4 — The consumers cannot be reconciled while "covered record" is one boolean

Defects 5 and 6. Feature 35 has already committed to an acceptance criterion
requiring two of these consumers to agree, and it cannot hold for records or
for nested fixtures as things stand.

### P5 — A whole-subtree arrow reports gaps the author has closed

`3cc-iedv`. Mapping a record wholesale is legal and meaningful; today it covers
the record node and none of its leaves.

## Requirements

### R1 — Distinguish direct coverage from derived coverage (fixes P1, P5)

Replace the flat `Set<string>` with a model that records *why* a path is
covered. Minimally: a set of **directly covered** paths (an arrow wrote exactly
this) separate from the derived-ancestor relation, which is recomputable from
it.

- Delete the bare-segment registration. A path's coverage is decided by its
  qualified path, never by a name match at another depth.
- Derive, rather than store, the answers consumers need:
  - leaf covered ⇔ its qualified path is directly covered, **or** it descends
    from a directly-covered container (R5).
  - container state ⇔ computed from its descendant leaves (R2).
- Keep `isCoveredFieldPath(path, set)` working for consumers that only need the
  boolean, so the change is additive at the call sites that do not care.
- Audit every consumer for name-based probes and fix them:
  - `satsuma-cli/src/commands/fields.ts:193` — drop the `mapped.has(f.name)`
    clause from the leaf test.
  - `satsuma-viz/src/components/sz-schema-card.ts:656-658,722` and
    `sz-mapping-detail.ts:526,546` — confirm qualified-path probes.
- **This makes coverage stricter and existing figures will drop.** That is the
  correction, and it must be called out in `CHANGELOG.md`.

### R2 — One tri-state definition of container coverage (fixes P4)

| State | Meaning |
|---|---|
| `covered` | every descendant leaf is covered |
| `partial` | at least one, but not all, descendant leaves are covered |
| `uncovered` | no descendant leaf is covered |

Leaves stay binary. This subsumes both existing consumers without either
changing what it shows:

- LSP gutter paints on `covered || partial` — today's behaviour exactly.
- CLI review queue lists anything not `covered` — today's behaviour exactly.
- Feature 36 R2 gains the signal it lacks: a record with 1 of 12 leaves mapped
  can render differently from a fully mapped one.

`FieldCoverageEntry.mapped` is an existing contract, so **add** the state rather
than repurposing `mapped`, and define `mapped = state !== "uncovered"` for
containers so LSP output is byte-identical.

### R3 — One percentage convention (fixes P3)

- Leaves only, as the branch's `coverage-rollup.ts` already implements. Keep it.
- Reconcile the two shipped counters to it: `computeTargetCoverageStats`
  (vscode) and `_countFields`/`_countMapped` (viz card) both stop counting
  containers and delegate to the core rollup instead of computing their own.
- Report container states as counts alongside
  (`records: {covered, partial, uncovered}`) — useful review information, but
  not a percentage.
- Document the invariant: **a schema's percentage is unchanged by re-nesting.**
  Same leaves, same arrows, same number.

### R4 — Walk every nesting construct the grammar permits (fixes P2)

The immediate fix **has landed** — `sl-qzy3`, in PR #405 before it merged. It
handles `nested_arrow` in the body walk and recurses on the shared
`_nested_block_item` production rather than enumerating permitted children per
parent, so a future grammar addition cannot silently fall through a fourth
time. Defects 2 and 3 are closed.

What remains here:

- **Stop maintaining a second walker.** `extract.ts` already handles every
  construct uniformly and is why `fields --unmapped-by` was correct before it
  was re-based. Deriving covered paths from extraction removes Defects 2, 3 and
  5 as a class instead of patching each — **four** have now been found by
  inspection (`sc-xnxp`, the two in `sl-qzy3`, and the unresolved schema prefix
  in `sl-joeq`) and none by a test. Open Question 1 is **resolved in favour of
  deriving**, so `sl-vu22` stands as specified.
- Correct `viz-model`'s `EachBlock`/`FlattenBlock` to carry nested flatten
  blocks and a flatten target, and remove the comment at
  `viz-backend/src/viz-model.ts:1040-1043` asserting the grammar forbids nested
  flatten — `grammar.js:265-270`, `each_flatten.txt:331-374` and
  `examples/nested-iteration/pipeline.stm:100` each contradict it.

### R5 — Whole-subtree arrow semantics (fixes P5, closes `3cc-iedv`)

An arrow whose path resolves to a record or list-of-record node covers that
node's **entire subtree**. `addr -> address` between two records asserts the
structure maps across; reporting its leaves as gaps reports a gap the author
closed. R1's direct/derived split is what makes this expressible — the record
is *directly* covered, so its descendants inherit; a record that is merely an
ancestor of a covered leaf does not confer anything downward.

Close `3cc-iedv` as part of this requirement.

### R6 — Cross-consumer parity is tested (fixes P3, P4)

Feature 36 requires overlay numbers to equal `coverage --json`. That needs a
test that fails when it breaks: one nested fixture, computed through the CLI
path and the viz-backend path, asserting **identical leaf verdicts, identical
container states, identical percentages**.

This is also the test that catches spread-expansion divergence. The three
consumers expand fragment spreads at three different points: the CLI before
filtering (`expandNestedSpreads` / `expandEntityFields` in `fields.ts:74-82`),
viz at model-build time (`viz-model.ts:266-298`), and **the LSP/core coverage
path not at all** — so fields a schema acquires via `...fragment` are currently
invisible to the gutter and status bar while the CLI lists them.

### R7 — `[]` normalization hygiene (low priority)

`addPathAndPrefixes` strips `[]` on write; `isCoveredFieldPath` does not on
read, so a probe containing `[]` never matches. Note this is **dead code for
current syntax** — `[]` was removed from paths in v2 (`grammar.js:429-431`) and
cannot parse. Either make the normalization symmetric via one shared helper, or
delete it and keep a test asserting bracket paths do not parse. Do not leave it
asymmetric and undocumented.

## Acceptance Tests

Minimal snippets per the test quality standards, except where a named repo
fixture is the point. Cases 1–9 must **fail** against `fc3d5a5`.

### Path-based, not name-based (R1)

1. **Top-level field shadowed by a nested leaf.** Top-level `city` plus
   `home_address record { city, line1 }`; only `home_address.city` mapped. →
   top-level `city` **uncovered**. *(Today: covered.)*
2. **Sibling records sharing a leaf name.** Same fixture. →
   `work_address.city` **uncovered**. *(Today: covered.)*
3. **Sibling list containers sharing a leaf name.** `orders.lines{sku,qty}`
   fully mapped in nested `each`; `orders.packed{sku,units}` unmapped. → both
   `packed` leaves **uncovered** and `orders.packed` is `uncovered`, not
   `partial`. *(Today: `packed.sku` covered.)*
4. **Deep-segment leak.** Only `a.b.c.d` mapped, schema also declares top-level
   `b`, `c`, `d`. → all three **uncovered**. *(Today: all covered.)*
5. **One fragment spread into two sibling records.** Use
   `examples/lib/sfdc_fragments.stm`'s shape: `...sfdc address` spread into both
   `BillingAddress` and `ShippingAddress`. Map only `BillingAddress.Street`. →
   `ShippingAddress.Street` **uncovered**. *(Today: covered — and this is a
   shipped example, not a contrived case.)*
6. **Repeated leaf names at four depths — as already committed.**
   `satsuma-cli/test/fixtures/deep-nested-bugs.stm` (ISO-20022 pacs.008)
   declares four `BIC` leaves — `GrpHdr.InstgAgt`, `GrpHdr.InstdAgt`,
   `CdtTrfTxInf.DbtrAgt`, `CdtTrfTxInf.CdtrAgt` — and its mapping covers three
   of them, leaving `GrpHdr.InstdAgt.BIC` unmapped.
   → `GrpHdr.InstdAgt.BIC` **uncovered** and `GrpHdr.InstdAgt` `uncovered`.

   Today both are omitted entirely:

   ```
   $ satsuma fields pacs008 --unmapped-by 'pacs008 to iso_target' deep-nested-bugs.stm
     GrpHdr  record
       MsgId  STRING
   ```

   The instructed-agent BIC is silently reported as mapped because the
   instructing-agent BIC is. Confusing those two is precisely the error
   coverage analysis exists to catch in payment messaging, and the fixture is
   already in the repo — no contrived input needed to demonstrate the defect.

### Unwalked syntax (R4)

7. **`nested_arrow`.** `addr -> address { .street -> .street_line  .city ->
   .city }` (the `nested-arrow-lookup.stm` shape). → the four written paths
   `covered`, unwritten siblings `uncovered`. *(Today: all uncovered.)*
8. **`flatten` nested inside `each`.** `examples/nested-iteration/pipeline.stm`
   verbatim. → `orders.parcels.contents.sku`, `.units` and
   `orders.packed_items.sku`, `.units` `covered`; `orders.parcels.barcode` the
   **single** uncovered source leaf; target percentage **100%** and source
   **89%**. *(Today: whole flatten subtree uncovered, 75% and 67%.)* Assert the
   percentages, not just the booleans — the percentage is what gates CI.
9. **`each` nested inside `flatten`.** The corpus already has the inverse
   fixture (`each_flatten.txt:331-374`); add the mirror. → inner arrows
   contribute coverage.
10. **Relative-dot regression lock** (`sc-xnxp`). `each items -> lines { .id ->
    .item_id }` → `items.id` and `lines.item_id` `covered`. Locks a fix that had
    no test before the branch.
11. **`each` with a dotted multi-segment target.** From
    `examples/cobol-to-avro/pipeline.stm:148`, `each PHONE_NUMBERS ->
    contact_info.phones` → inner arrows qualify under the full target path.
12. **Two `each` blocks writing the same target list.** From
    `examples/edi-to-json/pipeline.stm:106-171`, where `LineItems` and
    `Quantities` both target `ShipmentHeader.asnDetails.items` → union, no
    double counting, percentage ≤ 100%.

### Container tri-state (R2)

13. One of three leaves mapped → `partial`, with `mapped === true` so the
    gutter is unchanged.
14. Three of three → `covered`. Zero of three → `uncovered`,
    `mapped === false`.
15. **`partial` propagates upward; `covered` does not.** `a record { b record {
    x, y } }`, only `a.b.x` mapped → `a.b` **and** `a` are `partial`, neither
    `covered`.
16. **Container referenced but no leaf.** `each parcels -> .packed { }` — empty
    body. → `packed` is `uncovered`. A container reference must not manufacture
    leaf coverage.
17. **Computed arrow into a container.** From `edi-to-json`,
    `-> ShipmentHeader.asnDetails.containers { "…no source data…" }` where the
    container's four leaves have no arrows → decided-and-documented state;
    proposed `uncovered` with the container's own `mapped` true, because the
    example's own `//!` markers assert those leaves are a known data gap.

### Percentage (R3)

18. **Containers excluded.** `amount` + `address record { city, line1,
    postcode }`, only `address.city` mapped → **25%** (1/4), not 40% (2/5).
19. **Depth invariance.** Two schemas, same four leaves, one flat and one
    nested three deep, same arrows → **identical** percentages.
20. **All three surfaces agree.** The 25% fixture reports 25% from the core
    rollup, the VS Code status bar, and the viz card. *(Today: 25%, 100% and
    40% respectively.)*
21. Container counts reported separately: `records: {covered: 0, partial: 1,
    uncovered: 0}`.

### Whole-subtree arrows (R5)

22. `addr -> address`, both records with three leaves → all three leaves
    `covered`, `address` `covered`, 3/3.
23. **Direct vs derived is not confused.** In one schema: `address` covered by a
    whole-record arrow, `billing` covered only by an arrow to `billing.city`. →
    `address`'s leaves all `covered`; `billing.line1` **uncovered**,
    `billing` `partial`. This is the case `3cc-iedv` says a naive
    ancestor-inheritance fix would break.
24. Whole-subtree arrow plus a more specific sibling arrow → no double count.
25. Whole-subtree arrow onto a `list_of record` → same expansion.

### Parity and spreads (R6)

26. One nested fixture through the CLI path and the viz-backend path →
    identical leaf verdicts, container states and percentage.
27. **Spread-materialised nested fields are counted in every consumer.** Use
    `satsuma-cli/test/fixtures/nested-record-spread.stm`, where a record body
    contains only `...address_fields`. → `address.street`/`.city` appear as
    coverage entries with correct states in the CLI, core and viz paths.
    *(Today the core/LSP path does not expand spreads at all, so they are
    absent from both numerator and denominator.)*
28. Spread into a `list_of record` body — no fixture exists anywhere; add one.

### Regression

29. `satsuma coverage` over `examples/nested-iteration/pipeline.stm` reports
    exactly one uncovered source leaf: `orders.parcels.barcode`.
30. Corpus gap: no tree-sitter fixture spreads a fragment into a record body,
    and none nests `each` inside `flatten`. Add both.
31. The LSP coverage suite passes; tests encoding a defect above are updated
    with a comment citing this feature.

## Out of Scope

- Coverage *policy* — whether a gap is acceptable. Unchanged from Feature 35:
  the count is deterministic, policy is lint (Feature 37).
- Whether the two ends of a whole-subtree arrow have *compatible* record
  shapes. R5 defines the coverage consequence only; structural comparison is a
  plausible future lint rule.
- Revising `each`/`flatten` path *relativity* rules. `extract.ts`'s
  accumulating-prefix contract is correct and is only regression-locked here.
- ~~NL-derived coverage. A field populated only by prose stays uncovered.~~
  **Superseded by ADR-036** (implemented in `sl-qxyl`, which landed before this
  feature). A resolved `@ref` counts, as a distinct `nl` tier. R1's direct/derived
  split and R2's container tri-state compose with it: the tier says *how* a leaf
  was covered, the tri-state says *how much* of a container is.
- Coverage history or trends.

## Open Questions

1. **One walker or two?** (`sl-vu22`) **Resolved — derive from extraction.**
   R4 could have been satisfied by patching the CST walker (`nested_arrow` +
   nested-block recursion) or by deriving covered paths from `extract.ts`'s
   arrow output, which already handles every construct and is why the CLI was
   correct today. Patching was smaller; deriving deletes Defects 2, 3 and 5 as a
   class and removes a whole duplicate walker. `sl-vu22` therefore stands as
   specified and is the structural half of R4.

   Two things settled the question after the PRD was written:

   - **A fourth defect of the same class turned up, in `sl-joeq`.** The CST
     walker never resolved an arrow's schema prefix at all — the qualified form
     multi-source mappings use (`crm_customers.email -> email`) matched only via
     the bare-segment leak, and so could never reach a *nested* declared path.
     `extract.ts`'s consumers (`arrows.ts`, `graph-builder.ts`) had handled
     schema qualification for some time. That is now four defects found by
     inspection and none by a test, each one a rule the walker lacked and
     extraction already had.
   - **The gutter check the ticket asked for comes back clean.** The VS Code
     gutter consumes `FieldCoverageEntry.line`, which propagates from
     `CoverageField.line` supplied by the *consumer's resolver* (the LSP maps
     `FieldInfo.range.start.line` in `satsuma-lsp/src/coverage.ts`) — not from
     the arrow walk, which contributes path strings only. So no consumer depends
     on per-node positions that extraction cannot supply. `ExtractedArrow`
     carries `line`/`startColumn` in any case.

   `sl-joeq` also left the seam in place: `collectBodyPaths` now yields a
   `string[]` of container-qualified *authored* references, and
   `schemaLocalFieldPath` resolves them per schema on top. `ExtractedArrow`'s
   `sources`/`target` are already absolute authored paths of exactly that shape,
   so the substitution is a swap of the producer, with the resolution step
   unchanged. See **ADR-035**.
2. **Should the leak fix ship ahead of this feature?** **Resolved** — raised as
   `sl-joeq` (P1 bug), fixable now against `main` independently of Features
   35/36, with this epic depending on it. A silent over-count in a shipped
   command should not wait for a feature. `sl-joeq` is scoped to the leak
   only; the structural work stays here.
3. **Ordering against Feature 35 — overtaken by events.** An earlier draft
   proposed landing this feature before `sl-tdfx` published the `--json`
   contract. `sl-tdfx` has landed on PR #405; `SATSUMA-CLI.md:145` already
   describes `--json` as "a **stable contract**, consumed by the satsuma-viz
   coverage overlay". So the question is now how to change a published contract:

   - R2's tri-state is **additive** — a new field alongside `mapped`, which
     keeps its meaning. Safe.
   - R1 and R5 change **values, not shape**: the same fields report
     different coverage, and percentages move in both directions (up where
     false negatives are fixed, down where false positives are). Every one of
     those movements is a correction, but a consumer that has recorded a number
     will see it change.

   `sl-qzy3` took this route already: it landed inside PR #405, since it was a
   regression in that PR's own work, and its value changes shipped with the
   contract rather than after it. Proposed for the rest: treat it as a
   documented contract revision with a `CHANGELOG.md` entry, and land it before
   Feature 36's overlay ships so the two do not disagree in public. `sl-joeq`
   need not wait for anything.
4. **Is `partial` the right shape?** (`sl-0pun`) Proposed: three named states,
   leaves never `partial`. The alternative — `coveredLeaves`/`totalLeaves`
   counts on every node and no named states — is more data but pushes the "is
   this done?" judgement onto every consumer, which is how the current
   disagreement arose.
5. **Case 17: computed arrow into a container.** Proposed `uncovered` for the
   leaves with the container's own `mapped` true, but this is a judgement call
   about whether "I have declared this a data gap" should read as coverage.

## Ticket Map

| Requirement | Ticket | Depends on |
|---|---|---|
| **Prerequisite bug** — bare-segment leak (false positives) | `sl-joeq` (P1) | — |
| ~~Prerequisite bug — unwalked nesting + `--unmapped-by` regression~~ | `sl-qzy3` — **done**, merged in #405 | — |
| Epic | `sl-j6g9` | `sl-joeq` |
| R1 direct vs derived coverage | `sl-fmx0` | `sl-joeq` |
| R2 container tri-state | `sl-0pun` | `sl-fmx0` |
| R3 percentage — viz card | `sl-hcan` | `sl-0pun` |
| R3 percentage — VS Code status bar | `3cc-t6uo` *(from #405, now on `main`)* | — |
| R4 remove the duplicate walker | `sl-vu22` | `sl-qzy3` ✓ (settles OQ1) |
| R5 whole-subtree arrows (closes `3cc-iedv`) | `sl-r6b0` | `sl-fmx0` |
| R6 cross-consumer parity + spreads | `sl-5nsv` | `sl-0pun`, `sl-hcan`, `sl-vu22` |
| R7 `[]` hygiene | `sl-8o1n` | — |
| Corpus fixture gaps (case 30) | `sl-2nxu` | — |

Two tickets came from PR #405 and are **not** duplicated here: `3cc-iedv`
(whole-record arrows — closed by `sl-r6b0`) and `3cc-t6uo` (the status-bar
denominator — the other half of R3). Both are now on `main`.

`sl-joeq`, `sl-8o1n`, `sl-2nxu` and `sl-vu22` are ready immediately.
`sl-joeq` is the one to schedule first — a silent over-count in shipped
commands — and `sl-vu22`'s open question should be answered before R1 starts,
since it decides whether there is one derivation path or two.
