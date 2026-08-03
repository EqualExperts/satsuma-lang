# AGENTS.md

## Project Summary

Satsuma is a domain-specific language for source-to-target data mapping. The repository contains the language specification, a canonical example corpus, a tree-sitter parser, a multi-command CLI for structural extraction and validation, and a VS Code syntax highlighting extension.

All tooling is parser-backed. Downstream tools should be built on the tree-sitter CST and stable AST conventions rather than ad hoc text processing.

## Repository Layout

- `docs/developer/SATSUMA-V2-SPEC.md`: authoritative language specification (v2)
- `docs/product-owner/PROJECT-OVERVIEW.md`: product vision, motivation, and roadmap
- `SATSUMA-CLI.md`: CLI command reference
- `AI-AGENT-REFERENCE.md`: compact grammar and agent-oriented Satsuma guidance (v2) — also available via `satsuma agent-reference`
- `HOW-DO-I.md`: question-based index to all guides and conventions
- `docs/product-owner/ROADMAP.md`: deferred work items, ideas, and convention docs still to write
- `examples/`: canonical `.stm` examples and fixtures (v2 syntax)
- `archive/v1/`: archived v1 specification and examples — for historical reference only, not for new work
- `archive/features/`: completed feature specs (30 feature directories) — for historical reference only
- `features/`: active feature plans (features 30–37; 35–37 are proposed and not yet started)
- `useful-prompts/`: self-contained system prompts for web LLMs (Excel-to-Satsuma, Satsuma-to-Excel)
- `skills/`: Agent Skills following the [agentskills.io](https://agentskills.io) standard (Excel-to-Satsuma conversion skill, Satsuma-to-Excel export skill)
- `scripts/`: utility scripts used during development
- `tooling/tree-sitter-satsuma/`: tree-sitter grammar (318 corpus tests), generated parser artifacts, and queries
- `tooling/satsuma-core/`: **the shared library every other package builds on** (679 tests) — parsing, extraction, validation, formatting, NL `@ref` resolution, and the single definition of coverage semantics. Logic that more than one consumer needs belongs here; see [Core vs Consumer Packages](#core-vs-consumer-packages)
- `tooling/satsuma-scenario-gen/`: **test-only** generator of semantic Satsuma scenarios shared by every package's property suites — builds scenarios as plain data, renders them to source, and states the ground truth that follows by construction. Must never depend on `@satsuma/core` (core's tests depend on it, so the reverse edge would be a cycle); the adapters that drive production pipelines live in each consumer's test tree
- `tooling/satsuma-cli/`: TypeScript CLI tool for workspace extraction, validation, and structural analysis (1031 tests)
- `tooling/satsuma-lsp/`: editor-agnostic Language Server (semantic tokens, diagnostics, go-to-definition, find-references, completions, hover, rename, code lens, folding, document symbols); runnable standalone via `npx satsuma-lsp --stdio` (300 tests)
- `tooling/satsuma-viz-model/`: the VizModel protocol contract (6 tests) — the payload shape the LSP produces and the viz component consumes, defined once so neither can drift
- `tooling/satsuma-viz-backend/`: workspace indexing and VizModel assembly shared by the LSP and browser hosts (182 tests); also computes the field coverage the payload carries (ADR-042)
- `tooling/satsuma-viz/`: the `satsuma-viz` Lit web component (128 tests) — overview graph and per-mapping detail view, embedded in the VS Code webview and the site playground
- `tooling/satsuma-viz-harness/`: Playwright harness for the viz component (99 tests) — human-in-the-loop, see [Viz harness Playwright tests](#viz-harness-playwright-tests-human-in-the-loop-workflow)
- `tooling/vscode-satsuma/`: VS Code extension (LSP client, commands, webview panels) and TextMate grammar; delegates language intelligence to `satsuma-lsp` (34 tests)

## Platform Lineage Entry Point

When reasoning about lineage across a multi-file data platform, look for a **platform entry point file** that uses `import` with namespace-qualified names to pull definitions from across the platform. This is the canonical entry point for platform-wide lineage traversal.

```satsuma
// platform.stm — the entry point
import { crm::customers, crm::orders } from "crm/pipeline.stm"
import { billing::invoices } from "billing/pipeline.stm"
import { warehouse::inventory } from "warehouse/ingest.stm"
```

Use `satsuma lineage --from <schema> platform.stm` to trace data flow through the platform. See `archive/features/15-namespaces/PRD.md` for the full namespace specification.

## Source of Truth

When making changes or answering questions about syntax, semantics, or supported constructs:

1. Treat `docs/developer/SATSUMA-V2-SPEC.md` as the primary authority. The v1 spec is archived at `archive/v1/STM-SPEC.md` — do not use it for new work.
2. Use `examples/` as the executable corpus of valid language patterns (v2 syntax).
3. Use feature docs in `features/` to guide tooling order and architecture.
4. If docs conflict, prefer the spec and call out the mismatch explicitly.

## Engineering Expectations

- Preserve Satsuma readability for both humans and machines.
- Prefer parser-backed solutions over regex or line-oriented heuristics.
- Keep CST/AST naming intentional and stable for downstream consumers.
- Add or update tests with every behavior change.
- Use the example corpus as golden fixtures whenever possible.
- Document any ambiguity, unsupported syntax, or recovery behavior near the implementation.

### Core vs Consumer Packages

Before closing a ticket, assess whether logic you've added or modified in a consumer package (CLI, LSP, viz, VS Code extension) is actually a **core concern** that belongs in `satsuma-core`. Shared data transformation, naming conventions, NL ref handling, and format normalization are examples of core concerns. If the logic would need to be duplicated by another consumer (e.g. the LSP needs the same utility the CLI uses), it belongs in core. Move it — including its tests — as part of the ticket work, not as deferred cleanup.

## Code Readability

**The satsuma-lang tooling is intended to be a teaching example** — the kind of codebase a developer can read to learn how to build a tree-sitter-backed language toolchain well. Every file should meet that bar. When in doubt, ask: *would a capable developer unfamiliar with this system understand what this code does, why it exists, and how it fits the whole — just by reading it?*

Write code in the spirit of Literate Programming and Clean Code: code should read as a clear explanation of *what* it does and *why*, not just a sequence of instructions for the machine. Functions should be small and focused. Names should communicate intent. Business rules should be visible, not buried.

- **Module-level comments** — every non-trivial module must open with a comment explaining its purpose, what it owns, and what it does not own. A reader skimming the file should understand its role in the system within the first five lines.
- **Function doc-comments** — exported functions must have a doc-comment that states the contract (inputs, outputs, invariants). Private helpers need a comment only when their intent is non-obvious. A doc-comment that merely restates the function name adds noise — say something a reader couldn't infer from the signature alone.
- **Type comments** — exported types and their fields must carry inline comments explaining what each field represents and how consumers use it. Type declarations are part of the public contract and should read as prose.
- **Section comments** — group logically related code with a short header comment. Modules with multiple distinct responsibilities (e.g. a validation module checking duplicates, then missing refs, then field alignment) must label each section.
- **Named constants over magic values** — raw strings, numbers, regex literals, and array indices with non-obvious meaning must be extracted to named constants with a comment explaining the value and its source. `slice(0, 8)` with no comment is not acceptable; `slice(0, MAX_PREVIEW_FIELDS)` with a comment is.
- **Small functions** — functions over ~40 lines are a signal to decompose or add sectional comments explaining the algorithm. Long functions that mix concerns must be refactored.
- **Business rules must be visible** — domain rules (e.g. Data Vault naming conventions, known pipeline function names, formatter column caps) must be clearly labelled as rules, with a comment citing their source or rationale. They must not be buried as anonymous magic values.
- **No orphan comments** — do not leave TODO/FIXME comments without a ticket reference. Link deferred work (`// see sl-xxxx`). Remove comments that describe what the code used to do.

## Testing Expectations

- Every task must end with the relevant automated tests run locally and passing before picking up the next task.
- Each task implementation must expand or update test coverage to match the behavior it adds or changes.
- Keep the repo commit hooks installed and passing; they should block commits when required validation or tests fail. See [Installing the pre-commit hook](#installing-the-pre-commit-hook) — **check it is installed before your first commit in any clone or worktree**.
- New parser or tooling work must include targeted tests and fixture coverage.
- Valid syntax changes should add or update canonical examples or corpus fixtures.
- Invalid or recovery-sensitive behavior should include malformed input tests.
- Avoid merging parser work that is only manually verified.

### Test quality standards

Tests should be high-value and low-inertia. A test suite is an asset only when the cost of maintaining it is lower than the cost of not having it.

- **Every test must have a purpose comment.** Each `it()`/`test()` block must open with a comment (or use the description string itself) explaining *why* this case exists and *what property* it validates — not just a restatement of what the code does. A future reader must understand at a glance whether a failing test represents a regression or an outdated expectation.
- **No redundant tests.** When consolidating logic into a shared module, consolidate the tests too. Do not keep tests in consumer packages that merely re-test the same behaviour already covered in the core module's test suite. Test each invariant once, at the right level of abstraction.
- **Test inputs should be minimal.** Use the smallest Satsuma snippet that exercises the case. Avoid copying full example files into test fixtures unless the whole-file structure is what is under test.
- **No smoke tests.** Do not write tests that only verify a function returns without throwing, or that a known-valid input produces a non-null result. Every assertion should validate a specific, meaningful property of the output.
- **Name cases by behaviour, not by implementation.** Prefer `"reports a diagnostic when the same schema name appears in two files"` over `"duplicate schema test"`. The description should be a falsifiable statement about the system.

### Viz harness Playwright tests (human-in-the-loop workflow)

The `tooling/satsuma-viz-harness/` Playwright tests cannot run directly in the
agent sandbox — Chromium and WebKit headless both crash on ARM macOS (SwiftShader
SIGSEGV), and even Firefox must be launched from the user's terminal.

**How this works:**

The harness uses a sentinel-file protocol so the agent can trigger runs and read
results without shell access to the browser process:

1. The human runs the watcher once in a background terminal (from the harness directory):
   ```
   ./tooling/satsuma-viz-harness/watch-and-test.sh &
   ```
   The watcher polls for `.run-tests`, runs `npm test` when it appears, and therefore
   rebuilds the core, backend, viz, and harness bundles through npm's `pretest` hook
   before Playwright starts. Build and test output is written to
   `.playwright-results.txt`, then the sentinel is removed.

2. The agent triggers a run by creating the sentinel:
   ```bash
   touch tooling/satsuma-viz-harness/.run-tests
   ```

3. The agent polls until the sentinel is gone (the watcher removes it immediately
   on pickup), then reads `.playwright-results.txt` for results.

**What to tell the human:**

When you need Playwright test results, tell the user the **full absolute path**
to the script — do not use a relative path.  You may be running inside a worktree
at a non-obvious location (e.g. `.worktrees/feat/some-feature/`) and the human
will not know which directory you mean without the full path.

Example message:

> "Please run this in a terminal if it's not already running:
> `/path/tp/clone/of/satsuma-lang/.worktrees/feat/viz-harness/tooling/satsuma-viz-harness/watch-and-test.sh`
> I'll trigger runs by touching `.run-tests` in that same directory and read
> results from `.playwright-results.txt` there."

Substitute the actual absolute path for your current working directory.  Use
`pwd` or inspect the path you are already using for file operations — you know
it.  Never make the human guess where the worktree is.

Then touch the sentinel, wait for it to disappear (the watcher picks it up within
1 second), and poll `.playwright-results.txt` until it contains `passed` or
`failed`. A full run takes roughly 30–90 seconds.

**Constraints to remember:**

- **Never** try to run `npx playwright test` directly — it will be blocked or
  will produce no usable output in the sandbox.
- **Never** try to start a browser process directly.
- The watcher rebuilds everything needed by the harness. Do not rebuild by hand
  before triggering it; confirm the fresh build output in `.playwright-results.txt`.
- The watcher kills any stale server on port 3333 before each run, so there is
  no need to manage the server separately.
- If `.playwright-results.txt` is stale (timestamp older than your sentinel
  touch), wait longer — the watcher may still be running the suite.
- Results from a prior run remain in `.playwright-results.txt` until the next
  run overwrites them. Always check the file timestamp after triggering.

## Security

CI runs `npm audit` and `gitleaks` secret scanning on every PR. Before pushing,
agents must also verify locally:

- **No secrets in commits.** Never commit API keys, tokens, passwords, or
  credentials. Check staged diffs for anything that looks like a secret before
  committing. If a secret is accidentally committed, alert the user immediately —
  do not just remove it in a follow-up commit (the value is already in git history).
- **No dependencies with critical vulnerabilities.** Run `npm audit` in any
  package directory where you added or updated dependencies. Do not merge work
  that introduces critical or high severity vulnerabilities without explicit
  user approval.
- **No `.env` or credential files.** Never stage `.env`, `credentials.json`,
  `*.pem`, or similar files. If these are needed for local development, ensure
  they are in `.gitignore`.

## Shell Command Expectations

Always use non-interactive flags with shell commands that may prompt for confirmation. Agent work must not hang waiting for terminal input from aliased or interactive defaults.

Use forms like:

```bash
cp -f source dest
mv -f source dest
rm -f file
rm -rf directory
cp -rf source dest
scp -o BatchMode=yes ...
ssh -o BatchMode=yes ...
apt-get -y ...
HOMEBREW_NO_AUTO_UPDATE=1 brew ...
```

Prefer these forms over prompt-prone variants such as plain `cp`, `mv`, or `rm`.

## Running tree-sitter CLI

**Always pass `--wasm`.** There is no native build in this repository: the
`tree-sitter-satsuma` package's `install` script deliberately skips node-gyp, and
every consumer loads `tree-sitter-satsuma.wasm`. The native path needs a C
toolchain, which is exactly the portability the WASM migration removed (ADR-002).
`npm test` in that package is already the `--wasm` path (sl-cysb) — you do not
need to add the flag yourself when using the npm scripts.

**In the agent sandbox, also redirect the tree-sitter cache.** `--wasm` alone is
not sufficient. Both the native and the WASM path compile the grammar into
`~/.cache/tree-sitter/`, which the sandbox cannot write, and the failure is an
opaque lock-file error that looks nothing like a permissions problem:

```
Error: Operation not permitted (os error 1) (~/.cache/tree-sitter/lock/satsuma-<hash>.lock)
```

Point `XDG_CACHE_HOME` at your scratchpad and the corpus tests run normally:

```bash
XDG_CACHE_HOME="$SCRATCHPAD/ts-cache" npm --prefix tooling/tree-sitter-satsuma test
```

Do **not** conclude from the lock error that the corpus tests cannot be run
locally — they can, and they must be before any grammar change is pushed. All 318
parses should pass.

## Code Search with ast-grep

`ast-grep` (available as `ast-grep` in the environment) performs structural AST-based search and rewrite, backed by tree-sitter.

### When to use it

Prefer `ast-grep` over `grep` when you care about syntax structure, not text:

- **Searching `grammar.js`**: find rule definitions, specific combinators, or usages of a rule name without false positives from comments or strings.
- **Searching Python scripts** under `scripts/`: structural function-call or import searches.
- **Future Satsuma linting**: once the grammar is registered as a custom language (see below), `ast-grep scan` can enforce structural rules over `.stm` files.

Use plain `Grep` when scanning corpus fixtures or other plain-text files — those aren't parsed as code.

### Quick patterns for grammar.js

```bash
# Find all seq() calls (and see their content)
ast-grep run -l js -p 'seq($$$)' tooling/tree-sitter-satsuma/grammar.js

# Find all choice() calls
ast-grep run -l js -p 'choice($$$)' tooling/tree-sitter-satsuma/grammar.js

# Find a specific property in the rules object
ast-grep run -l js -p 'transform_body: $_' tooling/tree-sitter-satsuma/grammar.js
```

Metavariables: `$NAME` matches a single node; `$$$` matches zero or more.

### Registering Satsuma as a custom language (future)

When the grammar is stable enough for structural search and lint, create `sgconfig.yml` at the repo root:

```yaml
# sgconfig.yml
customLanguages:
  satsuma:
    libraryPath: tooling/tree-sitter-satsuma/build/satsuma.dylib  # or .so on Linux
    extensions: [stm]
    expandoChar: _
```

After building the dylib (`npm run build` in `tooling/tree-sitter-satsuma/`), `ast-grep run -l satsuma -p '...'` enables structural search over `.stm` files. This is also the foundation for a future Satsuma linter implemented as `ast-grep scan` rules.

## Issue Tracking

This project uses a CLI ticket system for task management. Run `tk help` when you need to use it.


Expected workflow:

- Capture dependencies explicitly so ready work can be derived from the graph.
- Include clear acceptance criteria on every implementation task.
- Represent testing work inside the acceptance criteria or as dependent tasks when large enough to stand alone.
- **Before closing a ticket**, add a timestamped `## Notes` entry describing the root cause and the fix applied. Use the format:
  ```
  ## Notes

  **<ISO-8601 timestamp>**

  Cause: <1-2 sentences describing root cause>
  Fix: <1-2 sentences describing what was changed> (commit immediately after <current short-sha>)
  ```
  Reference the current `HEAD` short-sha (`git rev-parse --short HEAD`), not the fix
  commit's own sha — that sha doesn't exist yet while you're authoring the note, and
  waiting for it forces a second commit (and a second full pre-commit test run) just
  to backfill it. "The commit immediately after `<sha>`" is unambiguous and lets the
  ticket update and the fix land in one commit.
- Worktree and server sync is handled manually outside the agent workflow.

## Agent Workflow

- **All code changes must go through a PR.** Direct pushes to `main` are blocked.
  See [AGENT-CONTRIBUTIONS.md](docs/developer/AGENT-CONTRIBUTIONS.md) for the
  full contribution workflow including worktree setup, branch naming, and parallel
  work conventions.
- Use git worktrees in `.worktrees/` for feature isolation. Create one per feature
  branch so multiple agents can work in parallel without conflicts.
- **After creating a new worktree**, run `npm run install:all` from the worktree
  root to install all dependencies, build the WASM parser, and compile the LSP
  server. Without this step, pre-commit hooks will fail on vscode-satsuma and
  tree-sitter tests.
- **Check the pre-commit hook is installed before your first commit** in any clone
  or worktree — see [Installing the pre-commit hook](#installing-the-pre-commit-hook).
  If it isn't installed, install it. Do not just note it in the PR body.
- Read the relevant feature doc in `features/` before implementing planned work.
- Inspect existing examples and docs before making syntax or tooling assumptions.
- Keep changes scoped and directly tied to the current task.
- **Always include `.tickets/` changes in every commit — no exceptions.** The `tk` tool stores task state there and it must stay in sync with the code. Stage `.tickets/` alongside your other changes before committing.
- Do not pick up the next task until the current task's relevant automated tests have been run locally and are passing.
- If a requested change would contradict the spec, stop and raise the conflict clearly.
- For work in `tooling/tree-sitter-satsuma/`, treat corpus tests in `tooling/tree-sitter-satsuma/test/corpus/` and generated parser artifacts as part of the implementation surface.
- When changing the tree-sitter grammar, update the grammar source, regenerate parser outputs as needed, and verify the corpus fixtures.
- **Before opening a PR**, review the commits on the branch and ask: *does this change represent an architectural decision that should be recorded?* Use `/adr-draft` to assess and draft. If an ADR is warranted, check with the user, draft it in `adrs/`, and mark any superseded ADRs (ADR bodies are immutable — the only permitted edits are the Status line and repointing a file path that moved). Include the ADR files in the PR commit. See `skills/adr-draft/SKILL.md` for the full assessment criteria and format.

### Installing the pre-commit hook

The repo's checks live in `.githooks/pre-commit`, which runs
`scripts/run-repo-checks.sh`. Git only fires them if `core.hooksPath` points at
`.githooks`. That setting is **local config, not tracked in the repo**, so it is
missing in every fresh clone and every new worktree until someone sets it — and
when it is missing, commits sail through with no checks at all and nothing warns
you.

Check it before your first commit in a clone or worktree:

```bash
git config core.hooksPath        # must print: .githooks
```

If it prints `.git/hooks`, prints nothing, or the hook is otherwise not firing,
install it yourself — this is a one-line local fix, not something to defer or
merely flag in the PR body:

```bash
git config core.hooksPath .githooks
```

Then confirm your commit actually runs the checks. A commit that completes
instantly with no check output is the signature of an uninstalled hook.

## Adding a New Feature

1. Create `features/<feature-name>/PRD.md` describing the problem, success
   criteria, and acceptance tests before writing any code.
2. Write failing tests first (TDD) where practical.
3. Implement the smallest change that makes the tests pass. Always do the RIGHT thing, not the FAST thing, so never hack tests or add lint ignore rules because that's easier than fixing the underlying issue.
6. Update `docs/product-owner/PROJECT-OVERVIEW.md` if the architecture changes.

## Ralph Loops
When you are implementing a whole feature in a Ralph Loop, and have finished all related tk (ticket) tasks such that there are no remaining ready tasks, emit <PROMISE>DONE</PROMISE> to signal completion of the feature.

* Commit your changes after each tk task completes (AND after you have proven that tests are passing and you have added any new coverage and documentation updates).
