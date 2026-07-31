#!/usr/bin/env python3

from __future__ import annotations

import unittest

from cst_summary import SourceText, parse_tree_dump, summarize_tree

SOURCE = """schema customer {
  id STRING (pk)
  note { "Customer record" }
}
mapping {
  source { src }
  target { tgt }
  id -> out_id
}
"""


TREE = """(source_file [0, 0] - [9, 1]
  (schema_block [0, 0] - [3, 1]
    (block_label [0, 7] - [0, 15]
      (identifier [0, 7] - [0, 15]))
    (schema_body [1, 2] - [2, 28]
      (field_decl [1, 2] - [1, 16]
        (field_name [1, 2] - [1, 4]
          (identifier [1, 2] - [1, 4]))
        (type_expr [1, 5] - [1, 11])
        (metadata_block [1, 12] - [1, 16]
          (tag_token [1, 13] - [1, 15]
            (identifier [1, 13] - [1, 15]))))
      (note_block [2, 2] - [2, 28]
        (nl_string [2, 9] - [2, 26]))))
  (mapping_block [4, 0] - [8, 1]
    (mapping_body [5, 2] - [7, 14]
      (source_block [5, 2] - [5, 16]
        (identifier [5, 12] - [5, 15]))
      (target_block [6, 2] - [6, 16]
        (identifier [6, 12] - [6, 15]))
      (map_arrow [7, 2] - [7, 14]
        (src_path [7, 2] - [7, 4]
          (field_path [7, 2] - [7, 4]
            (identifier [7, 2] - [7, 4])))
        (tgt_path [7, 8] - [7, 14]
          (field_path [7, 8] - [7, 14]
            (identifier [7, 8] - [7, 14]))))))
  (comment [7, 15] - [7, 20]))
"""


class CSTSummaryTests(unittest.TestCase):
    def test_summary_extracts_blocks_and_members(self) -> None:
        root = parse_tree_dump(TREE)
        summary = summarize_tree(SourceText(SOURCE), root)

        self.assertTrue(summary["parse_ok"])
        self.assertEqual(summary["blocks"][0]["label"], "schema customer")
        self.assertEqual(summary["schema_members"][0]["name"], "id")
        self.assertEqual(summary["schema_members"][0]["type"], "STRING")
        self.assertTrue(summary["schema_members"][0]["has_metadata"])

    def test_summary_extracts_map_paths_and_comments(self) -> None:
        root = parse_tree_dump(TREE)
        summary = summarize_tree(SourceText(SOURCE), root)

        self.assertEqual(len(summary["map_items"]), 1)
        self.assertEqual(summary["map_items"][0]["kind"], "map_arrow")
        self.assertEqual(len(summary["paths"]), 2)
        self.assertEqual(summary["notes"][0]["text"], 'note { "Customer record" }')


if __name__ == "__main__":
    unittest.main()
