#!/usr/bin/env python3
# generate-diary-manifest.py — build per-entry JSON files and the Eleventy sidebar manifest.
#
# For each diary .md file under site/satsuma-diaries/:
#   1. Writes site/satsuma-diaries/content/{date}.json  — fetched on demand by the JS reader
#   2. Collects metadata for site/_data/diaries.json    — used by Eleventy to render the sidebar
#
# Run from the repo root after the diary files have been copied into site/.

import json
import os

content_dir = "site/satsuma-diaries/content"
os.makedirs(content_dir, exist_ok=True)

entries = []

for root, dirs, files in os.walk("site/satsuma-diaries"):
    if "content" in root:
        continue
    dirs.sort()
    for f in sorted(files):
        if not f.endswith(".md"):
            continue
        date = f[:-3]
        md_path = os.path.join(root, f)
        with open(md_path, encoding="utf-8") as fp:
            markdown = fp.read()

        # Use the first ## heading as the entry title, falling back to the date.
        title = date
        for line in markdown.splitlines():
            if line.startswith("## "):
                title = line[3:].strip()
                break

        # Individual entry JSON — fetched lazily when the reader selects an entry.
        entry_json_path = os.path.join(content_dir, f"{date}.json")
        with open(entry_json_path, "w", encoding="utf-8") as fp:
            json.dump({"date": date, "title": title, "markdown": markdown}, fp)

        entries.append(
            {
                "date": date,
                "title": title,
                "contentPath": f"satsuma-diaries/content/{date}.json",
            }
        )

entries.sort(key=lambda x: x["date"], reverse=True)

with open("site/_data/diaries.json", "w", encoding="utf-8") as f:
    json.dump(entries, f, indent=2)

print(
    f"Diary manifest: {len(entries)} entries written; content JSON files in {content_dir}/"
)
