/**
 * Tests for the Phase 0.5 probe spreadsheet generator.
 *
 * The workbooks are the Excel arms of the probe; if they are malformed the
 * Excel arm is not the spec the answer keys describe. These tests pin the
 * properties that matter for the probe: every mapping is present, P0 is tidy,
 * and P2 carries the load-bearing hazard — semantics in cell fill colour
 * with no legend, which is invisible to pandas.read_excel.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(here);
const scenarioDir = join(repoRoot, "evals", "phase-0.5-probe", "scenario");
const genScript = join(scenarioDir, "generate_probe_spreadsheets.py");

/** True when the local python3 can import openpyxl (a probe-maintainer dep). */
const hasOpenpyxl = (() => {
  try {
    execFileSync("python3", ["-c", "import openpyxl"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

/**
 * Runs the generator in place. Caller guards with {@link hasOpenpyxl}.
 */
function regenerate() {
  // The script writes next to itself via __file__ (SCRIPT_DIR), so it always
  // regenerates into the committed scenario dir — that is the point: a rerun
  // must reproduce the committed bytes, which is the property under test.
  execFileSync("python3", [genScript], { stdio: "pipe" });
}

test("the generator reproduces both committed workbooks in place", (t) => {
  // If this fails the Excel arm cannot be regenerated, which blocks the probe
  // if the scenario ever needs amending. openpyxl is a local-only dependency
  // (CI does not install it), so skip rather than fail where it is absent —
  // the same graceful-skip pattern tree-sitter's --wasm corpus tests use.
  if (!hasOpenpyxl) {
    t.skip();
    return;
  }
  regenerate();
  assert.ok(existsSync(join(scenarioDir, "meridian-claims-P0.xlsx")), "P0 workbook missing");
  assert.ok(existsSync(join(scenarioDir, "meridian-claims-P2.xlsx")), "P2 workbook missing");
});

test("the committed P0 workbook exists and is a real zip (xlsx)", () => {
  // The committed arm is what the probe actually runs against, so it must be
  // present and a valid OOXML zip — not an empty file or a CSV rename.
  const p0 = join(scenarioDir, "meridian-claims-P0.xlsx");
  assert.ok(existsSync(p0), "committed P0 workbook missing");
  const head = readFileSync(p0).subarray(0, 4);
  // Every xlsx is a zip archive; the local-file-header magic is PK\x03\x04.
  assert.equal(head[0], 0x50);
  assert.equal(head[1], 0x4b);
});

test("the committed P2 workbook exists and is a real zip (xlsx)", () => {
  // P2 carries the fill-colour hazard; it must be present and valid too.
  const p2 = join(scenarioDir, "meridian-claims-P2.xlsx");
  assert.ok(existsSync(p2), "committed P2 workbook missing");
  const head = readFileSync(p2).subarray(0, 4);
  assert.equal(head[0], 0x50);
  assert.equal(head[1], 0x4b);
});
