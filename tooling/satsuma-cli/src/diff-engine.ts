/**
 * diff.ts — Structural comparison of two ExtractedWorkspace instances
 *
 * Compares schemas (fields, types, metadata, notes), mappings (arrows,
 * transforms, notes), metrics (sources, grain, slices, notes), fragments,
 * transforms, and standalone note blocks.
 *
 * The module is consumed by the `satsuma diff` command and any downstream
 * tooling that needs programmatic delta information between two workspaces.
 */

import type {
  ArrowRecord,
  BlockDelta,
  Delta,
  FieldDecl,
  FragmentRecord,
  MappingChange,
  MappingRecord,
  MetricRecord,
  NoteDelta,
  NoteRecord,
  SchemaChange,
  SchemaRecord,
  TransformChange,
  TransformRecord,
  ExtractedWorkspace,
} from "./types.js";
import { distinctArrowRecords } from "./index-builder.js";

/** Collect note texts for a given parent name from an index's notes. */
function noteTextsForParent(index: ExtractedWorkspace, parentName: string): Set<string> {
  const texts = new Set<string>();
  for (const note of index.notes ?? []) {
    if (note.parent === parentName) texts.add(note.text);
  }
  return texts;
}

/**
 * Compute a structural delta between two ExtractedWorkspace instances.
 *
 * Compares every block type (schemas, mappings, metrics, fragments, transforms)
 * plus standalone note blocks. Block-owned note blocks (those with a non-null
 * parent) are compared within their parent block's diff, not at the top level.
 *
 * Anonymous mappings are re-keyed to position-independent structural ids
 * before comparison (see `normalizeAnonMappingKeys`), so byte-identical files
 * at different paths diff clean and user-facing output never leaks the
 * internal `<anon>@file:row` key (sl-ndtz).
 */
export function diffIndex(indexA: ExtractedWorkspace, indexB: ExtractedWorkspace): Delta {
  indexA = normalizeAnonMappingKeys(indexA);
  indexB = normalizeAnonMappingKeys(indexB);

  // Collect arrows per mapping for detailed comparison
  const arrowsA = collectArrowsByMapping(indexA);
  const arrowsB = collectArrowsByMapping(indexB);

  return {
    schemas: diffBlockMap(indexA.schemas, indexB.schemas, (a, b, key) => {
      const notesA = noteTextsForParent(indexA, key);
      const notesB = noteTextsForParent(indexB, key);
      return diffSchema(a, b, notesA, notesB);
    }),
    mappings: diffBlockMap(indexA.mappings, indexB.mappings, (a, b, key) => {
      const notesA = noteTextsForParent(indexA, key);
      const notesB = noteTextsForParent(indexB, key);
      return diffMapping(a, b, arrowsA.get(key) ?? [], arrowsB.get(key) ?? [], notesA, notesB);
    }),
    metrics: diffBlockMap(indexA.metrics, indexB.metrics, (a, b, key) => {
      const notesA = noteTextsForParent(indexA, key);
      const notesB = noteTextsForParent(indexB, key);
      return diffMetric(a, b, notesA, notesB);
    }),
    fragments: diffBlockMap(indexA.fragments, indexB.fragments, diffFragment),
    transforms: diffBlockMap(indexA.transforms, indexB.transforms, diffTransform),
    notes: diffNotes(indexA.notes ?? [], indexB.notes ?? []),
  };
}

// ── Anonymous mapping normalization (sl-ndtz) ────────────────────────────────

/**
 * The index stores anonymous mappings under synthetic keys of the form
 * `[ns::]<anon>@<absolute-file-path>:<0-based-row>` (see index-builder.ts).
 * That key is positional by design — other consumers (arrows, lint fixes)
 * need to locate the block in its file — but it is wrong for diffing: two
 * byte-identical files always differ in path, so every anonymous mapping
 * shows up as removed-and-added, and the internal key leaks into user output.
 */
const ANON_KEY = /<anon>@.*:\d+$/;

