"""Runs ``print-tree.mjs`` to get a Satsuma file's parse tree as CLI-format text.

Owned here because two helpers need the same tree (``test_fixtures.py`` and
``cst_summary.py``). Both used to call ``tree-sitter parse --wasm -p``, which
recompiles the grammar with clang on every call; ``print-tree.mjs`` parses with
the already-built ``tree-sitter-satsuma.wasm`` through web-tree-sitter instead,
so these tests need neither a C toolchain nor a compile step.

This does not interpret the tree, only fetches it. The grammar must already be
built (``npm run build`` in this package, or the workspace build).
"""

from __future__ import annotations

import subprocess
from pathlib import Path

PRINT_TREE_SCRIPT = Path(__file__).resolve().parent / "print-tree.mjs"


def print_tree(source: Path) -> subprocess.CompletedProcess[str]:
    """Parses ``source`` and returns the finished ``print-tree.mjs`` process.

    ``stdout`` holds the tree in ``tree-sitter parse`` format. The return code
    follows the CLI: 0 for a clean tree, 1 when it has ERROR or MISSING nodes
    (the tree is still printed), 2 when nothing could be parsed, with the
    reason on ``stderr``.
    """
    return subprocess.run(
        ["node", str(PRINT_TREE_SCRIPT), str(source)],
        capture_output=True,
        text=True,
        check=False,
    )
