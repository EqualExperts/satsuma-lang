# Agent Contribution Workflow

This document describes how AI agents should contribute code to this repository.
Human contributors should also follow the branch protection rules but may skip
the worktree conventions if they prefer their own workflow.

## Branch Protection

Direct pushes to `main` are blocked. All changes must go through a pull request
that passes both CI checks (Tree-sitter parser, VS Code extension) before merge.
PRs are merged via rebase — no merge commits or squash merges.

Repository admins can bypass protection in emergencies but should avoid doing so
routinely.

## Worktree-Based Isolation

Agents must use git worktrees for all feature work. Worktrees live inside the
repository at `.worktrees/` (gitignored) so they stay self-contained and don't
pollute the parent directory.

### Why worktrees

- Multiple agents can work on separate features in parallel without stepping on
  each other's working directory state.
- Each worktree has its own independent checkout — file edits, staged changes,
  and build artifacts are fully isolated.
- The main worktree stays clean and always reflects `main`, making it easy to
  review the overall project state.

### Creating a worktree

```bash
# From the repo root
git worktree add .worktrees/<branch-name> -b <branch-name>
```

Use the ticket ID as the branch name when the work maps to a ticket:

```bash
git worktree add .worktrees/satsuma-14x.8 -b satsuma-14x.8
```

For work spanning multiple tickets under one feature, use a descriptive name:

```bash
git worktree add .worktrees/feat/semantic-tokens -b feat/semantic-tokens
```

### Working inside a worktree

Once created, `cd` into the worktree and work normally. The worktree is a full
checkout — you can run tests, install dependencies, and commit just like the
main working directory.

```bash
cd .worktrees/satsuma-14x.8
npm run install:all                         # install all deps + build WASM + LSP server
# ... do work, run tests, commit ...
git push -u origin satsuma-14x.8
gh pr create --title "..." --body "..."
```

**Important:** after creating a worktree, run `npm run install:all` from the
worktree root **before doing any work**. This installs all `node_modules`
across every package, builds the tree-sitter WASM parser, and compiles the
VS Code LSP server. Without this step, pre-commit hooks (`scripts/run-repo-checks.sh`)
will fail on vscode-satsuma and tree-sitter tests.

### Cleaning up worktrees

After a PR is merged:

```bash
# From the repo root (main worktree)
git worktree remove .worktrees/satsuma-14x.8
git branch -d satsuma-14x.8
```

List active worktrees:

```bash
git worktree list
```

## Branch Naming

| Scope | Pattern | Example |
|-------|---------|---------|
| Single ticket | `satsuma-<id>` | `satsuma-14x.8` |
| Feature (multi-ticket) | `feat/<name>` | `feat/semantic-tokens` |
| Bug fix | `fix/<name>` | `fix/conflict-count` |
| Chore / CI / docs | `chore/<name>` | `chore/ci-caching` |

## Commit and PR Conventions

- Keep commits focused — one logical change per commit.
- Write commit messages that explain *why*, not just *what*.
- PR titles should be under 70 characters. Use the body for details.
- Reference ticket IDs in PR descriptions (e.g. "Closes satsuma-14x.8").
- PRs must pass CI before merge. Do not ask reviewers to merge failing PRs.

## Parallel Agent Work

The worktree model is designed for multiple agents to work simultaneously.
Follow these rules to avoid conflicts:

### 1. One branch per feature scope

Each agent claims a feature or ticket by creating its worktree and branch. Two
agents must not work on the same branch. If two tickets touch the same files,
they should be sequenced (via ticket dependencies) rather than parallelized.

### 2. Rebase before PR

Before opening a PR, rebase onto the latest `main`:

```bash
git fetch origin
git rebase origin/main
```

This keeps the commit history linear and surfaces conflicts early. If rebase
conflicts arise, resolve them in the worktree — don't force-push over someone
else's work.

### 3. Minimize cross-cutting changes

Prefer narrowly-scoped changes that touch only the files relevant to the
feature. Avoid reformatting, renaming, or refactoring files outside the ticket
scope — these create unnecessary merge conflicts for parallel work.

### 4. Coordinate through tickets

Check ticket dependencies before starting work. If your ticket depends on
another that is in progress, wait for it to merge to `main` first. The ticket
graph (`tk deps <id>`) is the coordination mechanism.

## Agent Checklist

Before starting work:

- [ ] Identify the ticket(s) to implement
- [ ] Verify dependencies are closed or merged
- [ ] Create a worktree: `git worktree add .worktrees/<branch> -b <branch>`
- [ ] `cd` into the worktree
- [ ] Run `npm run install:all` to install deps, build WASM, and compile LSP server

Before opening a PR:

- [ ] All tests pass (`npm test` in relevant packages)
- [ ] Rebase onto latest `main`
- [ ] Commits are focused and well-described
- [ ] Push and create PR via `gh pr create`

After PR is merged:

- [ ] Remove the worktree: `git worktree remove .worktrees/<branch>`
- [ ] Delete the local branch: `git branch -d <branch>`

## Running tree-sitter CLI

Always pass `--wasm` — there is no native build in this repository, and the native
path needs a C toolchain the WASM migration removed (ADR-002). The npm scripts
already do this, so `npm --prefix tooling/tree-sitter-satsuma test` is correct as-is.

In the agent sandbox you must also redirect the tree-sitter cache, because both
the native and WASM paths compile into `~/.cache/tree-sitter/` and fail there with
an opaque `Operation not permitted` lock-file error:

```bash
XDG_CACHE_HOME="$SCRATCHPAD/ts-cache" npm --prefix tooling/tree-sitter-satsuma test
```

See the "Running tree-sitter CLI" section of [AGENTS.md](../../AGENTS.md) for the
full explanation.