/**
 * Re-key anonymous mappings by what they map rather than where they live.
 *
 * The structural id is `<anonymous src1,src2 -> tgt1,tgt2>` (namespace prefix
 * preserved). Several anonymous mappings with the same signature in one
 * workspace get stable ` #2`, ` #3`… suffixes in file/row order, so they pair
 * up positionally across the two sides of the diff. Arrow records and note
 * parents referencing the old keys are rewritten to match.
 *
 * Returns a shallow copy; the input index is not mutated.
 */
function normalizeAnonMappingKeys(index: ExtractedWorkspace): ExtractedWorkspace {
  // Map old key → new structural key, assigning ordinals per signature in
  // deterministic (file, row) order.
  const rename = new Map<string, string>();
  const ordinals = new Map<string, number>();
  const anonEntries = [...index.mappings.entries()]
    .filter(([key]) => ANON_KEY.test(key))
    .sort(([, a], [, b]) => (a.file ?? "").localeCompare(b.file ?? "") || a.row - b.row);

  for (const [key, mapping] of anonEntries) {
    const ns = key.includes("::") ? key.slice(0, key.indexOf("::") + 2) : "";
    const signature = `${ns}<anonymous ${mapping.sources.join(",")} -> ${mapping.targets.join(",")}>`;
    const seen = ordinals.get(signature) ?? 0;
    ordinals.set(signature, seen + 1);
    rename.set(key, seen === 0 ? signature : `${signature.slice(0, -1)} #${seen + 1}>`);
  }

  if (rename.size === 0) return index;

  // Arrow records and note parents carry the *bare* (namespace-less) form of
  // the key, so register those spellings too.
  for (const [key, newKey] of [...rename]) {
    const sep = key.indexOf("::");
    if (sep !== -1) rename.set(key.slice(sep + 2), newKey.slice(newKey.indexOf("::") + 2));
  }

  return {
    ...index,
    mappings: new Map([...index.mappings].map(([key, m]) => [rename.get(key) ?? key, m])),
    fieldArrows: new Map(
      [...index.fieldArrows].map(([field, records]) => [
        field,
        records.map((r) =>
          r.mapping && rename.has(r.mapping) ? { ...r, mapping: rename.get(r.mapping) ?? r.mapping } : r,
        ),
      ]),
    ),
    notes: (index.notes ?? []).map((n) =>
      n.parent && rename.has(n.parent) ? { ...n, parent: rename.get(n.parent) ?? n.parent } : n,
    ),
  };
}

/**
 * Collect arrow records grouped by mapping key.
 */
function collectArrowsByMapping(index: ExtractedWorkspace): Map<string, ArrowRecord[]> {
  const byMapping = new Map<string, ArrowRecord[]>();

  for (const r of distinctArrowRecords(index.fieldArrows)) {
    const key = r.namespace ? `${r.namespace}::${r.mapping}` : (r.mapping ?? "");
    if (!byMapping.has(key)) byMapping.set(key, []);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: key initialized on previous line
    byMapping.get(key)!.push(r);
  }

  return byMapping;
}

/**
 * Generic structural diff for a Map of named blocks.
 *
 * The diffFn callback receives the key alongside both values, so callers
 * can look up associated data (e.g. notes) without a reverse-map scan.
 * (Fixes O(n^2) reverse lookup — sl-g4eo.)
 */
function diffBlockMap<T, C>(
  mapA: Map<string, T>,
  mapB: Map<string, T>,
  diffFn: (a: T, b: T, key: string) => C[],
): BlockDelta<C> {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: Array<{ name: string; changes: C[] }> = [];

  for (const name of mapA.keys()) {
    if (!mapB.has(name)) {
      removed.push(name);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: .has() check on line above guarantees both entries exist
      const changes = diffFn(mapA.get(name)!, mapB.get(name)!, name);
      if (changes.length > 0) {
        changed.push({ name, changes });
      }
    }
  }
  for (const name of mapB.keys()) {
    if (!mapA.has(name)) {
      added.push(name);
    }
  }

  return { added, removed, changed };
}

// ── Schema diff ────────────────────────────────────────────────────────────

/**
 * Compute the change set for a single schema between two workspaces.
 *
 * A schema's "shape" for diff purposes is: its inline `note "..."` label, its
 * field tree (compared structurally — see `diffFieldList`), and any standalone
 * `note { ... }` blocks attached to it.
 *
 * Note text is compared by string equality rather than fuzzy match because
 * even small wording changes are typically meaningful for documentation
 * intent and should be surfaced to the reviewer.
 */
