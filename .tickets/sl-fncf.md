---
id: sl-fncf
status: closed
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


## Notes

**2026-08-06T13:12:53Z**

**2026-08-06T13:20:00Z**

Cause: Both server.ts and serve-playground.mjs called listen(PORT) without a host argument, so Node bound to 0.0.0.0 (all interfaces), exposing ports 3333 and 3334 to any host on the network.

Fix: Added explicit loopback binding: listen(PORT, "127.0.0.1", callback) on both servers, with comments stating the rationale. Added unit tests verifying the bind host and documenting the vulnerability. (commit immediately after 2893e036)
