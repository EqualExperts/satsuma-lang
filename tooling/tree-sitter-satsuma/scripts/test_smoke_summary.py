#!/usr/bin/env python3

"""Smoke tests for the CST summary consumer.

Runs ``cst_summary.build_summary`` against every canonical Satsuma example file,
then asserts key structural counts and shapes so downstream consumers can trust
the extraction pipeline.

These tests prove:
- The consumer can successfully invoke the parser and traverse every example.
- Each file's summary contains the expected category counts (blocks, schema
  members, map items, paths, comments, notes, annotations).
- The ``parse_ok`` flag correctly reflects clean vs. error-recovery parses.
- Block labels, schema member names, and comment severities are plausible.
"""

from __future__ import annotations

import unittest
from pathlib import Path
from typing import ClassVar

from cst_summary import build_summary

ROOT = Path(__file__).resolve().parents[3]


# ---------------------------------------------------------------------------
# Expected structural shapes per file.
#
# Each entry maps a repo-relative path to a dict of minimum counts
# (``>=`` assertions) and exact flags.  Counts use ``min_*`` keys so that
# adding content to example files does not immediately break the smoke test;
# the test still catches regressions where whole categories vanish.
# ---------------------------------------------------------------------------

EXPECTATIONS: dict[str, dict] = {
    "examples/lib/common.stm": {
        "parse_ok": True,
        "min_blocks": 5,
        "min_schema_members": 21,
        "min_map_items": 0,
        "min_paths": 0,
        "min_comments": 2,
        "min_notes": 0,
        "min_annotations": 13,
        "block_types": {"fragment_block", "schema_block"},
    },
    "examples/db-to-db/pipeline.stm": {
        "parse_ok": True,
        "min_blocks": 4,
        "min_schema_members": 40,
        "min_map_items": 19,
        "min_paths": 35,
        "min_comments": 28,
        "min_notes": 1,
        "min_annotations": 24,
        "block_types": {"import_decl", "mapping_block", "schema_block"},
    },
    "examples/edi-to-json/pipeline.stm": {
        "parse_ok": True,
        "min_blocks": 3,
        "min_schema_members": 47,
        "min_map_items": 2,
        "min_paths": 5,
        "min_comments": 25,
        "min_notes": 1,
        "min_annotations": 14,
        "block_types": {"mapping_block", "schema_block"},
    },
    "examples/multi-source/multi-source-hub.stm": {
        "parse_ok": True,
        "min_blocks": 11,
        "min_schema_members": 26,
        "min_map_items": 15,
        "min_paths": 25,
        "min_comments": 4,
        "min_notes": 1,
        "min_annotations": 8,
        "block_types": {"mapping_block", "schema_block"},
    },
    "examples/multi-source/multi-source-join.stm": {
        "parse_ok": True,
        "min_blocks": 5,
        "min_schema_members": 55,
        "min_map_items": 0,
        "min_paths": 0,
        "min_comments": 18,
        "min_notes": 1,
        "min_annotations": 38,
        "block_types": {"import_decl", "schema_block"},
    },
    "examples/protobuf-to-parquet/pipeline.stm": {
        "parse_ok": True,
        "min_blocks": 3,
        "min_schema_members": 41,
        "min_map_items": 20,
        "min_paths": 33,
        "min_comments": 4,
        "min_notes": 1,
        "min_annotations": 32,
        "block_types": {"mapping_block", "schema_block"},
    },
    "examples/xml-to-parquet/pipeline.stm": {
        "parse_ok": True,
        "min_blocks": 5,
        "min_schema_members": 61,
        "min_map_items": 31,
        "min_paths": 57,
        "min_comments": 5,
        "min_notes": 1,
        "min_annotations": 48,
        "block_types": {"mapping_block", "schema_block"},
    },
    "examples/sfdc-to-snowflake/pipeline.stm": {
        "parse_ok": True,
        "min_blocks": 6,
        "min_schema_members": 26,
        "min_map_items": 10,
        "min_paths": 19,
        "min_comments": 9,
        "min_notes": 1,
        "min_annotations": 19,
        "block_types": {"import_decl", "mapping_block", "schema_block"},
    },
    "examples/metrics-platform/metrics.stm": {
        "parse_ok": True,
        "min_blocks": 7,
        "min_schema_members": 14,
        "min_map_items": 0,
        "min_paths": 0,
        "min_comments": 5,
        # metric_name tags are metadata (annotations), not note_block nodes.
        # Two metric notes moved to schema metadata (note tag); 1 top-level note{} remains.
        "min_notes": 1,
        "min_annotations": 21,
        "block_types": {"schema_block", "mapping_block"},
    },
    "examples/lib/sfdc_fragments.stm": {
        "parse_ok": True,
        "min_blocks": 4,
        "min_schema_members": 32,
        "min_map_items": 0,
        "min_paths": 0,
        "min_comments": 2,
        "min_notes": 0,
        "min_annotations": 12,
        "block_types": {"fragment_block"},
    },
    "examples/lookups/finance.stm": {
        "parse_ok": True,
        "min_blocks": 1,
        "min_schema_members": 3,
        "min_map_items": 0,
        "min_paths": 0,
        "min_comments": 1,
        "min_notes": 0,
        "min_annotations": 2,
        "block_types": {"schema_block"},
    },
    "examples/cobol-to-avro/pipeline.stm": {
        "parse_ok": True,
        "min_blocks": 3,
        "min_schema_members": 39,
        "min_map_items": 17,
        "min_paths": 29,
        "min_comments": 4,
        "min_notes": 1,
        "min_annotations": 30,
        "block_types": {"mapping_block", "schema_block"},
    },
}


