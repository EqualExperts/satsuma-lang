/**
 * adr-numbers.test.mjs — every ADR in adrs/ has a number no other ADR uses.
 *
 * ADRs are cited by number ("ADR-049"), so two records sharing one make every
 * citation ambiguous. It happened once: two branches in flight on the same
 * day each took "the next free number", and both merged as ADR-052 (renumbered
 * to ADR-052 and ADR-054 on 2026-10-06). Neither branch could see the other's
 * file, so only a check on the merged tree catches it.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const adrDir = path.join(repoRoot, "adrs");

/** ADR file names: `adr-<number>-<slug>.md`. */
const ADR_FILE = /^adr-(\d+)-.+\.md$/;
/** An ADR's first line: `# ADR-<number> — <title>`. */
const ADR_HEADING = /^# ADR-(\d+)\b/;

/** Each ADR file with the number in its name and the number in its heading. */
function readAdrs() {
  return fs
    .readdirSync(adrDir)
    .filter((name) => ADR_FILE.test(name))
    .map((name) => {
      const firstLine = fs.readFileSync(path.join(adrDir, name), "utf8").split("\n", 1)[0];
      return {
        name,
        fileNumber: Number(ADR_FILE.exec(name)[1]),
        headingNumber: Number(ADR_HEADING.exec(firstLine)?.[1]),
      };
    });
}

test("no two ADR files share a number", () => {
  const byNumber = new Map();
  for (const adr of readAdrs()) {
    byNumber.set(adr.fileNumber, [...(byNumber.get(adr.fileNumber) ?? []), adr.name]);
  }
  const duplicates = [...byNumber.values()].filter((names) => names.length > 1);
  assert.deepEqual(
    duplicates,
    [],
    "renumber the later ADR to the next free number and update its heading",
  );
});

test("each ADR's heading carries the same number as its file name", () => {
  // A renumbered file whose heading still says the old number is a duplicate
  // in every place that quotes the heading.
  const mismatched = readAdrs()
    .filter((adr) => adr.headingNumber !== adr.fileNumber)
    .map((adr) => adr.name);
  assert.deepEqual(mismatched, []);
});
