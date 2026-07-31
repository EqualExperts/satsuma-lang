"""
Shared step definitions for all smoke-test BDD scenarios.

These steps cover the three lineage-related CLI commands:
  - satsuma arrows   — field-level arrow queries
  - satsuma lineage  — schema-level graph traversal
  - satsuma field-lineage — per-field upstream/downstream traversal

Fixture paths in .feature files are resolved relative to the smoke-tests/
root directory (i.e. the directory containing this file).

The satsuma binary is resolved from the SATSUMA_CMD environment variable,
falling back to the bare `satsuma` command.  Set SATSUMA_CMD when the
global `satsuma` is not installed:
  export SATSUMA_CMD="node /path/to/tooling/satsuma-cli/dist/index.js"
"""

import json
import os
import subprocess
from typing import Any

import pytest
from pytest_bdd import given, parsers, then, when

# Root directory that fixture paths in .feature files are resolved against.
_FIXTURE_ROOT = os.path.dirname(__file__)

# Command used to invoke satsuma.  Split to support multi-word overrides
# like "node /abs/path/to/dist/index.js".
_SATSUMA = os.environ.get("SATSUMA_CMD", "satsuma").split()


# ---------------------------------------------------------------------------
# Context fixture — accumulates command results within one scenario.
# ---------------------------------------------------------------------------


@pytest.fixture
def ctx() -> dict:
    """Per-scenario state bag shared by all Given/When/Then steps."""
    return {}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _run(
    args: list[str],
    fixture: str,
    *,
    extra_flags: list[str] | None = None,
    expect_exit: int = 0,
) -> Any:
    """
    Invoke a satsuma sub-command against a fixture file, assert the exit code,
    and return the parsed JSON output.

    Returns None when the command produces no stdout (e.g. on error).
    The extra_flags list is inserted before the trailing --json and fixture path.
    """
    cmd = _SATSUMA + args + (extra_flags or []) + ["--json", fixture]
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    assert result.returncode == expect_exit, (
        f"Expected exit {expect_exit}, got {result.returncode}.\n"
        f"cmd:    {' '.join(cmd)}\n"
        f"stdout: {result.stdout}\n"
        f"stderr: {result.stderr}"
    )
    return json.loads(result.stdout) if result.stdout.strip() else None


def _run_exit_only(args: list[str], fixture: str) -> int:
    """
    Run a satsuma sub-command and return only the exit code.
    Used by steps that test error conditions without asserting on output.
    """
    cmd = _SATSUMA + args + ["--json", fixture]
    return subprocess.run(cmd, capture_output=True, text=True, check=False).returncode


# ---------------------------------------------------------------------------
# Helpers used by Then steps
# ---------------------------------------------------------------------------


def _schema_names(lineage: dict) -> set[str]:
    """Extract schema node names from a lineage JSON result."""
    return {n["name"] for n in lineage["nodes"] if n["type"] == "schema"}


def _edges(lineage: dict) -> set[tuple[str, str]]:
    """Extract (from, to) edge pairs from a lineage JSON result."""
    return {(e["from"], e["to"]) for e in lineage["edges"]}


# ---------------------------------------------------------------------------
# Given
# ---------------------------------------------------------------------------


@given(parsers.parse('the Satsuma fixture "{fixture}"'))
def given_fixture(fixture: str, ctx: dict) -> None:
    """Resolve the fixture path relative to the smoke-tests/ root."""
    ctx["fixture"] = os.path.join(_FIXTURE_ROOT, fixture)


# ---------------------------------------------------------------------------
# When — arrows command
# ---------------------------------------------------------------------------


@when(parsers.parse('I query arrows for "{field}"'))
def query_arrows(field: str, ctx: dict) -> None:
    ctx["arrows"] = _run(["arrows", field], ctx["fixture"]) or []


@when(parsers.parse('I query arrows for "{field}" as source'))
def query_arrows_as_source(field: str, ctx: dict) -> None:
    ctx["arrows"] = _run(["arrows", field, "--as-source"], ctx["fixture"]) or []


@when(parsers.parse('I query arrows for "{field}" expecting exit code {code:d}'))
def query_arrows_expect_exit(field: str, code: int, ctx: dict) -> None:
    ctx["exit_code"] = _run_exit_only(["arrows", field], ctx["fixture"])


@when(parsers.parse('I query arrows for "{field}" as source expecting exit code {code:d}'))
def query_arrows_as_source_expect_exit(field: str, code: int, ctx: dict) -> None:
    ctx["exit_code"] = _run_exit_only(["arrows", field, "--as-source"], ctx["fixture"])


# ---------------------------------------------------------------------------
# When — lineage command
# ---------------------------------------------------------------------------


