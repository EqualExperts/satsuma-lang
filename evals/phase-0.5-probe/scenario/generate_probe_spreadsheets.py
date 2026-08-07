#!/usr/bin/env python3
"""Generate the Phase 0.5 probe spreadsheet arms.

Two workbooks are produced from the same hand-authored intent, so the arms
are paired to each other (the best control available for ~$8, per the PRD):

  - X-P0: tidy. One tab per mapping, fixed columns, plain header row, one row
    per field-level arrow. Adversarially favourable to Excel — this is the
    headline pair with S+.
  - X-P2: realistic-messy. P0 plus the messiness primitives already proven in
    archive/features/04-excel-to-stm-skill/test-data/generate_test_spreadsheets.py
    — a free-text Notes column, merged header cells, semantics in cell fill
    colour with NO legend, a stale "Archived" tab, and a multi-row title block
    that pushes the headers off row 1. P2 is where fill colour (invisible to
    pandas.read_excel) carries meaning a human sees and an agent misses.

Run: python3 generate_probe_spreadsheets.py
Writes the two .xlsx files next to this script.
"""

import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


# ── Styling primitives (reused from the archived generator) ────────────────

HEADER_FILL = PatternFill("solid", fgColor="1F4E79")
HEADER_FONT = Font(bold=True, color="FFFFFF", size=11)
HEADER_ALIGN = Alignment(horizontal="center", wrap_text=True)


def style_header_row(ws, row, ncols):
    for col in range(1, ncols + 1):
        cell = ws.cell(row=row, column=col)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = HEADER_ALIGN


def auto_width(ws):
    for col in ws.columns:
        max_len = 0
        col_letter = get_column_letter(col[0].column)
        for cell in col:
            if cell.value:
                max_len = max(max_len, len(str(cell.value)))
        ws.column_dimensions[col_letter].width = min(max_len + 4, 45)


# ── The shared mapping data (the one intent, as flat rows) ─────────────────
# Each mapping is a list of rows: source, source_type, target, target_type,
# transform, required, notes.

MAPPING_COLUMNS = [
    "Source Field", "Source Type",
    "Target Field", "Target Type",
    "Transformation", "Required?", "Notes",
]


def claim_normalisation_rows():
    return [
        ("claim_header.claim_id", "VARCHAR(20)", "claim_key", "VARCHAR(20)", "Direct copy", "Y", "PK"),
        ("claim_header.policy_no", "VARCHAR(30)", "policy_ref", "VARCHAR(30)", "Direct copy", "N", "indexed"),
        ("claim_header.claim_type", "VARCHAR(15)", "claim_type_code", "VARCHAR(2)",
         "Map: auto->AU, home->HO, life->LI, health->HE", "N", ""),
        ("claim_header.reported_at", "TIMESTAMPTZ", "reported_date", "TIMESTAMP_NTZ", "Convert to UTC", "N", ""),
        ("claim_header.loss_amount", "DECIMAL(14,2)", "loss_usd", "DECIMAL(14,2)",
         "Convert to USD using fx_rates lookup on claim_header.currency, then round 2", "Y", ""),
        ("claim_header.loss_amount", "DECIMAL(14,2)", "loss_source", "VARCHAR(10)",
         "coalesce 0", "N", ""),
        ("claim_header.vehicles", "list_of record", "vehicle_count", "INT", "count", "N", ""),
        ("claim_header.parties", "list_of record", "party_count", "INT", "count", "N", ""),
        ("claim_header.vehicles.damage_extent", "VARCHAR(15)", "max_damage", "VARCHAR(15)",
         "Pick the worst damage across all vehicles on the claim", "N", ""),
        ("claim_header.vehicles.photos", "list_of record", "photos", "list_of record", "flatten", "N", ""),
        ("vehicles.photos.photo_id", "VARCHAR(36)", "photos.photo_ref", "VARCHAR(36)", "trim", "Y", "inside flatten"),
        ("vehicles.photos.angle", "VARCHAR(10)", "photos.view", "VARCHAR(10)", "lowercase", "N", "inside flatten"),
        ("claim_header.adjuster_id", "VARCHAR(20)", "adjuster_ref", "VARCHAR(20)", "trim", "N", ""),
        ("(computed — no source)", "", "is_open", "BOOLEAN",
         "True if claim_header.status is 'open' or 'under_review', false otherwise.", "N", ""),
    ]


def party_extract_rows():
    return [
        ("claim_header.claim_id", "VARCHAR(20)", "claim_key", "VARCHAR(20)", "Direct copy", "Y", ""),
        ("parties[].party_role", "VARCHAR(20)", "rows[].role", "VARCHAR(20)", "trim | uppercase", "Y", "each parties -> rows"),
        ("parties[].name", "VARCHAR(120)", "rows[].display_name", "VARCHAR(120)", "trim", "N", ""),
        ("parties[].contact_phone", "VARCHAR(20)", "rows[].phone_e164", "VARCHAR(20)",
         "Format to E.164, assuming US country code if no + prefix", "N", "PII"),
    ]


