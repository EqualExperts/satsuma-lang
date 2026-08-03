---
id: sl-fncf
status: open
deps: []
links: []
created: 2026-08-03T11:29:07Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [viz-harness, security]
---
# Viz harness servers bind all interfaces instead of loopback

Both harness HTTP servers call listen(PORT) with no host argument, so Node binds 0.0.0.0/:: (all interfaces) rather than loopback. While a test run or dev session is in progress, ports 3333 and 3334 are reachable from any host on the same network.

Exposed surface on 3333: GET /api/fixtures (absolute filesystem paths of every .stm under examples/) and GET /api/source?uri=... (full source text of any discovered fixture). Port 3334 serves the assembled static playground bundle.

The fixture API is allowlist-keyed by discovered URI, so this is not a path-traversal or arbitrary-file-read issue -- the impact is bounded to disclosing local example/corpus content plus absolute paths to the local network. Low severity, but neither server has any reason to be off-box: the harness is a single-machine Playwright/dev tool and its own log lines already say http://localhost.

Sites:
- tooling/satsuma-viz-harness/src/server.ts:276
- tooling/satsuma-viz-harness/scripts/serve-playground.mjs:69

Found during a security review of the agent viz-testing workflow.

## Acceptance Criteria

- Both servers bind loopback explicitly: listen(PORT, "127.0.0.1").
- A comment at each call site states why loopback is deliberate (single-machine harness; do not widen without a reason).
- Playwright suites still pass unchanged: baseURL http://localhost:3333 and http://localhost:3334 resolve to loopback, so no test needs editing.
- A unit test or assertion covers the bind host so a future edit cannot silently re-widen it.

