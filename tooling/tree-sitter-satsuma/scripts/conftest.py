"""Pytest configuration for tree-sitter-satsuma Python tests.

Validates fixture coverage at session start and parametrizes fixture
tests so each fixture JSON becomes its own test case.
"""

from __future__ import annotations

import pytest
from test_fixtures import (
    load_fixtures,
    validate_example_coverage,
    validate_recovery_coverage,
)


def pytest_configure(config: pytest.Config) -> None:
    """Validate fixture coverage before any tests run."""
    fixtures = load_fixtures()
    validate_example_coverage(fixtures)
    validate_recovery_coverage(fixtures)


def pytest_generate_tests(metafunc: pytest.Metafunc) -> None:
    """Parametrize the fixture test over all loaded fixtures."""
    if "fixture" in metafunc.fixturenames:
        fixtures = load_fixtures()
        metafunc.parametrize(
            "fixture",
            fixtures,
            ids=[f.name for f in fixtures],
        )