function diffSchema(a: SchemaRecord, b: SchemaRecord, notesA: Set<string>, notesB: Set<string>): SchemaChange[] {
  const changes: SchemaChange[] = [];

  // Compare schema-level note text (note "..." in metadata block)
  if ((a.note ?? "") !== (b.note ?? "")) {
    changes.push({ kind: "note-changed", field: "(note)", from: a.note || "(none)", to: b.note || "(none)" });
  }

  // Compare fields
  changes.push(...diffFieldList(a.fields, b.fields));

  // Compare note blocks inside the schema body (sl-fkwb)
  changes.push(...diffNoteSet(notesA, notesB));

  return changes;
}

// ── Metric diff ────────────────────────────────────────────────────────────

/**
 * Compute the change set for a single metric between two workspaces.
 *
 * A metric is a schema decorated with metric-specific header attributes
 * (`source`, `grain`, `slice`), so the diff is the union of:
 *  1. Header attribute changes — emitted as dedicated change kinds so the
 *     reviewer can see at a glance whether the *definition* of the metric
 *     moved (e.g. grain changed from `day` to `hour` is a semantic shift
 *     that affects every downstream chart).
 *  2. Field changes — same logic as schemas.
 *  3. Note changes — same logic as schemas.
 *
 * Header arrays (sources, slices) are compared by JSON equality so order
 * matters: reordering `slice { region, segment }` to `slice { segment, region }`
 * is reported as a change because it can affect serialization order in
 * downstream consumers.
 */
function diffMetric(a: MetricRecord, b: MetricRecord, notesA: Set<string>, notesB: Set<string>): SchemaChange[] {
  const changes: SchemaChange[] = [];

  // Compare metric header attributes (sl-1meq)
  const aSources = JSON.stringify(a.sources);
  const bSources = JSON.stringify(b.sources);
  if (aSources !== bSources) {
    changes.push({ kind: "source-changed", field: "(source)", from: a.sources.join(", ") || "(none)", to: b.sources.join(", ") || "(none)" });
  }
  if ((a.grain ?? "") !== (b.grain ?? "")) {
    changes.push({ kind: "grain-changed", field: "(grain)", from: a.grain || "(none)", to: b.grain || "(none)" });
  }
  const aSlices = JSON.stringify(a.slices);
  const bSlices = JSON.stringify(b.slices);
  if (aSlices !== bSlices) {
    changes.push({ kind: "slices-changed", field: "(slices)", from: a.slices.join(", ") || "(none)", to: b.slices.join(", ") || "(none)" });
  }

  // Compare fields
  changes.push(...diffFieldList(a.fields, b.fields));

  // Compare notes inside the metric
  changes.push(...diffNoteSet(notesA, notesB));

  return changes;
}

// ── Fragment diff ──────────────────────────────────────────────────────────

/**
 * Compute the change set for a fragment.
 *
 * Fragments are field-only — no metadata, no notes, no header attributes —
 * so the diff reduces to a structural field-list comparison. We still return
 * `SchemaChange[]` (rather than a fragment-specific kind) so callers can
 * render fragment changes through the same UI path as schema changes.
 */
function diffFragment(a: FragmentRecord, b: FragmentRecord): SchemaChange[] {
  return diffFieldList(a.fields, b.fields);
}

// ── Transform diff ─────────────────────────────────────────────────────────

/**
 * Compute the change set for a named transform.
 *
 * Transform bodies are NL strings (Feature 28 made everything inside a pipe
 * step human-interpreted), so we cannot meaningfully diff them structurally.
 * We compare body text verbatim and emit a single `body-changed` event with
 * the before/after text — the reviewer reads the diff themselves.
 */
function diffTransform(a: TransformRecord, b: TransformRecord): TransformChange[] {
  const changes: TransformChange[] = [];
  if ((a.body ?? "") !== (b.body ?? "")) {
    changes.push({ kind: "body-changed", from: a.body || "(empty)", to: b.body || "(empty)" });
  }
  return changes;
}

