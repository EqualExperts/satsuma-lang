#!/usr/bin/env python3

from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PACKAGE_ROOT.parents[1]
FIXTURE_ROOT = PACKAGE_ROOT / "test" / "fixtures"
EXAMPLES_ROOT = REPO_ROOT / "examples"

# Prefer the npm-local tree-sitter binary (always has --wasm support) over the
# system one (e.g. Homebrew on macOS may not be compiled with the wasm feature).
_LOCAL_BIN = PACKAGE_ROOT / "node_modules" / ".bin" / "tree-sitter"
TREE_SITTER_BIN = str(_LOCAL_BIN) if _LOCAL_BIN.exists() else "tree-sitter"


@dataclass(frozen=True)
class Fixture:
    name: str
    path: Path
    source: Path
    expect_root: str
    allow_error: bool
    allow_missing: bool
    require_error: bool
    require_missing: bool
    expect_contains: tuple[str, ...]


def load_fixture(path: Path) -> Fixture:
    data = json.loads(path.read_text())
    source = (path.parent / data["source"]).resolve()
    return Fixture(
        name=path.relative_to(FIXTURE_ROOT).as_posix(),
        path=path,
        source=source,
        expect_root=data.get("expect_root", "source_file"),
        allow_error=data.get("allow_error", False),
        allow_missing=data.get("allow_missing", False),
        require_error=data.get("require_error", False),
        require_missing=data.get("require_missing", False),
        expect_contains=tuple(data.get("expect_contains", [])),
    )


def load_fixtures() -> list[Fixture]:
    fixtures = sorted(FIXTURE_ROOT.rglob("*.json"))
    if not fixtures:
        raise SystemExit(f"no fixture files found under {FIXTURE_ROOT}")
    return [load_fixture(path) for path in fixtures]


def validate_example_coverage(fixtures: list[Fixture]) -> None:
    expected = {path.resolve() for path in sorted(EXAMPLES_ROOT.glob("*.stm"))}
    covered = {fixture.source for fixture in fixtures if fixture.source.parent == EXAMPLES_ROOT}

    missing = sorted(path.relative_to(REPO_ROOT).as_posix() for path in expected - covered)
    extra = sorted(path.relative_to(REPO_ROOT).as_posix() for path in covered - expected)

    if missing or extra:
        details: list[str] = []
        if missing:
            details.append(f"missing fixtures for: {', '.join(missing)}")
        if extra:
            details.append(f"unexpected example fixture sources: {', '.join(extra)}")
        raise SystemExit("; ".join(details))


def validate_recovery_coverage(fixtures: list[Fixture]) -> None:
    required = {
        "recovery/missing-closing-brace.json",
        "recovery/unterminated-note.json",
        "recovery/broken-tag-list.json",
        "recovery/partial-transform-line.json",
        "recovery/incomplete-path-after-arrow.json",
    }
    present = {fixture.name for fixture in fixtures}
    missing = sorted(required - present)
    if missing:
        raise SystemExit(f"missing required recovery fixtures: {', '.join(missing)}")


def parse_fixture(fixture: Fixture) -> tuple[bool, str]:
    if not fixture.source.exists():
        return False, f"source file does not exist: {fixture.source}"

    cmd = [
        TREE_SITTER_BIN,
        "parse",
        "--wasm",
        "-p",
        str(PACKAGE_ROOT),
        str(fixture.source),
    ]
    import os
    env = os.environ.copy()
    env["XDG_CACHE_HOME"] = str(REPO_ROOT / ".cache")
    result = subprocess.run(
        cmd,
        cwd=PACKAGE_ROOT,
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )

    # Filter out wrapper script info lines (Using ROOT_DIR, Using XDG_CACHE_HOME)
    tree_lines = [line for line in result.stdout.splitlines() if not line.startswith("Using ")]
    tree = "\n".join(tree_lines).strip()
    diag_lines = [line for line in result.stderr.splitlines() if not line.startswith("Using ")]
    diagnostics = "\n".join(diag_lines).strip()
    combined = "\n".join(part for part in (tree, diagnostics) if part)

    if result.returncode != 0 and not (fixture.allow_error or fixture.allow_missing):
        return False, failure_message("parse command exited non-zero", fixture, combined)

    if fixture.expect_root and not tree.startswith(f"({fixture.expect_root} "):
        return False, failure_message(
            f"expected root node {fixture.expect_root!r}",
            fixture,
            combined,
        )

    if not fixture.allow_error and "(ERROR " in tree:
        return False, failure_message("parse tree contains ERROR nodes", fixture, combined, "(ERROR ")

    if not fixture.allow_missing and "(MISSING " in tree:
        return False, failure_message("parse tree contains MISSING nodes", fixture, combined, "(MISSING ")

    if fixture.require_error and "(ERROR " not in combined:
        return False, failure_message("expected ERROR nodes in recovered parse", fixture, combined)

    if fixture.require_missing and "(MISSING " not in combined:
        return False, failure_message("expected MISSING nodes in recovered parse", fixture, combined)

    for expected in fixture.expect_contains:
        if expected not in combined:
            return False, failure_message(
                f"expected parser output to contain {expected!r}",
                fixture,
                combined,
            )

    return True, combined


def failure_message(reason: str, fixture: Fixture, output: str, needle: str | None = None) -> str:
    excerpt = excerpt_output(output, needle)
    rel_source = fixture.source.relative_to(REPO_ROOT).as_posix()
    return "\n".join(
        [
            f"{fixture.name}: {reason}",
            f"source: {rel_source}",
            "excerpt:",
            excerpt,
        ]
    )


def excerpt_output(output: str, needle: str | None) -> str:
    lines = output.splitlines()
    if not lines:
        return "  <no parser output>"

    if needle is not None:
        for index, line in enumerate(lines):
            if needle in line:
                start = max(0, index - 2)
                end = min(len(lines), index + 3)
                return "\n".join(f"  {snippet}" for snippet in lines[start:end])

    return "\n".join(f"  {line}" for line in lines[:12])


def main() -> int:
    fixtures = load_fixtures()
    validate_example_coverage(fixtures)
    validate_recovery_coverage(fixtures)

    passed = 0
    failures: list[str] = []

    for fixture in fixtures:
        ok, message = parse_fixture(fixture)
        if ok:
            passed += 1
            print(f"PASS  {fixture.name}")
        else:
            failures.append(message)
            print(f"FAIL  {fixture.name}")

    print()
    print(f"Results: {passed} passed, {len(failures)} failed")

    if failures:
        print()
        print("Failures:")
        for failure in failures:
            print(failure)
            print()
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
