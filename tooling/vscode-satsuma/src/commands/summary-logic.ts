/**
 * summary-logic.ts — pure parsing and formatting of `satsuma summary --json`
 * output (no vscode).
 *
 * Section shapes mirror the CLI's envelope exactly (see the CLI's own
 * addHelpText in `tooling/satsuma-cli/src/commands/summary.ts`). Only
 * `schemas` carries a `note` — mappings/fragments/transforms/metrics do not,
 * so the formatters here must not invent fields the CLI never emits. Kept
 * separate from summary.ts so parsing and formatting stay unit-testable in
 * plain Node (mirrors coverage-logic.ts).
 */

export interface SchemaSummary {
  name: string;
  fieldCount: number;
  note: string | null;
}

export interface MetricSummary {
  name: string;
  fieldCount: number;
  displayName: string | null;
  grain: string | null;
}

export interface MappingSummary {
  name: string;
  arrowCount: number;
  sources: string[];
  targets: string[];
}

export interface FragmentSummary {
  name: string;
  fieldCount: number;
}

export interface TransformSummary {
  name: string;
}

/** Envelope shape of `satsuma summary --json`. */
export interface SummaryResponse {
  schemas: SchemaSummary[];
  metrics: MetricSummary[];
  mappings: MappingSummary[];
  fragments: FragmentSummary[];
  transforms: TransformSummary[];
  fileCount: number;
}

/**
 * Parse `satsuma summary --json` stdout.
 *
 * Returns undefined for unparseable JSON or a non-object response — both
 * signal something wrong with the CLI invocation itself.
 */
export function parseSummaryResponse(raw: string): SummaryResponse | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object") {
    return undefined;
  }
  return parsed as SummaryResponse;
}

function formatSchema(s: SchemaSummary): string {
  const fields = s.fieldCount === 1 ? `[${s.fieldCount} field]` : `[${s.fieldCount} fields]`;
  const note = s.note ? ` — ${s.note}` : "";
  return `  ${s.name}  ${fields}${note}`;
}

function formatMetric(m: MetricSummary): string {
  const fields = m.fieldCount === 1 ? `[${m.fieldCount} field]` : `[${m.fieldCount} fields]`;
  const displayName = m.displayName ? ` "${m.displayName}"` : "";
  const grain = m.grain ? `  grain=${m.grain}` : "";
  return `  ${m.name}${displayName}  ${fields}${grain}`;
}

function formatMapping(m: MappingSummary): string {
  const src = m.sources.join(", ") || "?";
  const tgt = m.targets.join(", ") || "?";
  const arrows = m.arrowCount === 1 ? `[${m.arrowCount} arrow]` : `[${m.arrowCount} arrows]`;
  return `  ${m.name}  ${src} → ${tgt}  ${arrows}`;
}

function formatFragment(f: FragmentSummary): string {
  const fields = f.fieldCount === 1 ? `[${f.fieldCount} field]` : `[${f.fieldCount} fields]`;
  return `  ${f.name}  ${fields}`;
}

function formatTransform(t: TransformSummary): string {
  return `  ${t.name}`;
}

/** One rendered section: a heading label paired with its formatted item lines. */
export interface SummarySection {
  label: string;
  items: string[];
}

/**
 * Build the non-empty sections (Schemas, Mappings, Fragments, Transforms,
 * Metrics) as plain text lines, in the order the output channel renders them.
 * Sections with no items are omitted entirely, matching the original
 * behaviour of skipping empty categories.
 */
export function buildSummarySections(data: SummaryResponse): SummarySection[] {
  const sections: SummarySection[] = [
    { label: "Schemas", items: data.schemas.map(formatSchema) },
    { label: "Mappings", items: data.mappings.map(formatMapping) },
    { label: "Fragments", items: data.fragments.map(formatFragment) },
    { label: "Transforms", items: data.transforms.map(formatTransform) },
    { label: "Metrics", items: data.metrics.map(formatMetric) },
  ];
  return sections.filter((section) => section.items.length > 0);
}
