---
id: bsw-03xr
status: open
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-sweep-2026-10, cli, nl, adr-053]
---
# cli: satsuma nl <schema.field> omits notes on arrows written with ^. or $.

```satsuma
schema src { sid STRING  orders list_of record { oid STRING } }
schema tgt { tid STRING  copy STRING  rows list_of record { sref STRING  oref STRING } }
mapping m {
  source { src }
  target { tgt }
  sid -> tid { "plain note on sid" }
  $.sid -> copy { "root escape note on sid" }
  each orders -> rows {
    $.sid -> .sref { "nested root escape note" }
    .oid -> .oref { "relative note" }
  }
}
```

`satsuma nl src.sid` prints only "plain note on sid". `collectFieldArrowNL` (`tooling/satsuma-cli/src/commands/nl.ts:273-275`) compares raw path text after stripping only a leading dot, instead of the resolved path core already computes.

## Acceptance Criteria

- `nl` matches arrows by resolved source/target path; the repro lists all three notes; test added.
