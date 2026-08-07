/**
 * Tests for the Phase 0.5 probe spreadsheet generator.
 *
 * These tests regenerate the workbooks into a throwaway temp directory and
 * compare structurally against the committed files — they never mutate the
 * tracked binaries. This is the fix for the cycle-2 B3 defect: the previous
 * suite regenerated into the committed dir before asserting, so it read its
 * own output and a PR whose Excel fix never landed showed green.
 *
 * The tests pin: the committed files are valid OOXML; regeneration reproduces
 * the committed structure (same sheets, same schema tabs, scratch in the
 * enum, PII fill present, ambiguity fill absent). openpyxl is a local-only
 * dependency (CI does not install it); where it is absent the workbook tests
 * skip rather than fail — the same pattern tree-sitter's --wasm corpus tests
 * use.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, rmSync, cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

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
 * Runs the generator in a temp directory (copying the script there so its
 * `SCRIPT_DIR = dirname(__file__)` writes next to itself) and returns the
 * dir path. The committed files are never touched.
 */
function regenerateIntoTmp() {
  const out = mkdtempSync(join(tmpdir(), "probe-gen-"));
  cpSync(genScript, join(out, "generate_probe_spreadsheets.py"));
  execFileSync("python3", [join(out, "generate_probe_spreadsheets.py")], {
    stdio: "pipe",
    cwd: out,
  });
  return out;
}

/** Reads the sheet names of an .xlsx via openpyxl, or null if openpyxl absent. */
function sheetNames(path) {
  const script = `import json, openpyxl; print(json.dumps(openpyxl.load_workbook("${path}").sheetnames))`;
  return JSON.parse(
    execFileSync("python3", ["-c", script], { stdio: ["pipe", "pipe", "pipe"] }).toString(),
  );
}

// ── The committed files are present and valid OOXML (runs everywhere) ──────

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

// ── The committed workbooks carry the schema tabs (B1 regression guard) ────
// These run against the COMMITTED files — if they fail, the committed
// artifacts are stale and the generator was edited without regenerating.

test("the committed P0 has one tab per schema and one per mapping", (t) => {
  if (!hasOpenpyxl) {
    t.skip();
    return;
  }
  const sheets = sheetNames(join(scenarioDir, "meridian-claims-P0.xlsx"));
  for (const name of [
    "claim_header (source)",
    "policy_dim (lookup)",
    "fx_rates (lookup)",
    "claim_fact (target)",
    "party_dim (target)",
    "vehicle_dim (target)",
    "claim_status_snapshot (target)",
    "payment_fact (target)",
    "fraud_flag (target)",
    "claim_normalisation",
    "party_extract",
    "vehicle_extract",
    "status_snapshot",
    "payment_extract",
    "fraud_assessment",
  ]) {
    assert.ok(sheets.includes(name), `committed P0 missing tab: ${name}`);
  }
});

test("the committed P2 has no stray empty Sheet tab and has a README cover", (t) => {
  if (!hasOpenpyxl) {
    t.skip();
    return;
  }
  const sheets = sheetNames(join(scenarioDir, "meridian-claims-P2.xlsx"));
  assert.ok(!sheets.includes("Sheet"), "P2 still ships the stray empty Sheet tab");
  assert.ok(sheets.includes("README"), "P2 has no README cover tab");
});

test("the committed P0 schema tab declares scratch in the damage_extent enum", (t) => {
  if (!hasOpenpyxl) {
    t.skip();
    return;
  }
  const script = `
import json, openpyxl
wb = openpyxl.load_workbook("${join(scenarioDir, "meridian-claims-P0.xlsx")}")
ws = wb["claim_header (source)"]
for row in ws.iter_rows(values_only=True):
    if row and row[0] == "vehicles[].damage_extent":
        print(json.dumps(row[3])); break
`;
  const notes = execFileSync("python3", ["-c", script], { stdio: ["pipe", "pipe", "pipe"] })
    .toString()
    .trim();
  assert.match(
    notes,
    /scratch/,
    "damage_extent enum does not include scratch — A3 is unplanted in the committed workbook",
  );
});

test("the committed P0 carries the corrected risk_score transform, not the stale one", (t) => {
  if (!hasOpenpyxl) {
    t.skip();
    return;
  }
  const script = `
import json, openpyxl
wb = openpyxl.load_workbook("${join(scenarioDir, "meridian-claims-P0.xlsx")}")
ws = wb["fraud_assessment"]
for row in ws.iter_rows(values_only=True):
    if row and "risk_score" in str(row[2] or ""):
        print(json.dumps(row[4])); break
`;
  const transform = execFileSync("python3", ["-c", script], { stdio: ["pipe", "pipe", "pipe"] })
    .toString()
    .trim();
  assert.equal(
    JSON.parse(transform),
    "multiply 10",
    "committed P0 still has the stale underspecified risk_score",
  );
});

// ── Regeneration reproduces the committed structure (in a temp dir) ────────
// This catches a generator regression without mutating tracked files. It
// compares sheet names, not bytes — openpyxl is not byte-stable across versions.

test("regeneration into a temp dir reproduces the committed P0 sheet set", (t) => {
  if (!hasOpenpyxl) {
    t.skip();
    return;
  }
  const out = regenerateIntoTmp();
  try {
    const regen = sheetNames(join(out, "meridian-claims-P0.xlsx"));
    const committed = sheetNames(join(scenarioDir, "meridian-claims-P0.xlsx"));
    assert.deepEqual(regen, committed, "regenerated P0 sheet set diverges from committed");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

// ── The P2 fill hazard: PII present, ambiguity fills absent ────────────────
// The reviewer recommended dropping the ambiguity fills (partial T5 answer-key
// leak). This test asserts both: PII rows are coloured, and no row carries the
// old ambiguity blue (D9E1F2). It runs against the committed file.

test("committed P2 colours PII and carries no ambiguity fills", (t) => {
  if (!hasOpenpyxl) {
    t.skip();
    return;
  }
  const script = `
import json, openpyxl
wb = openpyxl.load_workbook("${join(scenarioDir, "meridian-claims-P2.xlsx")}")
AMBIGUITY = "00D9E1F2"
PII = "00FCE4D6"
has_ambiguity = False
has_pii = False
for ws in wb.worksheets:
    for row in ws.iter_rows():
        for cell in row:
            rgb = str(cell.fill.fgColor.rgb) if cell.fill and cell.fill.fgColor else ""
            if rgb == AMBIGUITY: has_ambiguity = True
            if rgb == PII: has_pii = True
print(json.dumps({"has_ambiguity": has_ambiguity, "has_pii": has_pii}))
`;
  const result = JSON.parse(
    execFileSync("python3", ["-c", script], { stdio: ["pipe", "pipe", "pipe"] }).toString(),
  );
  assert.equal(
    result.has_ambiguity,
    false,
    "P2 still carries the ambiguity fill — should be dropped per the reviewer's recommendation",
  );
  assert.equal(
    result.has_pii,
    true,
    "P2 no longer carries the PII fill — the load-bearing hazard must survive",
  );
});
