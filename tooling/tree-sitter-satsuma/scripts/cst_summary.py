#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import typing as t
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
# Prefer the npm-local tree-sitter binary (always has --wasm support) over the
# system one (e.g. Homebrew on macOS may not be compiled with the wasm feature).
_LOCAL_BIN = Path(__file__).resolve().parents[1] / "node_modules" / ".bin" / "tree-sitter"
TREE_SITTER_BIN = str(_LOCAL_BIN) if _LOCAL_BIN.exists() else "tree-sitter"
DEFAULT_GLOBS = (
    "examples/*.stm",
    "features/02-multi-schema/examples/**/*.stm",
)
OWNER_TYPES = {
    "schema_block",
    "fragment_block",
    "field_decl",
    "mapping_block",
    "map_entry",
    "computed_arrow",
    "nested_arrow",
    "each_block",
    "flatten_block",
    "map_arrow",
}
# In v2, metrics are schema_block nodes with (metric, ...) metadata — not a separate block type.
BLOCK_TYPES = (
    "import_decl",
    "schema_block",
    "fragment_block",
    "mapping_block",
    "transform_block",
)
PATH_TYPES = (
    "namespaced_path",
    "relative_field_path",
    "field_path",
    "backtick_path",
)
NODE_RE = re.compile(
    r"""
    ^
    (?P<indent>\s*)
    (?:(?P<field>[a-z_]+):\s+)?
    \(
    (?P<type>[A-Za-z_][A-Za-z0-9_]*)
    \s+
    \[(?P<start_line>\d+),\s*(?P<start_col>\d+)\]
    \s*-\s*
    \[(?P<end_line>\d+),\s*(?P<end_col>\d+)\]
    """,
    re.VERBOSE,
)


@dataclass(frozen=True)
class Point:
    line: int
    column: int


@dataclass
class Node:
    type: str
    start: Point
    end: Point
    field_name: str | None = None
    children: list[Node] = field(default_factory=list)
    parent: Node | None = None


class SourceText:
    def __init__(self, text: str) -> None:
        self.text = text
        self.lines = text.splitlines(keepends=True)
        self.offsets: list[int] = [0]
        total = 0
        for line in self.lines:
            total += len(line)
            self.offsets.append(total)

    def slice(self, start: Point, end: Point) -> str:
        if start.line >= len(self.lines) and start.line != end.line:
            return ""
        start_offset = self.offsets[start.line] + start.column
        end_offset = self.offsets[end.line] + end.column
        return self.text[start_offset:end_offset]


def parse_tree_dump(tree_text: str) -> Node:
    roots: list[Node] = []
    stack: list[tuple[int, Node]] = []

    for line in tree_text.splitlines():
        match = NODE_RE.match(line)
        if match is None:
            continue

        indent = len(match.group("indent"))
        node = Node(
            type=match.group("type"),
            field_name=match.group("field"),
            start=Point(int(match.group("start_line")), int(match.group("start_col"))),
            end=Point(int(match.group("end_line")), int(match.group("end_col"))),
        )

        while stack and stack[-1][0] >= indent:
            stack.pop()

        if stack:
            parent = stack[-1][1]
            node.parent = parent
            parent.children.append(node)
        else:
            roots.append(node)

        stack.append((indent, node))

    if len(roots) != 1:
        raise ValueError(f"expected exactly one root node, found {len(roots)}")
    return roots[0]


def iter_nodes(node: Node) -> t.Iterator[Node]:
    yield node
    for child in node.children:
        yield from iter_nodes(child)


def field_child(node: Node, name: str) -> Node | None:
    for child in node.children:
        if child.field_name == name:
            return child
    return None


def field_children(node: Node, name: str) -> list[Node]:
    return [child for child in node.children if child.field_name == name]


def node_text(node: Node | None, source: SourceText) -> str | None:
    if node is None:
        return None
    return source.slice(node.start, node.end)


def clean_scalar(text: str | None) -> str | None:
    if text is None:
        return None
    stripped = text.strip()
    if len(stripped) >= 2 and stripped[0] == stripped[-1] == '"':
        return stripped[1:-1]
    if stripped.startswith("'''") and stripped.endswith("'''") and len(stripped) >= 6:
        return stripped[3:-3]
    return stripped


def _find_child_by_type(node: Node, child_type: str) -> Node | None:
    for child in node.children:
        if child.type == child_type:
            return child
    return None


def block_label(node: Node, source: SourceText) -> str:
    if node.type in ("schema_block", "fragment_block", "transform_block"):
        keyword = node.type.replace("_block", "")
        label_node = _find_child_by_type(node, "block_label")
        name = clean_scalar(node_text(label_node, source)) if label_node else "<anonymous>"
        return f"{keyword} {name}"
    if node.type == "mapping_block":
        label_node = _find_child_by_type(node, "block_label")
        if label_node:
            return f"mapping {clean_scalar(node_text(label_node, source))}"
        return "mapping"
    if node.type == "import_decl":
        path_node = _find_child_by_type(node, "import_path")
        path = clean_scalar(node_text(path_node, source)) if path_node else None
        return f'import "{path}"' if path else "import"
    return node.type


def owner_summary(node: Node | None, source: SourceText) -> dict[str, str] | None:
    cursor = node.parent if node is not None else None
    while cursor is not None:
        if cursor.type in OWNER_TYPES:
            return {
                "type": cursor.type,
                "label": block_label(cursor, source),
            }
        cursor = cursor.parent
    return None


def summarize_block(node: Node, source: SourceText) -> dict[str, t.Any]:
    summary: dict[str, t.Any] = {
        "type": node.type,
        "label": block_label(node, source),
    }
    return summary