def vehicle_extract_rows():
    return [
        ("claim_header.claim_id", "VARCHAR(20)", "claim_key", "VARCHAR(20)", "Direct copy", "Y", ""),
        ("vehicles[].vin", "VARCHAR(17)", "rows[].vin", "VARCHAR(17)", "uppercase", "Y", "each vehicles -> rows"),
        ("vehicles[].make", "VARCHAR(40)", "rows[].description", "VARCHAR(100)",
         "vehicles.make || ' ' || vehicles.model || ' ' || vehicles.year", "N", ""),
        ("vehicles[].damage_extent", "VARCHAR(15)", "rows[].damage_class", "VARCHAR(15)",
         "Map: none->N, minor->M, moderate->M, severe->S, total->T", "N", ""),
        ("vehicles[].estimate", "DECIMAL(12,2)", "rows[].estimate_usd", "DECIMAL(12,2)", "round 2", "N", ""),
    ]


def status_snapshot_rows():
    return [
        ("claim_fact.claim_key", "VARCHAR(20)", "claim_key", "VARCHAR(20)", "Direct copy", "Y", "PK, ref claim_fact.claim_key"),
        ("claim_fact.is_open", "BOOLEAN", "open_flag", "BOOLEAN", "Direct copy", "N", ""),
        ("claim_fact.loss_usd", "DECIMAL(14,2)", "total_exposure", "DECIMAL(14,2)",
         "Sum exposure across all open claims for the same policy", "N", ""),
    ]


def payment_extract_rows():
    return [
        ("(generated)", "VARCHAR(36)", "payment_id", "VARCHAR(36)", "Generate UUID", "Y", "PK"),
        ("claim_fact.claim_key", "VARCHAR(20)", "claim_key", "VARCHAR(20)", "Direct copy", "Y", "ref claim_fact.claim_key"),
        ("claim_fact.loss_usd", "DECIMAL(14,2)", "paid_amount", "DECIMAL(14,2)", "round 2", "N", ""),
        ("claim_fact.reported_date", "TIMESTAMP_NTZ", "paid_at", "TIMESTAMP_NTZ", "to_utc", "N", ""),
    ]


def fraud_assessment_rows():
    return [
        ("claim_fact.claim_key", "VARCHAR(20)", "claim_key", "VARCHAR(20)", "Direct copy", "Y", "PK, ref claim_fact.claim_key"),
        ("claim_fact.party_count", "INT", "risk_score", "INT",
         "Score from 0-100 based on claim_fact.party_count and party_dim role distribution", "N", ""),
        ("(computed — no source)", "", "is_flagged", "BOOLEAN",
         "True if risk_score > 70, false otherwise.", "N", ""),
    ]


MAPPINGS = [
    ("claim_normalisation", claim_normalisation_rows()),
    ("party_extract", party_extract_rows()),
    ("vehicle_extract", vehicle_extract_rows()),
    ("status_snapshot", status_snapshot_rows()),
    ("payment_extract", payment_extract_rows()),
    ("fraud_assessment", fraud_assessment_rows()),
]


# ── X-P0: tidy ─────────────────────────────────────────────────────────────

def build_p0():
    wb = openpyxl.Workbook()
    # A cover/README tab first (P0 still has one — it's tidy, not bare).
    cover = wb.active
    cover.title = "README"
    cover["A1"] = "Meridian Mutual — Claims Mapping (P0 tidy)"
    cover["A1"].font = Font(bold=True, size=14)
    cover["A3"] = "One tab per mapping. Columns: " + ", ".join(MAPPING_COLUMNS)
    cover.column_dimensions["A"].width = 90

    for name, rows in MAPPINGS:
        ws = wb.create_sheet(name)
        ws.append(MAPPING_COLUMNS)
        style_header_row(ws, 1, len(MAPPING_COLUMNS))
        for r in rows:
            ws.append(r)
        auto_width(ws)

    path = os.path.join(SCRIPT_DIR, "meridian-claims-P0.xlsx")
    wb.save(path)
    print(f"Created: {path}")


# ── X-P2: realistic-messy ──────────────────────────────────────────────────
# P0 + free-text Notes, merged headers, fill-colour-as-semantics (NO legend),
# multi-row title block pushing headers off row 1, and a stale "Archived" tab.

P2_NOTE_FILL = PatternFill("solid", fgColor="FFF2CC")  # "needs review" yellow
P2_PII_FILL = PatternFill("solid", fgColor="FCE4D6")   # peach = PII
P2_COMPUTED_FILL = PatternFill("solid", fgColor="E2EFDA")  # green = computed/no-source
# The load-bearing P2 hazard: this fill carries meaning pandas cannot read.
P2_AMBIGUITY_FILL = PatternFill("solid", fgColor="D9E1F2")  # blue = ambiguous transform


