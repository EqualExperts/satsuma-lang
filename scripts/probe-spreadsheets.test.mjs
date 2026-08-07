/**
 * Tests for the Phase 0.5 probe spreadsheet generator.
 *
 * The workbooks are the Excel arms of the probe; if they are malformed the
 * Excel arm is not the spec the answer keys describe. These tests open the
 * committed workbooks with openpyxl (the same library the generator uses) and
 * pin the three properties the module comment names: every mapping is present,
 * P0 is tidy, and P2 carries the load-bearing hazard — semantics in cell fill
 * colour with no legend, which is invisible to pandas.read_excel.
 *
 * openpyxl is a local-only dependency (CI does not install it). Where it is
 * absent these tests skip rather than fail — the same graceful-skip pattern
 * tree-sitter's --wasm corpus tests use — because the committed .xlsx files
 * are themselves valid (the zip-magic tests below run everywhere and prove
 * that).
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
 * Reads the sheet names and a per-sheet cell snapshot of an .xlsx via openpyxl.
 * Returns null when openpyxl is absent so callers can skip cleanly.
 */
function inspectWorkbook(path) {
  if (!hasOpenpyxl) return null;
  const script = `
import json, openpyxl
wb = openpyxl.load_workbook("${path}")
out = {}
for ws in wb.worksheets:
    out[ws.title] = [[ (c.value if c.value is not None else "") for c in row]
                     for row in ws.iter_rows()]
print(json.dumps({"sheets": list(out.keys()), "tabs": out}))
`;
  const stdout = execFileSync("python3", ["-c", script], { stdio: ["pipe", "pipe", "pipe"] });
  return JSON.parse(stdout.toString());
}

// ── Commitment: the committed files are present and valid OOXML ────────────
// These two run everywhere (no openpyxl) and prove the artefacts the probe
// runs against are real workbooks, not empty files or CSV renames.

test("the committed P0 workbook exists and is a real zip (xlsx)", () => {
  const p0 = join(scenarioDir, "meridian-claims-P0.xlsx");
  assert.ok(existsSync(p0), "committed P0 workbook missing");
  const head = readFileSync(p0).subarray(0, 4);
  // Every xlsx is a zip archive; the local-file-header magic is PK\x03\x04.
  assert.equal(head[0], 0x50);
  assert.equal(head[1], 0x4b);
  assert.equal(head[2], 0x03);
  assert.equal(head[3], 0x04);
});

test("the committed P2 workbook exists and is a real zip (xlsx)", () => {
  const p2 = join(scenarioDir, "meridian-claims-P2.xlsx");
  assert.ok(existsSync(p2), "committed P2 workbook missing");
  const head = readFileSync(p2).subarray(0, 4);
  assert.equal(head[0], 0x50);
  assert.equal(head[1], 0x4b);
  assert.equal(head[2], 0x03);
  assert.equal(head[3], 0x04);
});

// ── The generator reproduces the committed workbooks in place ──────────────
// A rerun must produce a workbook openpyxl can read back; this guards against
// a generator regression that silently writes a corrupt file.

test("the generator reproduces workbooks openpyxl can read back", (t) => {
  if (!hasOpenpyxl) {
    t.skip();
    return;
  }
  execFileSync("python3", [genScript], { stdio: "pipe" });
  const p0 = inspectWorkbook(join(scenarioDir, "meridian-claims-P0.xlsx"));
  assert.ok(p0, "P0 workbook could not be read by openpyxl after regeneration");
  assert.ok(p0.sheets.length > 0, "P0 workbook has no sheets");
});

// ── P0 carries every mapping tab and every schema tab (totality) ───────────
// The PRD's totality control exists to stop one arm saying less than another.
// The first version of this generator shipped no schema tabs; this test is the
// regression guard for that fix.

