---
id: sl-wz2h
status: closed
deps: []
links: []
created: 2026-08-04T10:28:48Z
type: chore
priority: 2
assignee: Thorben Louw
---
# Cache wasi-sdk toolchain across CI/release/deploy workflows

tree-sitter build --wasm downloads a ~119MB wasi-sdk-29 toolchain into ~/.cache/tree-sitter on every invocation because none of ci.yml, deploy-site.yml, or release.yml persist that cache directory across runs. It happens twice per CI run (install job + vscode-extension job) and once each in deploy-site.yml and release.yml.

## Acceptance Criteria

actions/cache added before each 'tree-sitter build --wasm' step (ci.yml install job, ci.yml vscode-extension job, deploy-site.yml deploy job, release.yml artifacts job), keyed on hashFiles(tooling/tree-sitter-satsuma/package-lock.json) so a tree-sitter-cli version bump (which pins the wasi-sdk download URL) invalidates the cache rather than silently reusing a stale SDK.


## Notes

**2026-08-04T10:31:14Z**

**2026-08-04T00:00:00Z**

Cause: `tree-sitter build --wasm` downloads a ~119MB wasi-sdk-29 toolchain into `~/.cache/tree-sitter` on every invocation; none of `ci.yml`, `deploy-site.yml`, or `release.yml` persisted that directory across runs, so it re-downloaded on every job that builds the WASM parser (twice per CI run, once each for deploy-site and release).
Fix: added an `actions/cache` step before each of the 4 `tree-sitter build --wasm` invocations, caching `~/.cache/tree-sitter` keyed on `hashFiles('tooling/tree-sitter-satsuma/package-lock.json')` so a `tree-sitter-cli` version bump (which pins the wasi-sdk download URL) invalidates the cache rather than reusing a mismatched SDK (commit immediately after 8e69721c).
