---
id: cbdr-yp9m
status: open
deps: [cbdr-o6xn]
links: []
created: 2026-08-03T15:34:49Z
type: task
priority: 1
assignee: Thorben Louw
parent: gcsc-qka8
tags: [feature-39, r3, core, formatter, property-testing]
---
# core: add generated formatter round-trip properties

Complete Feature 39 R3 by reusing its semantic scenario generator to exercise formatter round-trips over generated valid Satsuma in addition to the canonical examples corpus.

## Design

Consume the test-only scenario renderer from cbdr-o6xn rather than creating a second arbitrary grammar-string generator. For every generated source, establish the recovery-free parse precondition, format it, reparse the output, and check the three formatter properties independently: idempotence, CST structural equivalence, and error-free reparse. Share small structure/error helpers with existing formatter tests where doing so removes duplication without weakening the canonical corpus coverage. Preserve fast-check replay diagnostics and include the shrunk Satsuma source in failures.

## Acceptance Criteria

generated formatter properties reuse cbdr-o6xn's semantic scenarios and renderer; every property test opens with a purpose comment naming the invariant it protects; generated source parses with no ERROR or MISSING nodes before formatting and formatted output reparses with no recovery nodes; format(format(source)) equals format(source); formatting preserves CST structure under the repository's existing structure comparison; failures report seed, replay path, and shrunk source; canonical corpus round-trip tests and all focused formatter regressions remain in place; the complete satsuma-core test suite passes.