@when(parsers.parse('I query lineage from "{schema}"'))
def query_lineage_from(schema: str, ctx: dict) -> None:
    ctx["lineage"] = _run(["lineage", "--from", schema], ctx["fixture"]) or {
        "nodes": [],
        "edges": [],
    }


@when(parsers.parse('I query lineage to "{schema}"'))
def query_lineage_to(schema: str, ctx: dict) -> None:
    ctx["lineage"] = _run(["lineage", "--to", schema], ctx["fixture"]) or {
        "nodes": [],
        "edges": [],
    }


@when(parsers.parse('I query lineage from "{schema}" with depth {depth:d}'))
def query_lineage_from_depth(schema: str, depth: int, ctx: dict) -> None:
    ctx["lineage"] = _run(
        ["lineage", "--from", schema, "--depth", str(depth)], ctx["fixture"]
    ) or {"nodes": [], "edges": []}


# ---------------------------------------------------------------------------
# When — field-lineage command
# ---------------------------------------------------------------------------


@when(parsers.parse('I query field-lineage for "{field}"'))
def query_field_lineage(field: str, ctx: dict) -> None:
    ctx["field_lineage"] = _run(["field-lineage", field], ctx["fixture"]) or {
        "field": field,
        "upstream": [],
        "downstream": [],
    }


@when(parsers.parse('I query field-lineage for "{field}" upstream only'))
def query_field_lineage_upstream(field: str, ctx: dict) -> None:
    ctx["field_lineage"] = _run(
        ["field-lineage", field, "--upstream"], ctx["fixture"]
    ) or {"field": field, "upstream": [], "downstream": []}


@when(parsers.parse('I query field-lineage for "{field}" downstream only'))
def query_field_lineage_downstream(field: str, ctx: dict) -> None:
    ctx["field_lineage"] = _run(
        ["field-lineage", field, "--downstream"], ctx["fixture"]
    ) or {"field": field, "upstream": [], "downstream": []}


# ---------------------------------------------------------------------------
# Then — exit code
# ---------------------------------------------------------------------------


@then(parsers.re(r"the command exits with code (?P<code>\d+)"))
def check_exit_code(code: str, ctx: dict) -> None:
    assert ctx["exit_code"] == int(code)


# ---------------------------------------------------------------------------
# Then — arrows
# ---------------------------------------------------------------------------


@then(parsers.re(r"I get (?P<count>\d+) arrows?"))
def check_arrow_count(count: str, ctx: dict) -> None:
    assert len(ctx["arrows"]) == int(count), (
        f"Expected {count} arrows, got {len(ctx['arrows'])}: {ctx['arrows']}"
    )


@then(parsers.re(r"I get at least (?P<count>\d+) arrows?"))
def check_arrow_count_min(count: str, ctx: dict) -> None:
    assert len(ctx["arrows"]) >= int(count), (
        f"Expected >= {count} arrows, got {len(ctx['arrows'])}"
    )


@then(parsers.parse('the arrow source is "{value}"'))
def check_arrow_source(value: str, ctx: dict) -> None:
    assert ctx["arrows"][0]["source"] == value


@then("the arrow source is null")
def check_arrow_source_null(ctx: dict) -> None:
    assert ctx["arrows"][0]["source"] is None


@then(parsers.parse('the arrow target is "{value}"'))
def check_arrow_target(value: str, ctx: dict) -> None:
    assert ctx["arrows"][0]["target"] == value


@then(parsers.parse('the classification is "{value}"'))
def check_classification(value: str, ctx: dict) -> None:
    assert ctx["arrows"][0]["classification"] == value


@then(parsers.re(r"derived is (?P<value>true|false)"))
def check_derived(value: str, ctx: dict) -> None:
    assert ctx["arrows"][0]["derived"] is (value == "true")


@then(parsers.parse('the arrow mapping is "{value}"'))
def check_arrow_mapping(value: str, ctx: dict) -> None:
    assert ctx["arrows"][0]["mapping"] == value


@then(parsers.parse('the source list is "{value}"'))
def check_source_list(value: str, ctx: dict) -> None:
    # For multi-source arrows the source field contains a comma-separated list.
    assert ctx["arrows"][0]["source"] == value


@then(parsers.parse('the arrows include a target "{value}"'))
def check_arrows_include_target(value: str, ctx: dict) -> None:
    targets = {a["target"] for a in ctx["arrows"]}
    assert value in targets, f"'{value}' not in targets: {targets}"


@then(parsers.parse('the arrows include a source "{value}"'))
def check_arrows_include_source(value: str, ctx: dict) -> None:
    sources = {a["source"] for a in ctx["arrows"]}
    assert value in sources, f"'{value}' not in sources: {sources}"


@then(parsers.parse('at least one arrow source contains "{value}"'))
def check_source_contains(value: str, ctx: dict) -> None:
    assert any(
        a["source"] is not None and value in a["source"] for a in ctx["arrows"]
    ), f"No arrow source contained '{value}'"


