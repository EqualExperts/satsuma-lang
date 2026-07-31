---
id: sl-cysb
status: closed
deps: []
links: []
created: 2026-07-31T14:49:04Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [tree-sitter, ci, docs]
---
# tree-sitter: corpus test path is native, contradicting the WASM-only convention

AGENTS.md:197, docs/developer/AGENT-CONTRIBUTIONS.md:162 and README.md:396 all state the convention: always use --wasm, there is no native build in this repository. Two invocations ignore it:

- tooling/tree-sitter-satsuma/package.json 'test': `tree-sitter generate && tree-sitter test` (no flag)
- .github/workflows/ci.yml:250: `node_modules/.bin/tree-sitter test` (no flag)

A test:wasm script exists with the correct flag and nothing invokes it — dead since it was added. scripts/run-repo-checks.sh already uses --wasm, so the repo is inconsistent with itself.

Consequence: `npm test` in that package requires a C toolchain, which is the portability the convention exists to protect. Verified in the agent sandbox — the native path fails with 'clang: unable to execute command: posix_spawn failed' even with a writable cache, while --wasm passes all 315 parses.

Second, separate gap in the guidance: --wasm is necessary but NOT sufficient. Both the native and the --wasm path write compiled artifacts into ~/.cache/tree-sitter, which a sandboxed agent cannot write, producing an opaque 'Operation not permitted (os error 1)' on a lock-file path. The working invocation needs XDG_CACHE_HOME redirected to a writable directory. Without that documented, an agent hits the lock error and reasonably concludes the corpus tests cannot be run locally at all — which is what happened during feature 35 (PR #405) and led to the grammar suite being reported as unverifiable.

## Acceptance Criteria

package.json 'test' uses --wasm and the redundant test:wasm script is removed; ci.yml runs the corpus tests with --wasm; AGENTS.md and AGENT-CONTRIBUTIONS.md document the XDG_CACHE_HOME redirect with a copy-pasteable command and state that npm test in that package is the WASM path; corpus tests verified passing locally via the documented command; CI green.


## Notes

**2026-07-31T14:51:00Z**

Cause: tooling/tree-sitter-satsuma/package.json's 'test' script and .github/workflows/ci.yml:250 both ran bare `tree-sitter test`, compiling the grammar natively, while AGENTS.md:197, AGENT-CONTRIBUTIONS.md:162, README.md:396 and scripts/run-repo-checks.sh all specify --wasm. A test:wasm script with the correct flag existed and nothing invoked it.
Fix: 'test' now runs `tree-sitter generate && tree-sitter test --wasm` and the redundant test:wasm script is deleted; ci.yml runs the corpus tests with --wasm and a comment citing the convention. Verified: `npm --prefix tooling/tree-sitter-satsuma test` passes 315/315.

Second gap fixed in the same change — the guidance was incomplete, not just unenforced. --wasm is necessary but not sufficient in the agent sandbox: both paths compile into ~/.cache/tree-sitter, which is unwritable there, and the failure surfaces as 'Operation not permitted (os error 1)' on a lock-file path that looks nothing like a permissions problem. AGENTS.md and AGENT-CONTRIBUTIONS.md now document the XDG_CACHE_HOME redirect with a copy-pasteable command and state explicitly not to conclude the corpus tests are unrunnable locally. That wrong conclusion is what happened during feature 35 (PR #405), where the grammar suite was reported as unverifiable when it was in fact runnable.