// ── Field list diff ────────────────────────────────────────────────────────

/**
 * Recursively diff two field trees, qualifying changes by dotted path.
 *
 * Match key is the field name within its parent, not the dotted path. This
 * means a field renamed at depth N is reported as removed-and-added rather
 * than as a rename — there is no rename detection because Satsuma has no
 * rename syntax and any "rename" is indistinguishable from a delete + add.
 *
 * For each matched pair we report (in order):
 *  1. Type change      — `type-changed`
 *  2. Metadata change  — `metadata-changed` (serialized via `serializeMetadata`
 *                        so reorderings of equivalent metadata do not produce
 *                        spurious diffs)
 *  3. Recursive child diff for nested records
 *
 * The `prefix` argument carries the dotted path of the parent so leaf changes
 * are reported as `address.city` rather than just `city`.
 */
function diffFieldList(aFields: FieldDecl[], bFields: FieldDecl[], prefix = ""): SchemaChange[] {
  const changes: SchemaChange[] = [];
  const aMap = new Map<string, FieldDecl>(aFields.map((f) => [f.name, f]));
  const bMap = new Map<string, FieldDecl>(bFields.map((f) => [f.name, f]));

  for (const [name, field] of aMap) {
    const qualName = prefix ? `${prefix}.${name}` : name;
    if (!bMap.has(name)) {
      changes.push({ kind: "field-removed", field: qualName });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: .has() check above guarantees entry exists
      const bField = bMap.get(name)!;
      if (field.type !== bField.type) {
        changes.push({ kind: "type-changed", field: qualName, from: field.type, to: bField.type });
      }
      // Compare metadata
      const aMeta = serializeMetadata(field.metadata);
      const bMeta = serializeMetadata(bField.metadata);
      if (aMeta !== bMeta) {
        changes.push({ kind: "metadata-changed", field: qualName, from: aMeta || "(none)", to: bMeta || "(none)" });
      }
      // Recurse into nested children
      if (field.children || bField.children) {
        changes.push(...diffFieldList(field.children ?? [], bField.children ?? [], qualName));
      }
    }
  }
  for (const [name] of bMap) {
    if (!aMap.has(name)) {
      const qualName = prefix ? `${prefix}.${name}` : name;
      changes.push({ kind: "field-added", field: qualName });
    }
  }
  return changes;
}

// ── Mapping diff ───────────────────────────────────────────────────────────

/**
 * Compute the change set for a single mapping between two workspaces.
 *
 * A mapping is the most change-rich block type. We report changes in three
 * categories, each with its own match key:
 *
 *  1. Header changes — `arrow-count`, `sources`, `targets`. These are
 *     summary signals that help a reviewer triage large diffs ("did the
 *     overall mapping shape change?") before drilling into individual arrows.
 *
 *  2. Per-arrow changes — matched by `"src1,src2,...→tgt"` because
 *     `(sources, target)` uniquely identifies an arrow within a mapping.
 *     We deliberately do *not* match by line number: arrows reordered without
 *     semantic change should not produce diffs. The transform body is
 *     compared after matching so an unchanged arrow with a tweaked transform
 *     is reported as `arrow-transform-changed` rather than removed+added
 *     (sl-edrw).
 *
 *  3. Note changes — by string equality, same as schemas (sl-van1).
 */
