#!/usr/bin/env bash
# build-artifacts.sh — build distributable artifacts for all Satsuma tooling
#
# Produces three artifacts:
#   1. VS Code extension    → tooling/vscode-satsuma/vscode-satsuma.vsix
#   2. LSP standalone pack  → tooling/satsuma-lsp/satsuma-lsp.tgz
#   3. CLI standalone pack  → tooling/satsuma-cli/satsuma-cli.tgz
#
# Prerequisites: run `npm run install:all` from the repo root first.
#
# Usage:
#   ./scripts/build-artifacts.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

VSIX_DIR="$REPO_ROOT/tooling/vscode-satsuma"
LSP_DIR="$REPO_ROOT/tooling/satsuma-lsp"
CLI_DIR="$REPO_ROOT/tooling/satsuma-cli"

# --------------------------------------------------------------------------- #
# Shared dependencies: build packages consumed by CLI, LSP, and extension
# --------------------------------------------------------------------------- #

echo "==> Building satsuma-core..."
npm --prefix "$REPO_ROOT/tooling/satsuma-core" run build

echo "==> Building satsuma-viz-backend..."
npm --prefix "$REPO_ROOT/tooling/satsuma-viz-backend" run build

echo "==> Building satsuma-viz..."
npm --prefix "$REPO_ROOT/tooling/satsuma-viz" run build

# --------------------------------------------------------------------------- #
# 1. VS Code extension (.vsix)
# --------------------------------------------------------------------------- #

echo "==> Packaging VS Code extension..."
(cd "$VSIX_DIR" && npm run package)

VSIX_PATH="$VSIX_DIR/vscode-satsuma.vsix"
if [ ! -f "$VSIX_PATH" ]; then
  echo "ERROR: vsix not found at $VSIX_PATH" >&2
  exit 1
fi

# --------------------------------------------------------------------------- #
# 2. LSP standalone npm tarball
# --------------------------------------------------------------------------- #

# The build copies the WASM and highlights.scm assets into dist/ (see
# tooling/satsuma-lsp/scripts/copy-assets.js); `npm run pack` then packs,
# renames to a stable filename, and verifies the tarball contents (sl-vwpr).
# dist/server.js is a self-contained esbuild bundle, so no node_modules are
# packed and no file:-symlink replacement is needed.
echo "==> Building and packing LSP server..."
npm --prefix "$LSP_DIR" run build
npm --prefix "$LSP_DIR" run pack

LSP_STABLE="$LSP_DIR/satsuma-lsp.tgz"
if [ ! -f "$LSP_STABLE" ]; then
  echo "ERROR: LSP tarball not found at $LSP_STABLE" >&2
  exit 1
fi

# --------------------------------------------------------------------------- #
# 3. CLI standalone npm tarball
# --------------------------------------------------------------------------- #

echo "==> Building and packing CLI..."
npm --prefix "$CLI_DIR" run build
npm --prefix "$CLI_DIR" run pack

CLI_PATH="$CLI_DIR/satsuma-cli.tgz"
if [ ! -f "$CLI_PATH" ]; then
  echo "ERROR: CLI tarball not found at $CLI_PATH" >&2
  exit 1
fi

# --------------------------------------------------------------------------- #
# Summary
# --------------------------------------------------------------------------- #

echo ""
echo "Build complete. Artifacts:"
echo "  VSIX : $VSIX_PATH"
echo "  LSP  : $LSP_STABLE"
echo "  CLI  : $CLI_PATH"