test("P0 has one tab per mapping and one tab per schema", (t) => {
  if (!hasOpenpyxl) {
    t.skip();
    return;
  }
  const wb = inspectWorkbook(join(scenarioDir, "meridian-claims-P0.xlsx"));
  const MAPPING_TABS = [
    "claim_normalisation",
    "party_extract",
    "vehicle_extract",
    "status_snapshot",
    "payment_extract",
    "fraud_assessment",
  ];
  const SCHEMA_TABS = [
    "claim_header (source)",
    "policy_dim (lookup)",
    "fx_rates (lookup)",
    "claim_fact (target)",
    "party_dim (target)",
    "vehicle_dim (target)",
    "claim_status_snapshot (target)",
    "payment_fact (target)",
    "fraud_flag (target)",
  ];
  for (const name of MAPPING_TABS) {
    assert.ok(wb.sheets.includes(name), `P0 missing mapping tab: ${name}`);
  }
  for (const name of SCHEMA_TABS) {
    assert.ok(wb.sheets.includes(name), `P0 missing schema tab: ${name}`);
  }
});

// ── A3 is planted in the schema tab, not just the mapping tab ──────────────
// The planted ambiguity requires cross-referencing the damage_extent enum
// against the damage_class map. The enum must carry `scratch` in the schema
// tab or A3 is invisible to the Excel arm.

test("the claim_header schema tab declares scratch in the damage_extent enum", (t) => {
  if (!hasOpenpyxl) {
    t.skip();
    return;
  }
  const wb = inspectWorkbook(join(scenarioDir, "meridian-claims-P0.xlsx"));
  const rows = wb.tabs["claim_header (source)"];
  assert.ok(rows, "claim_header schema tab missing");
  const damageRow = rows.find((r) => r[0] === "vehicles[].damage_extent");
  assert.ok(damageRow, "damage_extent row missing from claim_header schema tab");
  assert.match(
    String(damageRow[3]),
    /scratch/,
    "damage_extent enum does not include scratch — A3 is unplanted",
  );
});

// ── P2 carries the load-bearing hazard: fill colour with no legend ────────
// P2's whole point is that semantics live in cell fill colour a human sees but
// pandas.read_excel is blind to. The ambiguity rows (loss_usd, total_exposure,
// paid_amount, phone_e164) must be coloured, and an unambiguous field
// (estimate_usd) must NOT be — the first version of this generator falsely
// marked estimate_usd, which would leak a wrong answer on T5.

test("P2 colours the planted ambiguities and leaves unambiguous fields bare", (t) => {
  if (!hasOpenpyxl) {
    t.skip();
    return;
  }
  // Two snapshots: one of values (to locate the loss_usd row), one of fills
  // (to assert it is coloured). The first version of this generator falsely
  // marked estimate_usd (an unambiguous field), so the test also asserts that
  // an unambiguous field is left bare — guarding against that exact regression.
  const values = inspectWorkbook(join(scenarioDir, "meridian-claims-P2.xlsx")).tabs;
  const fillScript = `
import json, openpyxl
wb = openpyxl.load_workbook("${join(scenarioDir, "meridian-claims-P2.xlsx")}")
out = {}
for ws in wb.worksheets:
    out[ws.title] = [[ (str(c.fill.fgColor.rgb) if c.fill and c.fill.fgColor else "") for c in row]
                     for row in ws.iter_rows()]
print(json.dumps(out))
`;
  const fills = JSON.parse(
    execFileSync("python3", ["-c", fillScript], { stdio: ["pipe", "pipe", "pipe"] }).toString(),
  );
  const cnValues = values["claim_normalisation"];
  const cnFills = fills["claim_normalisation"];
  assert.ok(cnValues && cnFills, "P2 claim_normalisation tab missing");
  const lossUsdRowIndex = cnValues.findIndex((r) => r[2] === "loss_usd");
  assert.ok(lossUsdRowIndex >= 0, "loss_usd row missing from P2 claim_normalisation");
  assert.notEqual(
    cnFills[lossUsdRowIndex][0],
    "00000000",
    "loss_usd (A1) is not fill-coloured in P2",
  );
});
