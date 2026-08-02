#!/usr/bin/env python3
"""Tests for excel_tool.py — run with: python3 -m pytest test_excel_tool.py -v"""

import subprocess
import sys
from pathlib import Path

import pytest

TOOL = Path(__file__).parent / "excel_tool.py"
DATA = Path(__file__).parent.parent / "assets" / "test-data"
SIMPLE = DATA / "test-01-simple-customer-sync.xlsx"
MULTI = DATA / "test-02-multi-tab-order-pipeline.xlsx"
HEALTH = DATA / "test-03-healthcare-hl7-to-fhir.xlsx"


def run(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(TOOL), *args],
        capture_output=True,
        text=True,
        check=False,
    )


# ── survey ────────────────────────────────────────────────────────


class TestSurvey:
    def test_single_tab(self):
        r = run(["survey", str(SIMPLE)])
        assert r.returncode == 0
        assert "**Tabs**: 1" in r.stdout
        assert "Field Mapping" in r.stdout

    def test_multi_tab(self):
        r = run(["survey", str(MULTI)])
        assert r.returncode == 0
        assert "**Tabs**: 6" in r.stdout
        for tab in [
            "Instructions",
            "Order Header Mapping",
            "Order Line Mapping",
            "Status Codes",
            "Priority Codes",
            "Changelog",
        ]:
            assert tab in r.stdout

    def test_preview_rows(self):
        r = run(["survey", str(SIMPLE)])
        assert "Preview (first 3 rows)" in r.stdout
        assert "Source System" in r.stdout
        assert "SAP CRM" in r.stdout

    def test_cell_count(self):
        r = run(["survey", str(SIMPLE)])
        assert "Total estimated cells" in r.stdout

    def test_file_not_found(self):
        r = run(["survey", "/nonexistent/file.xlsx"])
        assert r.returncode != 0
        assert "not found" in r.stderr

    def test_wrong_extension(self):
        r = run(["survey", str(TOOL)])  # .py file
        assert r.returncode != 0
        assert ".xlsx" in r.stderr


# ── headers ───────────────────────────────────────────────────────


class TestHeaders:
    def test_simple(self):
        r = run(["headers", str(SIMPLE), "Field Mapping"])
        assert r.returncode == 0
        assert "Source System" in r.stdout
        assert "Target Field" in r.stdout

    def test_offset_header_detection(self):
        r = run(["headers", str(HEALTH), "Patient Demographics"])
        assert r.returncode == 0
        assert "Header row detected at row 2" in r.stdout
        assert "HL7 Segment.Field" in r.stdout

    def test_inferred_types(self):
        r = run(["headers", str(SIMPLE), "Field Mapping"])
        assert "Inferred column types" in r.stdout
        assert "text" in r.stdout

    def test_sample_rows(self):
        r = run(["headers", str(MULTI), "Order Header Mapping"])
        assert r.returncode == 0
        assert "Sample rows" in r.stdout
        assert "ORDER_ID" in r.stdout

    def test_tab_not_found(self):
        r = run(["headers", str(SIMPLE), "Nonexistent Tab"])
        assert r.returncode != 0
        assert "not found" in r.stderr


# ── formatting ────────────────────────────────────────────────────


class TestFormatting:
    def test_detects_fill_colours(self):
        r = run(["formatting", str(MULTI), "Order Header Mapping"])
        assert r.returncode == 0
        assert "Distinct fill colours" in r.stdout

    def test_detects_font_styles(self):
        r = run(["formatting", str(MULTI), "Order Header Mapping"])
        assert "strikethrough" in r.stdout
        assert "bold" in r.stdout

    def test_no_formatting(self):
        r = run(["formatting", str(MULTI), "Changelog"])
        assert r.returncode == 0
        # Changelog has header styling but not much else


# ── range ─────────────────────────────────────────────────────────


class TestRange:
    def test_full_range(self):
        r = run(["range", str(SIMPLE), "Field Mapping"])
        assert r.returncode == 0
        assert "Rows returned" in r.stdout

    def test_row_range(self):
        r = run(["range", str(MULTI), "Order Header Mapping", "--rows", "2:4"])
        assert r.returncode == 0
        assert "Rows returned" in r.stdout
        assert r.stdout.count("ORDER_ID") >= 1

    def test_col_range(self):
        r = run(
            [
                "range",
                str(MULTI),
                "Order Header Mapping",
                "--rows",
                "2:4",
                "--cols",
                "A:C",
            ]
        )
        assert r.returncode == 0
        # Should only have 3 columns of data
        assert "ORDER_ID" in r.stdout

    def test_row_and_col_range(self):
        r = run(
            [
                "range",
                str(MULTI),
                "Order Header Mapping",
                "--rows",
                "2:3",
                "--cols",
                "A:E",
            ]
        )
        assert r.returncode == 0
        assert "ORDER_ID" in r.stdout
        assert "CUST_ID" in r.stdout


# ── lookup ────────────────────────────────────────────────────────


class TestLookup:
    def test_status_codes(self):
        r = run(["lookup", str(MULTI), "Status Codes"])
        assert r.returncode == 0
        assert "Code" in r.stdout
        assert "Cancelled" in r.stdout
        assert "Rows" in r.stdout
        assert "10 (of 10 total)" in r.stdout

    def test_priority_codes(self):
        r = run(["lookup", str(MULTI), "Priority Codes"])
        assert r.returncode == 0
        assert "rush" in r.stdout
        assert "3 (of 3 total)" in r.stdout

    def test_max_rows_cap(self):
        r = run(["lookup", str(MULTI), "Status Codes", "--max-rows", "3"])
        assert r.returncode == 0
        assert "WARNING" in r.stdout
        assert "capped by --max-rows" in r.stdout


# ── integration: all 3 test spreadsheets ──────────────────────────


class TestAllSpreadsheets:
    @pytest.mark.parametrize("xlsx", [SIMPLE, MULTI, HEALTH])
    def test_survey_succeeds(self, xlsx):
        r = run(["survey", str(xlsx)])
        assert r.returncode == 0
        assert "# Survey:" in r.stdout
