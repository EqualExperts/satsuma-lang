#!/usr/bin/env bash
# build-workspace.sh — build every tooling package in cross-package dependency order.
#
# This is the *single* home for that order. Before feature 42 the same sequence
# was written out by hand twice — once in the root package.json's
# `install:all`/`ci:all` chains and again in the `install` job of
# .github/workflows/ci.yml — with nothing enforcing that the two copies matched.
# Both now call this script instead (via `npm run build:all`).
#
# Transitional by design: feature 42's R4 replaces this file with turbo.json's
# `dependsOn` graph, at which point the order stops being a sequence of commands
# and becomes data Turborepo derives from the dependency graph itself. Until
# then, edit the order here and nowhere else.
#
# Prerequisite: `npm install` (or `npm ci`) has already run at the repo root, so
# every workspace package is linked and its dependencies are present.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

build() {
  local label="$1"
  shift
  printf '\n==> %s\n' "$label"
  "$@"
}

# ── Tier 1: the shared library everything else compiles against ──────────────

build "satsuma-core" npm run build --workspace @satsuma/core

# ── Tier 2: the VizModel contract, then the backend that produces it ─────────
# viz-model's types are compiled against core; viz-backend against both.

build "satsuma-viz-model" npm run build --workspace @satsuma/viz-model
build "satsuma-viz-backend" npm run build --workspace @satsuma/viz-backend

# ── Tier 3: the WASM grammar ─────────────────────────────────────────────────
# Only tree-sitter-cli is needed to produce it, but every parser-backed consumer
# below copies the built .wasm into its own dist/, so it must exist first. This
# is precisely the ordering the "prebuild ran before WASM existed" workaround in
# ci.yml used to paper over.
#
# `build:wasm`, not `build`: the generated parser sources under src/ are
# committed, and regenerating them here would make an unrelated build step the
# thing that decides whether CI's "generated sources are up to date" check
# passes.

build "tree-sitter-satsuma (WASM grammar)" npm run build:wasm --workspace tree-sitter-satsuma

# ── Tier 4: the consumers ────────────────────────────────────────────────────
# Each of these copies the grammar WASM produced above. @satsuma/viz is built
# here because the VS Code webview and the viz harness both consume its bundle
# as a prebuilt artifact rather than compiling it themselves.

build "satsuma-cli" npm run build --workspace satsuma-cli
build "satsuma-viz" npm run build --workspace @satsuma/viz
build "satsuma-lsp" npm run build --workspace @satsuma/lsp

printf '\nWorkspace build complete.\n'