def build_p2():
    wb = openpyxl.Workbook()

    # Tab 1: a multi-row title block — headers are NOT on row 1.
    ws = wb.create_sheet("claim_normalisation")
    ws["A1"] = "Meridian Mutual"
    ws["A1"].font = Font(bold=True, size=16)
    ws["A2"] = "Claims Mapping — v3 (working draft)"
    ws["A2"].font = Font(italic=True, size=11)
    ws["A3"] = "Owner: Data Eng | Last updated: see Changelog tab"
    # Merged header cell spanning the column set on row 5 (off row 1).
    ws.merge_cells("A5:G5")
    ws["A5"] = "FIELD MAPPING"
    ws["A5"].font = Font(bold=True, size=12, color="FFFFFF")
    ws["A5"].fill = HEADER_FILL
    ws["A5"].alignment = Alignment(horizontal="center")
    # Actual column headers on row 6.
    for col, h in enumerate(MAPPING_COLUMNS, 1):
        ws.cell(row=6, column=col, value=h)
    style_header_row(ws, 6, len(MAPPING_COLUMNS))

    rows = MAPPINGS[0][1]
    for i, r in enumerate(rows):
        excel_row = 7 + i
        for col, val in enumerate(r, 1):
            ws.cell(row=excel_row, column=col, value=val)
        # Fill-colour semantics (NO legend anywhere in the workbook).
        target_field = r[2]
        transform = r[4]
        notes = r[6]
        if target_field == "is_open":
            for c in range(1, 8):
                ws.cell(row=excel_row, column=c).fill = P2_COMPUTED_FILL
        elif target_field == "loss_usd" or target_field == "total_exposure":
            # The underspecified-rounding ambiguities — marked by fill only.
            for c in range(1, 8):
                ws.cell(row=excel_row, column=c).fill = P2_AMBIGUITY_FILL
        elif "PII" in notes or "contact_phone" in (r[0] or ""):
            for c in range(1, 8):
                ws.cell(row=excel_row, column=c).fill = P2_PII_FILL
        elif notes:
            for c in range(1, 8):
                ws.cell(row=excel_row, column=c).fill = P2_NOTE_FILL

    auto_width(ws)

    # Remaining mappings: standard header row but with a free-text Notes column
    # that mixes rules and commentary (P1-style, but P2 keeps it).
    for name, rows in MAPPINGS[1:]:
        ws2 = wb.create_sheet(name)
        ws2.append(MAPPING_COLUMNS)
        style_header_row(ws2, 1, len(MAPPING_COLUMNS))
        for r in rows:
            ws2.append(r)
        # PII rows across all tabs.
        for row in ws2.iter_rows(min_row=2, max_row=ws2.max_row):
            if "PII" in str(row[6].value or "") or "contact_phone" in str(row[0].value or ""):
                for cell in row:
                    cell.fill = P2_PII_FILL
            # Ambiguity rows (underspecified rounding / no-source computed).
            tgt = str(row[2].value or "")
            if tgt in ("total_exposure", "phone_e164") or "round" in str(row[4].value or "").lower():
                for cell in row:
                    cell.fill = P2_AMBIGUITY_FILL
        auto_width(ws2)

    # A stale "Archived" tab that a tidy author would have deleted.
    ws_arch = wb.create_sheet("Archived v2 mapping")
    ws_arch["A1"] = "Superseded by claim_normalisation tab above. Do not use."
    ws_arch["A1"].font = Font(strikethrough=True, color="999999")
    ws_arch.append([])
    ws_arch.append(MAPPING_COLUMNS)
    style_header_row(ws_arch, 3, len(MAPPING_COLUMNS))
    ws_arch.append(("claim_header.claim_id", "VARCHAR(20)", "claim_id", "VARCHAR(20)",
                    "Direct copy", "Y", "OLD — renamed to claim_key in v3"))
    auto_width(ws_arch)

    # A Changelog tab (matches the multi-tab fixture style).
    ws_log = wb.create_sheet("Changelog")
    ws_log.append(["Date", "Author", "Change"])
    style_header_row(ws_log, 3, 3, fill_color="808080")
    ws_log.append(("2025-11-02", "R. Varga", "Initial draft"))
    ws_log.append(("2025-11-20", "R. Varga", "Added party_extract and vehicle_extract tabs"))
    ws_log.append(("2025-12-01", "L. Okafor", "Marked loss_usd rounding as needing review (see fill)"))
    auto_width(ws_log)

    path = os.path.join(SCRIPT_DIR, "meridian-claims-P2.xlsx")
    wb.save(path)
    print(f"Created: {path}")


def style_header_row(ws, row, ncols, fill_color="1F4E79", font_color="FFFFFF"):
    for col in range(1, ncols + 1):
        cell = ws.cell(row=row, column=col)
        cell.font = Font(bold=True, color=font_color, size=11)
        cell.fill = PatternFill("solid", fgColor=fill_color)
        cell.alignment = Alignment(horizontal="center", wrap_text=True)


if __name__ == "__main__":
    build_p0()
    build_p2()
    print("\nDone — 2 probe workbooks created.")
