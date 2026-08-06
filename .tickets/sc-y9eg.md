---
id: sc-y9eg
status: closed
deps: []
links: []
created: 2026-08-06T17:35:39Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [tooling, ci]
---
# test-stats generator cannot read a colourised Turborepo task log

scripts/generate-test-stats.mjs anchors its summary pattern to the line (/^(?:i|#)\s+tests\s+(\d+)\s*$/m) so a test named 'tests' cannot be mistaken for the summary. Node colourises that line, so a task that actually executes writes '\x1b[34m<i> tests 7\x1b[39m' into tooling/<pkg>/.turbo/turbo-test.log and the pattern no longer matches. The pre-commit hook then fails its last step with 'Could not find a node --test summary line'. It stays hidden because a Turborepo cache HIT replays a log captured without a TTY, and therefore without colour - so the step passes run after run and fails the first time an unrelated dependency change invalidates the cache. Found when adding yaml to root devDependencies invalidated every package's test task.

## Acceptance Criteria

SGR escapes are stripped before matching, at every parse site; a regression test asserts a colourised summary line parses; the pre-commit hook completes its test-stats step after a cold (cache-miss) run


## Notes

**2026-08-06T17:35:45Z**

Cause: NODE_TEST_SUMMARY_PATTERN and CORPUS_SUMMARY_PATTERN are anchored to the line, but Node colourises its summary, so a Turborepo task that actually executes records ESC[34m<i> tests 7ESC[39m and the anchors no longer match. Masked in normal use because a cache hit replays a colourless log.
Fix: strip SGR escapes in parseNodeTestCount, parseCorpusTestCount and tryParseCorpusTestCount via a shared withoutAnsi helper, keeping the anchors that make the pattern unambiguous; added a regression test using a real colourised line. (commit immediately after d5a2c6b3)