@then("all arrows share the same mapping")
def check_same_mapping(ctx: dict) -> None:
    mappings = {a["mapping"] for a in ctx["arrows"]}
    assert len(mappings) == 1, f"Expected one shared mapping, got: {mappings}"


# ---------------------------------------------------------------------------
# Then — lineage
# ---------------------------------------------------------------------------


@then(parsers.parse('the lineage includes schema "{name}"'))
def check_lineage_includes_schema(name: str, ctx: dict) -> None:
    names = _schema_names(ctx["lineage"])
    assert name in names, f"Schema '{name}' not in {names}"


@then(parsers.parse('the lineage does not include schema "{name}"'))
def check_lineage_excludes_schema(name: str, ctx: dict) -> None:
    names = _schema_names(ctx["lineage"])
    assert name not in names, f"Schema '{name}' unexpectedly in {names}"


@then(parsers.parse('the lineage schemas are exactly "{csv}"'))
def check_lineage_schemas_exact(csv: str, ctx: dict) -> None:
    expected = {s.strip() for s in csv.split(",")}
    actual = _schema_names(ctx["lineage"])
    assert actual == expected, f"Expected schemas {expected}, got {actual}"


@then(parsers.parse('the lineage has edge "{src}" to "{tgt}"'))
def check_lineage_edge(src: str, tgt: str, ctx: dict) -> None:
    edges = _edges(ctx["lineage"])
    assert (src, tgt) in edges, f"Edge ({src} → {tgt}) not in {edges}"


# ---------------------------------------------------------------------------
# Then — field-lineage
# ---------------------------------------------------------------------------


@then(parsers.parse('the field identifier is "{value}"'))
def check_field_id(value: str, ctx: dict) -> None:
    assert ctx["field_lineage"]["field"] == value


@then("upstream is empty")
def check_upstream_empty(ctx: dict) -> None:
    assert ctx["field_lineage"]["upstream"] == []


@then("downstream is empty")
def check_downstream_empty(ctx: dict) -> None:
    assert ctx["field_lineage"]["downstream"] == []


@then(parsers.re(r"there (?:is|are) (?P<count>\d+) upstream fields?"))
def check_upstream_count(count: str, ctx: dict) -> None:
    assert len(ctx["field_lineage"]["upstream"]) == int(count)


@then(parsers.re(r"there (?:is|are) (?P<count>\d+) downstream fields?"))
def check_downstream_count(count: str, ctx: dict) -> None:
    assert len(ctx["field_lineage"]["downstream"]) == int(count)


@then(parsers.parse('the upstream field is "{value}"'))
def check_upstream_field(value: str, ctx: dict) -> None:
    assert ctx["field_lineage"]["upstream"][0]["field"] == value


@then(parsers.parse('the upstream via-mapping is "{value}"'))
def check_upstream_mapping(value: str, ctx: dict) -> None:
    assert ctx["field_lineage"]["upstream"][0]["via_mapping"] == value


@then(parsers.parse('the upstream classification is "{value}"'))
def check_upstream_classification(value: str, ctx: dict) -> None:
    assert ctx["field_lineage"]["upstream"][0]["classification"] == value


@then(parsers.parse('the downstream field is "{value}"'))
def check_downstream_field(value: str, ctx: dict) -> None:
    assert ctx["field_lineage"]["downstream"][0]["field"] == value


@then(parsers.parse('the downstream via-mapping is "{value}"'))
def check_downstream_mapping(value: str, ctx: dict) -> None:
    assert ctx["field_lineage"]["downstream"][0]["via_mapping"] == value


@then(parsers.parse('the downstream classification is "{value}"'))
def check_downstream_classification(value: str, ctx: dict) -> None:
    assert ctx["field_lineage"]["downstream"][0]["classification"] == value


@then(parsers.parse('the upstream fields include "{value}"'))
def check_upstream_includes(value: str, ctx: dict) -> None:
    fields = {u["field"] for u in ctx["field_lineage"]["upstream"]}
    assert value in fields, f"'{value}' not in upstream fields: {fields}"


@then(parsers.parse('the downstream fields include "{value}"'))
def check_downstream_includes(value: str, ctx: dict) -> None:
    fields = {d["field"] for d in ctx["field_lineage"]["downstream"]}
    assert value in fields, f"'{value}' not in downstream fields: {fields}"


@then(parsers.parse('all upstream classifications are "{value}"'))
def check_all_upstream_classifications(value: str, ctx: dict) -> None:
    for u in ctx["field_lineage"]["upstream"]:
        assert u["classification"] == value, (
            f"Expected classification '{value}', got '{u['classification']}' for field '{u['field']}'"
        )
