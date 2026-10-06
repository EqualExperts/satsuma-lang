---
id: sg-pufq
status: closed
deps: []
links: []
created: 2026-03-20T12:48:11Z
type: bug
priority: 1
assignee: Thorben Louw
parent: stm-7rz4
tags: [cli, lineage, graph, namespaces]
---
# satsuma lineage --to drops additional upstream branches and returns only one path

The upstream walk behind satsuma lineage --to appears to keep only a single predecessor chain instead of the full upstream graph. In examples/ns-platform.stm, satsuma lineage --to mart::dim_contact examples/ns-platform.stm returns only raw::crm_contacts -> vault::load hub_contact -> vault::hub_contact -> mart::build dim_contact -> mart::dim_contact, but it omits the parallel upstream branch through vault::sat_contact_details even though that schema is also a declared source of mart::build dim_contact. Similarly, satsuma lineage --to mart::fact_deals omits multiple upstream contributors and prints just one route.

## Acceptance Criteria

1. satsuma lineage --to mart::dim_contact examples/ns-platform.stm includes both upstream sources of mart::build dim_contact: vault::hub_contact and vault::sat_contact_details.
2. satsuma lineage --to mart::fact_deals examples/ns-platform.stm surfaces all declared upstream branches rather than a single arbitrarily chosen path.
3. The text and JSON forms remain deterministic and preserve all reachable upstream nodes and edges within the requested depth.
4. Add regression coverage for a target schema with at least two upstream source schemas feeding the same mapping.

