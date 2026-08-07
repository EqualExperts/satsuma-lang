---
id: gpt-i1uv
status: closed
deps: []
links: []
created: 2026-08-06T15:20:48Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [cli, lint]
---
# lint: unenumerated-record-target is silent for any schema that spreads a fragment, resolved or not

endpointKind in tooling/satsuma-cli/src/lint-engine.ts:621 does `if (!schema || schema.hasSpreads) continue;`, but its own doc-comment (lines 605-612) says only a schema with UNRESOLVED spreads is skipped, because an incomplete field list would make the rule a false positive. hasSpreads is set at extraction time for every spread (tooling/satsuma-core/src/extract.ts:87) whether or not the fragment resolves, so the rule goes silent for every spread-bearing schema.

Proven differentially, not inferred. Two mappings with a byte-identical arrow shape, differing only in whether the target schema spreads a fragment declared in the SAME file:

    fragment audit_fields { loaded_at STRING }
    schema src { full_name STRING }
    schema tgt_no_spread   { address record { line STRING } }
    schema tgt_with_spread { address record { line STRING } ...audit_fields }
    mapping without_spread { source { src } target { tgt_no_spread }   full_name -> address }
    mapping with_spread    { source { src } target { tgt_with_spread } full_name -> address }

`satsuma lint --select unenumerated-record-target` reports the without_spread arrow and says nothing about the with_spread one. The fragment is declared in the same file and resolves, so the stated justification for skipping does not apply.

Found while building Feature 46's defect mutators (gpt-pwze). The mutator targetRecordWithoutChildren correctly declines spread-bearing targets rather than predicting a diagnostic the rule cannot emit, so the mutator is not wrong — but it means the generated properties cannot reach this rule for spread-bearing schemas either.

## Acceptance Criteria

The rule fires for a schema whose spreads all resolve, and stays silent only when a spread cannot be resolved — matching what the doc-comment already claims. A test pins both halves using the differential pair above (same arrow, spread and no spread). Whatever notion of 'unresolved' the fix uses is available to the rule without re-implementing spread expansion; check whether core already exposes it before adding a second mechanism.


## Notes

**2026-08-07T11:32:29Z**

Cause: endpointKind in lint-engine.ts skipped any schema with hasSpreads set (extract.ts sets it for every fragment spread regardless of resolution), so unenumerated-record-target went silent for spread-bearing schemas even when the spread fully resolved. Fix: endpointKind now calls core's expandSpreads (via the CLI's spread-expand.ts adapter) to distinguish unresolved from resolved spreads, skipping only the former and, for the latter, judging containerness against the fully expanded field list from expandDeclaredFields instead of the raw unexpanded fields. (commit immediately after 1bf0e046)
