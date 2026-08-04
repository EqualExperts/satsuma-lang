"""Locates a wasm-capable tree-sitter CLI for the Python helpers in this package.

Owned here because two helpers need the same answer (``test_fixtures.py`` and
``cst_summary.py``) and getting it wrong is silent: a tree-sitter built without
the wasm feature fails only once a ``--wasm`` parse is attempted.

This does not decide *how* the parser is invoked, only which executable to use.
"""

from __future__ import annotations

from pathlib import Path

# Where npm may have installed tree-sitter-cli's shim, in preference order.
# The workspace root comes first: the tooling packages are npm workspaces
# (ADR-049), so shared dependencies hoist there and the package-local path only
# exists in a pre-workspaces checkout or when a version conflict forced npm to
# nest a private copy.
_NPM_BIN_SUBPATH = Path("node_modules") / ".bin" / "tree-sitter"

# Last resort. A system tree-sitter (e.g. Homebrew on macOS) may not be compiled
# with the wasm feature, which is why it is never preferred over an npm-installed
# one — see the "Running tree-sitter CLI" section of AGENTS.md.
_SYSTEM_BIN = "tree-sitter"


def resolve_tree_sitter_bin(repo_root: Path, package_root: Path) -> str:
    """Returns the tree-sitter executable to invoke, as a command or a path.

    Prefers an npm-installed binary (guaranteed to carry the wasm feature) over
    whatever ``tree-sitter`` on PATH happens to be.
    """
    for candidate in (repo_root / _NPM_BIN_SUBPATH, package_root / _NPM_BIN_SUBPATH):
        if candidate.exists():
            return str(candidate)
    return _SYSTEM_BIN