# Sections whose length is tested against min_* expectations.
COUNTED_SECTIONS = (
    "blocks",
    "schema_members",
    "map_items",
    "paths",
    "comments",
    "notes",
    "annotations",
)


class SmokeSummaryTests(unittest.TestCase):
    """Run cst_summary.build_summary against every expected file."""

    # Populated once in setUpClass so the parser is only invoked once per file.
    # ClassVar: these are shared class-level caches, not per-instance state.
    _summaries: ClassVar[dict[str, dict]] = {}
    _errors: ClassVar[dict[str, str]] = {}

    @classmethod
    def setUpClass(cls) -> None:
        for relpath in EXPECTATIONS:
            abspath = ROOT / relpath
            try:
                cls._summaries[relpath] = build_summary(abspath)
            except Exception as exc:  # noqa: BLE001
                cls._errors[relpath] = str(exc)

    # ------------------------------------------------------------------
    # Structural tests generated per file
    # ------------------------------------------------------------------

    def test_all_expected_files_parsed(self) -> None:
        """Every file in EXPECTATIONS must produce a summary (no exceptions)."""
        for relpath in EXPECTATIONS:
            with self.subTest(file=relpath):
                self.assertNotIn(
                    relpath,
                    self._errors,
                    f"build_summary raised for {relpath}: {self._errors.get(relpath)}",
                )

    def test_parse_ok_flag(self) -> None:
        """parse_ok must match the expected flag for each file."""
        for relpath, expect in EXPECTATIONS.items():
            if relpath in self._errors:
                continue
            with self.subTest(file=relpath):
                summary = self._summaries[relpath]
                self.assertEqual(
                    summary["parse_ok"],
                    expect["parse_ok"],
                    f"{relpath}: expected parse_ok={expect['parse_ok']}",
                )

    def test_section_minimum_counts(self) -> None:
        """Each counted section must meet or exceed its minimum."""
        for relpath, expect in EXPECTATIONS.items():
            if relpath in self._errors:
                continue
            summary = self._summaries[relpath]
            for section in COUNTED_SECTIONS:
                min_key = f"min_{section}"
                if min_key not in expect:
                    continue
                with self.subTest(file=relpath, section=section):
                    actual = len(summary[section])
                    self.assertGreaterEqual(
                        actual,
                        expect[min_key],
                        f"{relpath}: {section} has {actual}, expected >= {expect[min_key]}",
                    )

    def test_block_types_present(self) -> None:
        """Expected block types must appear in the summary."""
        for relpath, expect in EXPECTATIONS.items():
            if relpath in self._errors:
                continue
            if "block_types" not in expect:
                continue
            summary = self._summaries[relpath]
            actual_types = {block["type"] for block in summary["blocks"]}
            for expected_type in expect["block_types"]:
                with self.subTest(file=relpath, block_type=expected_type):
                    self.assertIn(
                        expected_type,
                        actual_types,
                        f"{relpath}: missing block type {expected_type!r}; "
                        f"found {sorted(actual_types)}",
                    )

    def test_schema_members_have_names(self) -> None:
        """Every schema member must have a non-empty name."""
        for relpath in EXPECTATIONS:
            if relpath in self._errors:
                continue
            summary = self._summaries[relpath]
            for i, member in enumerate(summary["schema_members"]):
                with self.subTest(file=relpath, index=i):
                    self.assertTrue(
                        member.get("name"),
                        f"{relpath}: schema_member[{i}] has no name",
                    )

    def test_map_items_have_kind(self) -> None:
        """Every map item must have a recognised kind."""
        valid_kinds = {
            "map_arrow",
            "computed_arrow",
            "nested_arrow",
            "each_block",
            "flatten_block",
        }
        for relpath in EXPECTATIONS:
            if relpath in self._errors:
                continue
            summary = self._summaries[relpath]
            for i, item in enumerate(summary["map_items"]):
                with self.subTest(file=relpath, index=i):
                    self.assertIn(
                        item.get("kind"),
                        valid_kinds,
                        f"{relpath}: map_items[{i}] kind={item.get('kind')!r}",
                    )

    def test_comments_have_severity(self) -> None:
        """Every comment must have a valid severity."""
        valid_severities = {"warning", "question", "info"}
        for relpath in EXPECTATIONS:
            if relpath in self._errors:
                continue
            summary = self._summaries[relpath]
            for i, comment in enumerate(summary["comments"]):
                with self.subTest(file=relpath, index=i):
                    self.assertIn(
                        comment.get("severity"),
                        valid_severities,
                        f"{relpath}: comments[{i}] severity={comment.get('severity')!r}",
                    )

    def test_annotations_have_name(self) -> None:
        """Every annotation must have a non-empty name."""
        for relpath in EXPECTATIONS:
            if relpath in self._errors:
                continue
            summary = self._summaries[relpath]
            for i, ann in enumerate(summary["annotations"]):
                with self.subTest(file=relpath, index=i):
                    self.assertTrue(
                        ann.get("name"),
                        f"{relpath}: annotations[{i}] has no name",
                    )

    def test_notes_have_text(self) -> None:
        """Every note must have non-empty text."""
        for relpath in EXPECTATIONS:
            if relpath in self._errors:
                continue
            summary = self._summaries[relpath]
            for i, note in enumerate(summary["notes"]):
                with self.subTest(file=relpath, index=i):
                    self.assertTrue(
                        note.get("text"),
                        f"{relpath}: notes[{i}] has no text",
                    )

    def test_file_field_is_repo_relative(self) -> None:
        """The file field must be a repo-relative path."""
        for relpath in EXPECTATIONS:
            if relpath in self._errors:
                continue
            summary = self._summaries[relpath]
            with self.subTest(file=relpath):
                self.assertEqual(
                    summary["file"],
                    relpath,
                    f"{relpath}: file field mismatch",
                )

    def test_no_unexpected_failures(self) -> None:
        """No file should fail to produce a summary at all."""
        self.assertEqual(
            self._errors,
            {},
            f"Unexpected failures: {self._errors}",
        )


if __name__ == "__main__":
    unittest.main()