def summarize_schema_member(node: Node, source: SourceText) -> dict[str, t.Any]:
    item: dict[str, t.Any] = {
        "kind": node.type,
        "owner": owner_summary(node, source),
    }
    if node.type == "field_decl":
        name_node = _find_child_by_type(node, "field_name")
        item["name"] = clean_scalar(node_text(name_node, source)) if name_node else None
        type_node = _find_child_by_type(node, "type_expr")
        item["type"] = clean_scalar(node_text(type_node, source)) if type_node else None
        meta_node = _find_child_by_type(node, "metadata_block")
        item["has_metadata"] = meta_node is not None
    # field_decl with schema_body child = nested record/list_of record
    body_node = _find_child_by_type(node, "schema_body")
    if body_node is not None:
        item["nested"] = True
    return item


def summarize_map_item(node: Node, source: SourceText) -> dict[str, t.Any]:
    item: dict[str, t.Any] = {
        "kind": node.type,
        "owner": owner_summary(node, source),
    }
    src_node = _find_child_by_type(node, "src_path")
    tgt_node = _find_child_by_type(node, "tgt_path")
    item["source"] = clean_scalar(node_text(src_node, source)) if src_node else None
    item["target"] = clean_scalar(node_text(tgt_node, source)) if tgt_node else None
    pipe_node = _find_child_by_type(node, "pipe_chain")
    item["has_transform"] = pipe_node is not None
    return item


def comment_severity(node_type: str) -> str:
    return {
        "warning_comment": "warning",
        "question_comment": "question",
        "comment": "info",
    }.get(node_type, "info")


def summarize_tree(source: SourceText, root: Node) -> dict[str, t.Any]:
    nodes = list(iter_nodes(root))
    counts = Counter(node.type for node in nodes)

    return {
        "parse_ok": counts["ERROR"] == 0 and counts["MISSING"] == 0,
        "counts": dict(sorted(counts.items())),
        "blocks": [summarize_block(node, source) for node in nodes if node.type in BLOCK_TYPES],
        "schema_members": [
            summarize_schema_member(node, source)
            for node in nodes
            if node.type == "field_decl"
        ],
        "map_items": [
            summarize_map_item(node, source)
            for node in nodes
            if node.type in {"map_arrow", "computed_arrow", "nested_arrow", "each_block", "flatten_block"}
        ],
        "paths": [
            {
                "kind": node.type,
                "text": clean_scalar(node_text(node, source)),
            }
            for node in nodes
            if node.type in PATH_TYPES
        ],
        "comments": [
            {
                "severity": comment_severity(node.type),
                "text": clean_scalar(node_text(node, source)),
                "owner": owner_summary(node, source),
            }
            for node in nodes
            if node.type in {"warning_comment", "question_comment", "comment"}
        ],
        "notes": [
            {
                "text": clean_scalar(node_text(node, source)),
                "owner": owner_summary(node, source),
            }
            for node in nodes
            if node.type == "note_block"
        ],
        "annotations": [
            {
                "name": clean_scalar(node_text(node, source)),
                "owner": owner_summary(node, source),
            }
            for node in nodes
            if node.type == "metadata_block"
        ],
    }


def discover_files(globs: tuple[str, ...]) -> list[Path]:
    files: list[Path] = []
    for pattern in globs:
        files.extend(path for path in ROOT.glob(pattern) if path.is_file())
    return sorted({path.resolve() for path in files})


def resolve_input_path(path: Path) -> Path:
    if path.is_absolute():
        return path

    cwd_candidate = (Path.cwd() / path).resolve()
    if cwd_candidate.exists():
        return cwd_candidate

    root_candidate = (ROOT / path).resolve()
    if root_candidate.exists():
        return root_candidate

    return cwd_candidate


def parse_with_cli(path: Path) -> Node:
    cmd = [
        TREE_SITTER_BIN,
        "parse",
        "--wasm",
        "-p",
        str(ROOT / "tooling" / "tree-sitter-satsuma"),
        str(path),
    ]

    import os
    env = os.environ.copy()
    env["XDG_CACHE_HOME"] = str(ROOT / ".cache")
    result = subprocess.run(
        cmd,
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )
    # tree-sitter returns non-zero when ERROR/MISSING nodes are present, but
    # still emits a valid (recovered) tree on stdout.  Only raise when there
    # is no usable tree output at all.
    # Filter out wrapper script info lines
    stdout = "\n".join(
        line for line in result.stdout.splitlines() if not line.startswith("Using ")
    )
    if not stdout.strip():
        raise RuntimeError(
            result.stderr.strip() or "tree-sitter parse produced no output"
        )
    return parse_tree_dump(stdout)


def build_summary(path: Path) -> dict[str, t.Any]:
    source = SourceText(path.read_text())
    root = parse_with_cli(path)
    summary = summarize_tree(source, root)
    summary["file"] = str(path.relative_to(ROOT))
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Emit JSON summaries from Satsuma CSTs using the repo-local tree-sitter wrapper."
    )
    parser.add_argument("files", nargs="*", type=Path, help="Specific Satsuma files to summarize.")
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print JSON output.",
    )
    args = parser.parse_args(argv)

    files = [resolve_input_path(path) for path in args.files] if args.files else discover_files(DEFAULT_GLOBS)
    if not files:
        parser.error("no Satsuma files found")

    summaries: list[dict[str, t.Any]] = []
    failures: list[dict[str, str]] = []

    for path in files:
        try:
            summaries.append(build_summary(path))
        except Exception as exc:  # noqa: BLE001
            failures.append(
                {
                    "file": str(path.relative_to(ROOT)),
                    "error": str(exc),
                }
            )

    payload = {
        "files": summaries,
        "failures": failures,
    }
    json.dump(payload, sys.stdout, indent=2 if args.pretty else None, sort_keys=True)
    sys.stdout.write("\n")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
