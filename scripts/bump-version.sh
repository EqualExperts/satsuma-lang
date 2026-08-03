#!/usr/bin/env bash
# bump-version.sh — bump the version across the entire repo
#
# Usage:
#   ./scripts/bump-version.sh <new-version>
#
# Example:
#   ./scripts/bump-version.sh 0.4.0
#
# The canonical version lives in the repo-root VERSION file. The tested Node
# helper synchronizes the CLI, standalone LSP, and VS Code extension manifests
# and locks, updates hardcoded site versions, and promotes the accumulated
# Unreleased changelog notes into the dated release section.
#
# After running, review changes with `git diff` and commit.

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <new-version>" >&2
  echo "Example: $0 0.4.0" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node "$REPO_ROOT/scripts/release-metadata.mjs" bump "$1"

echo "Review with: git diff"
echo "Then commit: git add -A && git commit -m 'chore: prepare v$1 release'"
