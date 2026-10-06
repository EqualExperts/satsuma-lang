/**
 * field-badges.ts — which badges a schema-card field row shows, and what each
 * one says.
 *
 * Two consumers must agree on this list. `sz-schema-card` renders it, and the
 * overview layout (`layout/elk-layout.ts`) estimates from it how wide an
 * expanded card should be and how many lines each row's badges wrap onto —
 * before any DOM exists. When the layout only knew about constraint badges, a
 * field carrying several metadata pills (`format email`, `mask …`) was laid
 * out a line shorter and narrower than it rendered. One definition keeps the
 * estimate and the painted row from drifting apart.
 *
 * Owns badge selection and label text only. Styling, the enum overlay and
 * click handling stay in the card.
 */

import type { FieldEntry, MetadataEntry } from "./model.js";

/** The constraint tag that renders as its own highlighted PII badge. */
export const PII_TAG = "pii";

/** Visible text of the PII badge: a shield glyph followed by the tag. */
export const PII_BADGE_TEXT = "\u{1F6E1} pii";

/**
 * Metadata entries to render as pills on a field row: everything the author
 * wrote except entries already rendered elsewhere on the row (sl-6x1o).
 * Key-value entries always render — `sensitivity internal` and
 * `access_group property_facilities` must be visible, and a kv whose key is
 * also a constraint tag (e.g. `encrypt aes`) carries a value the badge
 * alone would hide. Excluded:
 *   - bare tags already shown as constraint badges
 *   - `note` entries, which render as the shaded field-note row below the
 *     field (sl-1gqw) — same dedupe the schema-level pills apply
 */
export function fieldMetaPills(f: FieldEntry): MetadataEntry[] {
  // Tolerate models serialized before FieldEntry carried metadata (older
  // LSP servers, cached webview payloads) — render no pills, don't crash.
  return (f.metadata ?? []).filter(
    (m) => m.key !== "note" && !(m.value === "" && f.constraints.includes(m.key)),
  );
}

/**
 * An enum entry's individual values. Prefers `m.values` (present from
 * sl-2ne7 onward); falls back to re-splitting the joined `value` for
 * payloads from an older viz-backend or a cached webview that predate it,
 * the same tolerance {@link fieldMetaPills} extends to a missing `metadata`
 * array.
 */
export function enumValues(m: MetadataEntry): string[] {
  return m.values ?? (m.value ? m.value.split(" | ") : []);
}

/**
 * The visible text of every badge on a field row, in render order: plain
 * constraint tags, then the PII badge, then metadata pills. An enum pill reads
 * as its collapsed count (`enum (3)`, sl-2ne7), not its value list.
 */
export function fieldBadgeLabels(f: FieldEntry): string[] {
  const constraintLabels = f.constraints.filter((c) => c !== PII_TAG);
  const piiLabel = f.constraints.includes(PII_TAG) ? [PII_BADGE_TEXT] : [];
  const metaLabels = fieldMetaPills(f).map((m) =>
    m.key === "enum" ? `enum (${enumValues(m).length})` : `${m.key}${m.value ? ` ${m.value}` : ""}`,
  );
  return [...constraintLabels, ...piiLabel, ...metaLabels];
}
