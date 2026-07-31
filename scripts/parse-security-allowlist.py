#!/usr/bin/env python3
"""Parse .security-allowlist.yml and print comma-separated IDs for a given section.

Usage: python3 scripts/parse-security-allowlist.py <section>
  section: 'npm-audit' or 'semgrep'

Prints a comma-separated list of allowlisted IDs to stdout (empty string if none).
"""

import re
import sys


def main():
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <npm-audit|semgrep>", file=sys.stderr)
        sys.exit(1)

    section = sys.argv[1]
    with open(".security-allowlist.yml") as f:
        text = f.read()

    in_section = False
    ids = []
    for line in text.split("\n"):
        if re.match(rf"^{re.escape(section)}:", line):
            in_section = True
            continue
        if re.match(r"^[a-z]", line) and in_section:
            break
        if in_section:
            m = re.search(r'id:\s*["\']?(.*?)["\']?\s*$', line)
            if m:
                ids.append(m.group(1).strip())

    print(",".join(ids))

if __name__ == "__main__":
    main()
