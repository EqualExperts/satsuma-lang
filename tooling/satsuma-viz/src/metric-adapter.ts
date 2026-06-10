/**
 * metric-adapter.ts — adapts metrics to the schema-card shape.
 *
 * Metrics are valid mapping endpoints: a pipeline mapping populates a metric
 * (schema → metric) and downstream reports consume one (metric → report).
 * Most of the rendering and layout machinery, however, is written against
 * SchemaCard/FieldEntry. This module owns the one-way adaptations those
 * consumers use — the layout's field-port builder and the mapping detail
 * view both resolve metric endpoints through here (sl-cw68), so the two
 * surfaces cannot drift apart. It does not own metric *rendering*; the
 * overview's <sz-metric-card> renders real MetricCard objects directly.
 */

import type { FieldEntry, MetadataEntry, MetricCard, SchemaCard } from "./model.js";

/**
 * Widen a metric's lean measure fields to full FieldEntry shape.
 * MetricFieldEntry has no constraints/comments/children; they are empty, not
 * unknown, so empty arrays are the faithful translation.
 */
export function metricFieldEntries(metric: MetricCard): FieldEntry[] {
  return metric.fields.map((f) => ({
    name: f.name,
    type: f.type,
    constraints: [],
    metadata: [],
    notes: f.notes,
    comments: [],
    children: [],
    location: f.location,
  }));
}

/**
 * Present a metric as a SchemaCard so schema-shaped consumers (the mapping
 * detail view, field coverage) can treat it as a mapping endpoint. The
 * metric-specific declarations (grain, slices, filter) become metadata pills
 * so the detail view still shows what makes the endpoint a metric.
 */
export function metricAsSchemaCard(metric: MetricCard): SchemaCard {
  const metadata: MetadataEntry[] = [{ key: "metric", value: metric.id }];
  if (metric.grain) metadata.push({ key: "grain", value: metric.grain });
  if (metric.slices.length > 0) metadata.push({ key: "slice", value: metric.slices.join(", ") });
  if (metric.filter) metadata.push({ key: "filter", value: metric.filter });

  return {
    id: metric.id,
    qualifiedId: metric.qualifiedId,
    kind: "schema",
    label: metric.label,
    fields: metricFieldEntries(metric),
    notes: metric.notes,
    comments: metric.comments,
    metadata,
    location: metric.location,
    hasExternalLineage: false,
    spreads: [],
  };
}