function diffMapping(a: MappingRecord, b: MappingRecord, arrowsA: ArrowRecord[], arrowsB: ArrowRecord[], notesA: Set<string>, notesB: Set<string>): MappingChange[] {
  const changes: MappingChange[] = [];

  if (a.arrowCount !== b.arrowCount) {
    changes.push({
      kind: "arrow-count-changed",
      from: a.arrowCount,
      to: b.arrowCount,
    });
  }

  // Compare source/target lists
  const aSources = JSON.stringify(a.sources);
  const bSources = JSON.stringify(b.sources);
  if (aSources !== bSources) {
    changes.push({ kind: "sources-changed", from: a.sources, to: b.sources });
  }

  const aTargets = JSON.stringify(a.targets);
  const bTargets = JSON.stringify(b.targets);
  if (aTargets !== bTargets) {
    changes.push({ kind: "targets-changed", from: a.targets, to: b.targets });
  }

  // Compare individual arrows by source->target key (sl-edrw: includes transform body)
  const arrowKey = (r: ArrowRecord) => `${r.sources.join(",") || ""}→${r.target ?? ""}`;
  const aByKey = new Map<string, ArrowRecord>();
  const bByKey = new Map<string, ArrowRecord>();
  for (const r of arrowsA) aByKey.set(arrowKey(r), r);
  for (const r of arrowsB) bByKey.set(arrowKey(r), r);

  for (const [key, ar] of aByKey) {
    if (!bByKey.has(key)) {
      changes.push({ kind: "arrow-removed", arrow: key });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: .has() check above guarantees entry exists
      const br = bByKey.get(key)!;
      if (ar.transform_raw !== br.transform_raw) {
        changes.push({
          kind: "arrow-transform-changed",
          arrow: key,
          from: ar.transform_raw || "(none)",
          to: br.transform_raw || "(none)",
        });
      }
    }
  }
  for (const key of bByKey.keys()) {
    if (!aByKey.has(key)) {
      changes.push({ kind: "arrow-added", arrow: key });
    }
  }

  // Compare notes inside the mapping (sl-van1)
  for (const text of notesB) {
    if (!notesA.has(text)) {
      const preview = text.length > 60 ? text.slice(0, 60) + "..." : text;
      changes.push({ kind: "note-added", from: preview });
    }
  }
  for (const text of notesA) {
    if (!notesB.has(text)) {
      const preview = text.length > 60 ? text.slice(0, 60) + "..." : text;
      changes.push({ kind: "note-removed", from: preview });
    }
  }

  return changes;
}

// ── Note diff helpers ──────────────────────────────────────────────────────

/** Maximum preview length for note text in change descriptions. */
const NOTE_PREVIEW_MAX_LENGTH = 60;

/**
 * Compare two sets of note texts and emit note-added / note-removed changes.
 * Used by schema, metric, and mapping block diffs to detect note block changes
 * within a parent block.
 */
function diffNoteSet(notesA: Set<string>, notesB: Set<string>): SchemaChange[] {
  const changes: SchemaChange[] = [];

  for (const text of notesB) {
    if (!notesA.has(text)) {
      const preview = text.length > NOTE_PREVIEW_MAX_LENGTH
        ? text.slice(0, NOTE_PREVIEW_MAX_LENGTH) + "..."
        : text;
      changes.push({ kind: "note-added", field: "(note)", from: preview });
    }
  }
  for (const text of notesA) {
    if (!notesB.has(text)) {
      const preview = text.length > NOTE_PREVIEW_MAX_LENGTH
        ? text.slice(0, NOTE_PREVIEW_MAX_LENGTH) + "..."
        : text;
      changes.push({ kind: "note-removed", field: "(note)", from: preview });
    }
  }

  return changes;
}

/**
 * Compare standalone (top-level) notes between two indexes.
 * Block-owned notes (parent !== null) are compared by their owning block's diff.
 */
function diffNotes(notesA: NoteRecord[], notesB: NoteRecord[]): NoteDelta {
  const textsA = new Set(notesA.filter((n) => n.parent === null).map((n) => n.text));
  const textsB = new Set(notesB.filter((n) => n.parent === null).map((n) => n.text));
  const added: string[] = [];
  const removed: string[] = [];

  for (const t of textsB) {
    if (!textsA.has(t)) added.push(t);
  }
  for (const t of textsA) {
    if (!textsB.has(t)) removed.push(t);
  }

  return { added, removed };
}

// ── Metadata serialization ─────────────────────────────────────────────────

function serializeMetadata(metadata: FieldDecl["metadata"]): string {
  if (!metadata || metadata.length === 0) return "";
  return metadata.map((m) => {
    if (m.kind === "tag") return m.tag;
    if (m.kind === "kv") return `${m.key} ${m.value}`;
    if (m.kind === "enum") return `enum {${m.values.join(", ")}}`;
    if (m.kind === "note") return `note "${m.text}"`;
    if (m.kind === "slice") return `slice {${m.values.join(", ")}}`;
    return JSON.stringify(m);
  }).join(", ");
}
