/**
 * ELK.js layout engine for Satsuma mapping visualization.
 *
 * Converts a VizModel into an ELK graph, runs layered layout, and returns
 * positioned nodes (cards) and routed edges (arrows).
 */

import ELK from "elkjs/lib/elk.bundled.js";
import type {
  VizModel,
  NamespaceGroup,
  SchemaCard,
  MetricCard,
  FragmentCard,
  MappingBlock,
  FieldEntry,
  ArrowEntry,
  EachBlock,
  FlattenBlock,
} from "../model.js";
import { buildMappedFieldsIndex } from "../field-coverage.js";

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind?: "schema" | "metric" | "fragment" | "mapping";
  hasNamespace?: boolean;
  /** Port positions keyed by field name */
  ports: Map<string, { x: number; y: number }>;
}

export interface LayoutEdge {
  id: string;
  sourceNode: string;
  targetNode: string;
  sourceField: string;
  targetField: string;
  /** Array of {x,y} points forming the routed edge path */
  points: Array<{ x: number; y: number }>;
  /** Arrow metadata for rendering style */
  arrow: ArrowEntry;
  /** Context label for each/flatten/source scope */
  scopeLabel?: string;
}

export interface SourceBlockLayout {
  /** Mapping ID this source block belongs to */
  mappingId: string;
  /** Schemas involved in the source block */
  schemas: string[];
  /** Join description text, if any */
  joinDescription: string | null;
  /** Filter expressions */
  filters: string[];
}

export interface LayoutResult {
  nodes: Map<string, LayoutNode>;
  edges: LayoutEdge[];
  sourceBlocks: SourceBlockLayout[];
  width: number;
  height: number;
}

/** Edge in the overview layout: one per MappingBlock, linking sourceRefs to targetRef. */
export interface OverviewEdge {
  id: string;
  sourceNode: string;
  targetNode: string;
  /** Array of {x,y} points forming the routed edge path */
  points: Array<{ x: number; y: number }>;
  /** The full MappingBlock this edge represents. */
  mapping: MappingBlock;
}

export interface OverviewLayoutResult {
  nodes: LayoutNode[];
  edges: OverviewEdge[];
  width: number;
  height: number;
}

// Card dimension constants (px) — must match CSS in sz-schema-card.ts
const HEADER_HEIGHT = 40;
const LABEL_HEIGHT = 24;  // .label padding (4+6) + font ~14px
const METADATA_PILLS_HEIGHT = 28; // .metadata-pills padding (4+6) + pill line ~17px + border 1px
const FIELD_HEIGHT = 28;
const FIELDS_PADDING_TOP = 4; // .fields { padding: 4px 0; }
const FIELDS_PADDING_BOTTOM = 4;
const CARD_MIN_WIDTH = 240;
const CARD_MAX_WIDTH = 380;
const PORT_Y_OFFSET = FIELD_HEIGHT / 2; // center of field row
const OVERVIEW_HEADER_BASE_WIDTH = 72; // icon + gaps + padding
const OVERVIEW_TITLE_CHAR_WIDTH = 8.2;
const OVERVIEW_COUNT_CHAR_WIDTH = 6.3;
const OVERVIEW_PILL_CHAR_WIDTH = 6.1;
const OVERVIEW_LABEL_CHAR_WIDTH = 6.8;
const OVERVIEW_LABEL_PADDING = 76; // left 12 + right 40 + icon 16 + gap 8
const OVERVIEW_LABEL_MAX_WIDTH = 420;
const OVERVIEW_NAMESPACE_PILL_PADDING = 30; // left 12 + right padding + pill internal padding
const FULL_TITLE_CHAR_WIDTH = 8.1;
const FULL_META_CHAR_WIDTH = 6.3;
const FULL_FIELD_CHAR_WIDTH = 7.2;
const FULL_TYPE_CHAR_WIDTH = 6.6;
const FULL_NOTE_CHAR_WIDTH = 6.5;
const FULL_HEADER_BASE_WIDTH = 86;
const FULL_FIELD_BASE_WIDTH = 92;
const FULL_NOTES_TOGGLE_HEIGHT = 28;
const FULL_NOTES_SECTION_CHROME = 14;
const FULL_NOTE_LINE_HEIGHT = 18;
const FULL_SPREAD_HEIGHT = 24;
const FULL_META_ROW_HEIGHT = 20;
const FULL_META_BASE_HEIGHT = 12;
const NAMESPACE_PILL_HEIGHT = 24;

/** Height of the area above the fields list (header + optional label + optional metadata pills). */
function preambleHeight(
  schema: { label: string | null; metadata: Array<{ key: string; value: string }> },
  hasNamespace = false,
): number {
  let h = HEADER_HEIGHT + (hasNamespace ? NAMESPACE_PILL_HEIGHT : 0);
  if (schema.label) h += LABEL_HEIGHT;
  const pills = schema.metadata.filter((m) => m.key !== "note");
  if (pills.length > 0) h += METADATA_PILLS_HEIGHT;
  return h;
}

/** Compact card height: header + optional label + optional pills + small padding. */
function compactHeight(
  schema: { label: string | null; metadata: Array<{ key: string; value: string }> },
  hasNamespace = false,
): number {
  return preambleHeight(schema, hasNamespace) + FIELDS_PADDING_BOTTOM;
}

/**
 * Compact card height once the user has expanded its field list in the
 * overview (sz-schema-card's compact-expanded state): the preamble plus every
 * field row, nested fields included. Field-level note lines are not estimated;
 * the card keeps `overflow: visible` while expanded so a small undershoot
 * paints past the node bounds instead of clipping.
 */
function compactExpandedHeight(schema: SchemaCard, hasNamespace = false): number {
  return (
    preambleHeight(schema, hasNamespace) +
    FIELDS_PADDING_TOP +
    countFields(schema.fields) * FIELD_HEIGHT +
    FIELDS_PADDING_BOTTOM
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function estimateTextWidth(text: string, charWidth: number): number {
  return text.length * charWidth;
}

function estimateOverviewLabelWidth(mappingId: string, namespaceName?: string | null): number {
  const labelWidth = Math.ceil(estimateTextWidth(mappingId, OVERVIEW_LABEL_CHAR_WIDTH) + OVERVIEW_LABEL_PADDING);
  // Namespace pill sits in its own row; take the wider of the two
  const pillWidth = namespaceName
    ? Math.ceil(estimateTextWidth(namespaceName, OVERVIEW_PILL_CHAR_WIDTH) + OVERVIEW_NAMESPACE_PILL_PADDING)
    : 0;
  return clamp(
    Math.max(labelWidth, pillWidth),
    CARD_MIN_WIDTH,
    OVERVIEW_LABEL_MAX_WIDTH,
  );
}

function overviewMappingNodeId(namespaceName: string | null, mappingId: string): string {
  return `mapping:${namespaceName ?? "_"}:${mappingId}`;
}

function estimateCompactSchemaWidth(schema: SchemaCard): number {
  const displayName = schema.id;
  const countText = `${countFields(schema.fields)} fields`;
  const headerWidth =
    OVERVIEW_HEADER_BASE_WIDTH +
    estimateTextWidth(displayName, OVERVIEW_TITLE_CHAR_WIDTH) +
    estimateTextWidth(countText, OVERVIEW_COUNT_CHAR_WIDTH);

  const pillWidths = schema.metadata
    .filter((m) => m.key !== "note")
    .map((m) => estimateTextWidth(`${m.key} ${m.value}`, OVERVIEW_PILL_CHAR_WIDTH) + 44);
  const contentWidth = pillWidths.length > 0 ? Math.max(headerWidth, ...pillWidths) : headerWidth;

  return clamp(Math.ceil(contentWidth), CARD_MIN_WIDTH, CARD_MAX_WIDTH);
}

function estimateCompactTextCardWidth(id: string): number {
  const headerWidth = OVERVIEW_HEADER_BASE_WIDTH + estimateTextWidth(id, OVERVIEW_TITLE_CHAR_WIDTH);
  return clamp(Math.ceil(headerWidth), CARD_MIN_WIDTH, CARD_MAX_WIDTH);
}

/**
 * Compact card width when its field list is expanded: the wider of the compact
 * header and the widest field row, so long field names don't spill out of the
 * laid-out node sideways.
 */
function compactExpandedWidth(schema: SchemaCard): number {
  return clamp(
    Math.max(estimateCompactSchemaWidth(schema), Math.ceil(measureFieldWidth(schema.fields))),
    CARD_MIN_WIDTH,
    CARD_MAX_WIDTH,
  );
}

function estimateLines(text: string, charsPerLine: number): number {
  const segments = text
    .split("\n")
    .map((line) => Math.max(1, Math.ceil(line.trim().length / charsPerLine)));
  return Math.max(1, segments.reduce((sum, lines) => sum + lines, 0));
}

function estimateNoteBlockHeight(text: string, expanded: boolean): number {
  const base = FULL_NOTES_TOGGLE_HEIGHT + FULL_NOTES_SECTION_CHROME;
  if (!expanded) return base;
  return base + estimateLines(text, 34) * FULL_NOTE_LINE_HEIGHT;
}

function estimateSchemaWidth(schema: SchemaCard): number {
  const spreads = schema.spreads ?? [];
  const notes = schema.notes ?? [];
  const titleWidth =
    FULL_HEADER_BASE_WIDTH +
    estimateTextWidth(schema.id, FULL_TITLE_CHAR_WIDTH) +
    estimateTextWidth(`${countFields(schema.fields)}/${countFields(schema.fields)}`, OVERVIEW_COUNT_CHAR_WIDTH);

  const labelWidth = schema.label
    ? estimateTextWidth(schema.label, FULL_META_CHAR_WIDTH) + 48
    : 0;

  const pillWidth = schema.metadata
    .filter((m) => m.key !== "note")
    .reduce((max, m) => Math.max(max, estimateTextWidth(`${m.key} ${m.value}`, FULL_META_CHAR_WIDTH) + 48), 0);

  const fieldWidth = measureFieldWidth(schema.fields);
  const spreadWidth = spreads.reduce(
    (max, spread) => Math.max(max, estimateTextWidth(`spreads ${spread}`, FULL_META_CHAR_WIDTH) + 48),
    0,
  );
  const noteWidth = notes.reduce(
    (max, note) => Math.max(max, estimateTextWidth(note.text.replace(/\s+/g, " ").trim(), FULL_NOTE_CHAR_WIDTH) + 56),
    0,
  );

  return clamp(
    Math.ceil(Math.max(titleWidth, labelWidth, pillWidth, fieldWidth, spreadWidth, noteWidth)),
    CARD_MIN_WIDTH,
    CARD_MAX_WIDTH,
  );
}

function estimateMetricWidth(metric: MetricCard): number {
  const notes = metric.notes ?? [];
  const titleWidth = FULL_HEADER_BASE_WIDTH + estimateTextWidth(metric.id, FULL_TITLE_CHAR_WIDTH);
  const metaTexts = [
    metric.label ? `"${metric.label}"${metric.grain ? ` · grain: ${metric.grain}` : ""}` : "",
    !metric.label && metric.grain ? `grain: ${metric.grain}` : "",
    metric.slices.length > 0 ? `slice: ${metric.slices.join(", ")}` : "",
  ].filter(Boolean);
  const metaWidth = metaTexts.reduce(
    (max, text) => Math.max(max, estimateTextWidth(text, FULL_META_CHAR_WIDTH) + 48),
    0,
  );
  const fieldWidth = metric.fields.reduce(
    (max, field) => Math.max(
      max,
      FULL_FIELD_BASE_WIDTH +
        16 +
        estimateTextWidth(field.name, FULL_FIELD_CHAR_WIDTH) +
        estimateTextWidth(field.type, FULL_TYPE_CHAR_WIDTH),
    ),
    0,
  );
  const noteWidth = notes.reduce(
    (max, note) => Math.max(max, estimateTextWidth(note.text.replace(/\s+/g, " ").trim(), FULL_NOTE_CHAR_WIDTH) + 56),
    0,
  );

  return clamp(Math.ceil(Math.max(titleWidth, metaWidth, fieldWidth, noteWidth)), CARD_MIN_WIDTH, CARD_MAX_WIDTH);
}

function estimateFragmentWidth(fragment: FragmentCard): number {
  const notes = fragment.notes ?? [];
  const titleWidth =
    FULL_HEADER_BASE_WIDTH +
    estimateTextWidth(fragment.id, FULL_TITLE_CHAR_WIDTH) +
    estimateTextWidth(`${fragment.fields.length} fields`, OVERVIEW_COUNT_CHAR_WIDTH);
  const fieldWidth = fragment.fields.reduce(
    (max, field) => Math.max(
      max,
      FULL_FIELD_BASE_WIDTH +
        estimateTextWidth(field.name, FULL_FIELD_CHAR_WIDTH) +
        estimateTextWidth(field.type, FULL_TYPE_CHAR_WIDTH),
    ),
    0,
  );
  const noteWidth = notes.reduce(
    (max, note) => Math.max(max, estimateTextWidth(note.text.replace(/\s+/g, " ").trim(), FULL_NOTE_CHAR_WIDTH) + 56),
    0,
  );

  return clamp(Math.ceil(Math.max(titleWidth, fieldWidth, noteWidth)), CARD_MIN_WIDTH, CARD_MAX_WIDTH);
}

function estimateMetricHeight(metric: MetricCard, hasNamespace = false): number {
  const notes = metric.notes ?? [];
  const metaRows =
    (metric.label ? 1 : 0) +
    (!metric.label && metric.grain ? 1 : 0) +
    (metric.slices.length > 0 ? 1 : 0);
  const metaHeight = metaRows > 0 ? FULL_META_BASE_HEIGHT + metaRows * FULL_META_ROW_HEIGHT : 0;
  const notesHeight = notes.reduce((sum, note) => sum + estimateNoteBlockHeight(note.text, false), 0);

  return (hasNamespace ? NAMESPACE_PILL_HEIGHT : 0) + HEADER_HEIGHT + metaHeight + FIELDS_PADDING_TOP + metric.fields.length * FIELD_HEIGHT + FIELDS_PADDING_BOTTOM + notesHeight;
}

function estimateFragmentHeight(fragment: FragmentCard, hasNamespace = false): number {
  const notes = fragment.notes ?? [];
  const notesHeight = notes.reduce((sum, note) => sum + estimateNoteBlockHeight(note.text, false), 0);
  return (hasNamespace ? NAMESPACE_PILL_HEIGHT : 0) + HEADER_HEIGHT + FIELDS_PADDING_TOP + fragment.fields.length * FIELD_HEIGHT + FIELDS_PADDING_BOTTOM + notesHeight;
}

function estimateSchemaHeight(schema: SchemaCard, hasNamespace = false): number {
  const notes = schema.notes ?? [];
  const spreads = schema.spreads ?? [];
  const notesHeight = notes.reduce((sum, note) => sum + estimateNoteBlockHeight(note.text, true), 0);
  const spreadsHeight = spreads.length * FULL_SPREAD_HEIGHT;
  return (
    preambleHeight(schema, hasNamespace) +
    FIELDS_PADDING_TOP +
    countFields(schema.fields) * FIELD_HEIGHT +
    FIELDS_PADDING_BOTTOM +
    spreadsHeight +
    notesHeight
  );
}

function measureFieldWidth(fields: FieldEntry[], depth = 0): number {
  return fields.reduce((max, field) => {
    const constraintText = field.constraints.filter((c) => c !== "pii").join(" ");
    const commentWidth = field.comments.length > 0 ? 32 : 0;
    const width =
      FULL_FIELD_BASE_WIDTH +
      depth * 20 +
      estimateTextWidth(field.name, FULL_FIELD_CHAR_WIDTH) +
      estimateTextWidth(field.type, FULL_TYPE_CHAR_WIDTH) +
      (constraintText ? estimateTextWidth(constraintText, FULL_META_CHAR_WIDTH) + 24 : 0) +
      (field.constraints.includes("pii") ? 44 : 0) +
      commentWidth;
    const childWidth = field.children.length > 0 ? measureFieldWidth(field.children, depth + 1) : 0;
    return Math.max(max, width, childWidth);
  }, 0);
}
const elk = new ELK();

/**
 * Compute layout for a VizModel. Returns positioned nodes and routed edges.
 */
export async function computeLayout(model: VizModel): Promise<LayoutResult> {
  // Build sets of mapped fields per schema (from arrows)
  const mappedFieldsBySchema = buildMappedFieldsIndex(model);

  const elkGraph = buildElkGraph(model, mappedFieldsBySchema);
  const result = await elk.layout(elkGraph);

  return extractLayout(result, model);
}

function buildElkGraph(
  model: VizModel,
  mappedFields: Map<string, Set<string>>,
): ElkGraph {
  // Build fragment lookup for spread expansion in schema port generation
  const fragmentsById = new Map<string, FieldEntry[]>();
  for (const ns of model.namespaces) {
    for (const f of ns.fragments) {
      fragmentsById.set(f.id, f.fields);
    }
  }

  const children: ElkNode[] = [];
  const edges: ElkEdge[] = [];

  for (const ns of model.namespaces) {
    addSchemaNodes(ns.schemas, mappedFields, children, !!ns.name, fragmentsById);
    addFragmentNodes(ns.fragments, children, !!ns.name);
    addMetricNodes(ns.metrics, mappedFields, children, !!ns.name);
  }

  // Build a set of all port IDs so we can validate edge endpoints
  allPortIds = new Set<string>();
  const collectPorts = (nodes: ElkNode[]) => {
    for (const n of nodes) {
      for (const p of n.ports) allPortIds.add(p.id);
      if (n.children.length > 0) collectPorts(n.children);
    }
  };
  collectPorts(children);

  // Add edges after ports are collected (so missing-port validation works)
  for (const ns of model.namespaces) {
    addMappingEdges(ns.mappings, edges);
  }

  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "60",
      "elk.layered.spacing.nodeNodeBetweenLayers": "100",
      "elk.spacing.edgeEdge": "15",
      "elk.spacing.edgeNode": "20",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.portConstraints": "FIXED_POS",
    },
    children,
    edges,
  };
}

function addSchemaNodes(
  schemas: SchemaCard[],
  mappedFields: Map<string, Set<string>>,
  target: ElkNode[],
  hasNamespace = false,
  fragmentsById: Map<string, FieldEntry[]> = new Map(),
) {
  for (const s of schemas) {
    const width = estimateSchemaWidth(s);
    const topOffset = preambleHeight(s, hasNamespace) + FIELDS_PADDING_TOP;
    // Expand spread fields so ports exist for arrow endpoints that reference them
    const spreadFields = (s.spreads ?? []).flatMap((name) => fragmentsById.get(name) ?? []);
    const allFields = [...s.fields, ...spreadFields];
    const ports = buildFieldPorts(allFields, s.qualifiedId, mappedFields, topOffset, width);

    target.push({
      id: s.qualifiedId,
      width,
      height: estimateSchemaHeight(s, hasNamespace),
      ports,
      children: [],
      edges: [],
    });
  }
}

function addFragmentNodes(fragments: FragmentCard[], target: ElkNode[], hasNamespace = false) {
  for (const f of fragments) {
    const width = estimateFragmentWidth(f);
    const ports = buildFieldPorts(
      f.fields,
      f.id,
      new Map(),
      (hasNamespace ? NAMESPACE_PILL_HEIGHT : 0) + HEADER_HEIGHT + FIELDS_PADDING_TOP,
      width,
    );

    target.push({
      id: f.id,
      width,
      height: estimateFragmentHeight(f, hasNamespace),
      ports,
      children: [],
      edges: [],
    });
  }
}

function addMetricNodes(
  metrics: MetricCard[],
  mappedFields: Map<string, Set<string>>,
  target: ElkNode[],
  hasNamespace = false,
) {
  for (const m of metrics) {
    const width = estimateMetricWidth(m);
    // Metric schemas are valid mapping sources and targets (e.g. metric → report or model),
    // so they need field ports just like schema nodes.
    const metaRows =
      (m.label ? 1 : 0) + (!m.label && m.grain ? 1 : 0) + (m.slices.length > 0 ? 1 : 0);
    const metaHeight = metaRows > 0 ? FULL_META_BASE_HEIGHT + metaRows * FULL_META_ROW_HEIGHT : 0;
    const topOffset =
      (hasNamespace ? NAMESPACE_PILL_HEIGHT : 0) + HEADER_HEIGHT + metaHeight + FIELDS_PADDING_TOP;
    // MetricFieldEntry is a leaner type than FieldEntry (no constraints/comments/children).
    // Adapt it so buildFieldPorts can generate ports for metric fields.
    const fieldEntries: FieldEntry[] = m.fields.map((f) => ({
      name: f.name,
      type: f.type,
      constraints: [],
      notes: f.notes,
      comments: [],
      children: [],
      location: f.location,
    }));
    const ports = buildFieldPorts(fieldEntries, m.qualifiedId, mappedFields, topOffset, width);

    target.push({
      id: m.qualifiedId,
      width,
      height: estimateMetricHeight(m, hasNamespace),
      ports,
      children: [],
      edges: [],
    });
  }
}

function buildFieldPorts(
  fields: FieldEntry[],
  nodeId: string,
  _mappedFields: Map<string, Set<string>>,
  topOffset = HEADER_HEIGHT + FIELDS_PADDING_TOP,
  nodeWidth = CARD_MIN_WIDTH,
): ElkPort[] {
  const ports: ElkPort[] = [];
  let index = 0;

  const walk = (fieldList: FieldEntry[], depth: number) => {
    for (const f of fieldList) {
      const y = topOffset + index * FIELD_HEIGHT + PORT_Y_OFFSET;
      // Left port (source side)
      ports.push({
        id: `${nodeId}:${f.name}:src`,
        x: 0,
        y,
        width: 1,
        height: 1,
      });
      // Right port (target side)
      ports.push({
        id: `${nodeId}:${f.name}:tgt`,
        x: nodeWidth,
        y,
        width: 1,
        height: 1,
      });
      index++;
      if (f.children.length > 0) {
        walk(f.children, depth + 1);
      }
    }
  };

  walk(fields, 0);
  return ports;
}

function countFields(fields: FieldEntry[]): number {
  let count = 0;
  for (const f of fields) {
    count++;
    count += countFields(f.children);
  }
  return count;
}

interface EdgeMeta {
  sourceNode: string;
  targetNode: string;
  sourceField: string;
  targetField: string;
  arrow: ArrowEntry;
}

/** Mapping from edge ID to arrow metadata — used by extractLayout to populate LayoutEdge fields. */
const edgeMetaMap = new Map<string, EdgeMeta>();

/** Set of all port IDs added to the graph, used to validate edge endpoints. */
let allPortIds = new Set<string>();

function addMappingEdges(mappings: MappingBlock[], edges: ElkEdge[]) {
  edgeMetaMap.clear();

  for (const m of mappings) {
    const addArrowEdges = (arrows: ArrowEntry[], prefix: string) => {
      for (let i = 0; i < arrows.length; i++) {
        const a = arrows[i];
        // Use first source ref as source node (multi-source joins render from first)
        const sourceNode = m.sourceRefs[0];
        if (!sourceNode) continue;
        const sourceField = a.sourceFields[0] ?? a.targetField;
        const edgeId = `${prefix}:${i}`;

        const srcPort = `${sourceNode}:${sourceField}:src`;
        const tgtPort = `${m.targetRef}:${a.targetField}:tgt`;

        // Skip edges with missing ports — ELK throws if a port doesn't exist
        if (!allPortIds.has(srcPort) || !allPortIds.has(tgtPort)) continue;

        edges.push({
          id: edgeId,
          sources: [srcPort],
          targets: [tgtPort],
        });

        edgeMetaMap.set(edgeId, {
          sourceNode,
          targetNode: m.targetRef,
          sourceField,
          targetField: a.targetField,
          arrow: a,
        });
      }
    };

    addArrowEdges(m.arrows, `${m.id}:arrow`);

    for (let j = 0; j < m.eachBlocks.length; j++) {
      const collectEachEdges = (eb: EachBlock, ePrefix: string) => {
        addArrowEdges(eb.arrows, `${ePrefix}:each`);
        for (let k = 0; k < eb.nestedEach.length; k++) {
          collectEachEdges(eb.nestedEach[k], `${ePrefix}:nested:${k}`);
        }
      };
      collectEachEdges(m.eachBlocks[j], `${m.id}:eb:${j}`);
    }

    for (let j = 0; j < m.flattenBlocks.length; j++) {
      addArrowEdges(m.flattenBlocks[j].arrows, `${m.id}:flat:${j}`);
    }
  }
}

function extractLayout(
  result: ElkLayoutResult,
  _model: VizModel,
): LayoutResult {
  const nodes = new Map<string, LayoutNode>();
  const edges: LayoutEdge[] = [];

  const walkNodes = (elkNodes: ElkLayoutNode[], offsetX = 0, offsetY = 0) => {
    for (const n of elkNodes) {
      const x = (n.x ?? 0) + offsetX;
      const y = (n.y ?? 0) + offsetY;

      const ports = new Map<string, { x: number; y: number }>();
      for (const p of n.ports ?? []) {
        // Port id format: nodeId:fieldName:src|tgt
        const parts = p.id.split(":");
        const fieldName = parts.slice(1, -1).join(":");
        ports.set(`${fieldName}:${parts[parts.length - 1]}`, {
          x: x + (p.x ?? 0),
          y: y + (p.y ?? 0),
        });
      }

      nodes.set(n.id, {
        id: n.id,
        x,
        y,
        width: n.width ?? CARD_MIN_WIDTH,
        height: n.height ?? 100,
        ports,
      });

      if (n.children && n.children.length > 0) {
        walkNodes(n.children, x, y);
      }
    }
  };

  walkNodes(result.children ?? []);

  // Extract edge routes
  for (const e of result.edges ?? []) {
    const points: Array<{ x: number; y: number }> = [];

    for (const section of e.sections ?? []) {
      if (section.startPoint) points.push(section.startPoint);
      if (section.bendPoints) points.push(...section.bendPoints);
      if (section.endPoint) points.push(section.endPoint);
    }

    const meta = edgeMetaMap.get(e.id);
    edges.push({
      id: e.id,
      sourceNode: meta?.sourceNode ?? "",
      targetNode: meta?.targetNode ?? "",
      sourceField: meta?.sourceField ?? "",
      targetField: meta?.targetField ?? "",
      points,
      arrow: meta?.arrow ?? {
        sourceFields: [],
        targetField: "",
        transform: null,
        metadata: [],
        comments: [],
        location: { uri: "", line: 0, character: 0 },
      },
    });
  }

  // Collect source blocks from the model
  const sourceBlocks: SourceBlockLayout[] = [];
  for (const ns of _model.namespaces) {
    for (const m of ns.mappings) {
      if (m.sourceBlock) {
        sourceBlocks.push({
          mappingId: m.id,
          schemas: m.sourceBlock.schemas,
          joinDescription: m.sourceBlock.joinDescription,
          filters: m.sourceBlock.filters,
        });
      }
    }
  }

  // Tag edges with scope labels from each/flatten context
  for (const e of edges) {
    if (e.id.includes(":each")) {
      e.scopeLabel = "each";
    } else if (e.id.includes(":flat:")) {
      e.scopeLabel = "flatten";
    }
  }

  return {
    nodes,
    edges,
    sourceBlocks,
    width: result.width ?? 800,
    height: result.height ?? 600,
  };
}

/** Options for computeOverviewLayout. */
export interface OverviewLayoutOptions {
  /**
   * qualifiedIds of schemas whose compact cards the user has expanded to show
   * their field lists. Expanded cards are sized at their full field-list
   * dimensions in the layout, so neighbouring nodes move aside and edges
   * re-route around the new geometry instead of the card painting over them.
   */
  expandedSchemaIds?: ReadonlySet<string>;
}

/**
 * Compute a schema-level overview layout (no field ports).
 * Creates compact nodes and one edge per MappingBlock.
 */
export async function computeOverviewLayout(
  model: VizModel,
  options?: OverviewLayoutOptions,
): Promise<OverviewLayoutResult> {
  const children: ElkNode[] = [];
  const edges: ElkEdge[] = [];
  const overviewNodeKinds = new Map<string, LayoutNode["kind"]>();
  const overviewNodeHasNamespace = new Set<string>();
  const overviewEdgeMeta = new Map<string, {
    sourceNode: string;
    targetNode: string;
    mapping: MappingBlock;
  }>();
  const nodeIds = new Set<string>();

  // Pass 1: build all nodes and populate nodeIds before creating any edges.
  // Edges reference nodes across namespaces, so all nodeIds must be known first.
  for (const ns of model.namespaces) {
    const nsNodes: ElkNode[] = [];

    for (const s of ns.schemas) {
      nodeIds.add(s.qualifiedId);
      overviewNodeKinds.set(s.qualifiedId, "schema");
      if (ns.name) overviewNodeHasNamespace.add(s.qualifiedId);
      const expanded = options?.expandedSchemaIds?.has(s.qualifiedId) ?? false;
      nsNodes.push({
        id: s.qualifiedId,
        width: expanded ? compactExpandedWidth(s) : estimateCompactSchemaWidth(s),
        height: expanded ? compactExpandedHeight(s, !!ns.name) : compactHeight(s, !!ns.name),
        layoutOptions: {
          "elk.layered.layerConstraint": "NONE",
        },
        ports: [],
        children: [],
        edges: [],
      });
    }

    for (const f of ns.fragments) {
      nodeIds.add(f.id);
      overviewNodeKinds.set(f.id, "fragment");
      if (ns.name) overviewNodeHasNamespace.add(f.id);
      nsNodes.push({
        id: f.id,
        width: estimateCompactTextCardWidth(f.id),
        height: (ns.name ? NAMESPACE_PILL_HEIGHT : 0) + HEADER_HEIGHT + FIELDS_PADDING_BOTTOM,
        layoutOptions: {
          "elk.layered.layerConstraint": "NONE",
        },
        ports: [],
        children: [],
        edges: [],
      });
    }

    for (const m of ns.metrics) {
      nodeIds.add(m.qualifiedId);
      overviewNodeKinds.set(m.qualifiedId, "metric");
      if (ns.name) overviewNodeHasNamespace.add(m.qualifiedId);
      nsNodes.push({
        id: m.qualifiedId,
        width: estimateCompactTextCardWidth(m.id),
        height: (ns.name ? NAMESPACE_PILL_HEIGHT : 0) + HEADER_HEIGHT + FIELDS_PADDING_BOTTOM,
        layoutOptions: {
          "elk.layered.layerConstraint": "NONE",
        },
        ports: [],
        children: [],
        edges: [],
      });
    }

    for (const m of ns.mappings) {
      const mappingNodeId = overviewMappingNodeId(ns.name, m.id);
      nodeIds.add(mappingNodeId);
      overviewNodeKinds.set(mappingNodeId, "mapping");
      overviewNodeHasNamespace.add(mappingNodeId);
      nsNodes.push({
        id: mappingNodeId,
        width: estimateOverviewLabelWidth(m.id, ns.name),
        height: NAMESPACE_PILL_HEIGHT + HEADER_HEIGHT + FIELDS_PADDING_BOTTOM,
        layoutOptions: {
          "elk.layered.layerConstraint": "NONE",
        },
        ports: [],
        children: [],
        edges: [],
      });
    }

    children.push(...nsNodes);
  }

  // Pass 2: create edges now that all nodeIds are populated.
  for (const ns of model.namespaces) {
    for (const m of ns.mappings) {
      const mappingNodeId = overviewMappingNodeId(ns.name, m.id);
      for (const sourceRef of m.sourceRefs) {
        if (!nodeIds.has(sourceRef)) continue;
        const edgeId = `overview:${mappingNodeId}:in:${sourceRef}`;
        edges.push({
          id: edgeId,
          sources: [sourceRef],
          targets: [mappingNodeId],
        });
        overviewEdgeMeta.set(edgeId, {
          sourceNode: sourceRef,
          targetNode: mappingNodeId,
          mapping: m,
        });
      }

      if (!nodeIds.has(m.targetRef)) continue;
      const targetEdgeId = `overview:${mappingNodeId}:out:${m.targetRef}`;
      edges.push({
        id: targetEdgeId,
        sources: [mappingNodeId],
        targets: [m.targetRef],
      });
      overviewEdgeMeta.set(targetEdgeId, {
        sourceNode: mappingNodeId,
        targetNode: m.targetRef,
        mapping: m,
      });
    }
  }

  const elkGraph: ElkGraph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "96",
      "elk.spacing.edgeEdge": "20",
      "elk.spacing.edgeNode": "20",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
    children,
    edges,
  };

  const result = await elk.layout(elkGraph) as unknown as ElkLayoutResult;

  // Extract positioned nodes
  const nodes: LayoutNode[] = [];
  const walkOverviewNodes = (elkNodes: ElkLayoutNode[], offsetX = 0, offsetY = 0) => {
    for (const n of elkNodes) {
      const x = (n.x ?? 0) + offsetX;
      const y = (n.y ?? 0) + offsetY;

      nodes.push({
        id: n.id,
        x,
        y,
        width: n.width ?? CARD_MIN_WIDTH,
        height: n.height ?? (HEADER_HEIGHT + FIELDS_PADDING_BOTTOM),
        kind: overviewNodeKinds.get(n.id)
          ?? (n.id.startsWith("mapping:")
            ? "mapping"
            : nodeIds.has(n.id)
              ? "schema"
              : undefined),
        hasNamespace: overviewNodeHasNamespace.has(n.id),
        ports: new Map(),
      });

      if (n.children && n.children.length > 0) {
        walkOverviewNodes(n.children, x, y);
      }
    }
  };
  walkOverviewNodes(result.children ?? []);

  // Extract edge routes
  const overviewEdges: OverviewEdge[] = [];
  for (const e of (result as ElkLayoutResult).edges ?? []) {
    const points: Array<{ x: number; y: number }> = [];
    for (const section of e.sections ?? []) {
      if (section.startPoint) points.push(section.startPoint);
      if (section.bendPoints) points.push(...section.bendPoints);
      if (section.endPoint) points.push(section.endPoint);
    }

    const meta = overviewEdgeMeta.get(e.id);
    if (meta) {
      const sourceNode = nodes.find((node) => node.id === meta.sourceNode);
      const targetNode = nodes.find((node) => node.id === meta.targetNode);
      if (sourceNode && targetNode) {
        // Replace ELK's routing with clean horizontal-exit / horizontal-enter paths
        const src = overviewVisualAnchor(sourceNode, "source");
        const tgt = overviewVisualAnchor(targetNode, "target");
        const midX = (src.x + tgt.x) / 2;
        const cleanPoints = [
          src,
          { x: midX, y: src.y },
          { x: midX, y: tgt.y },
          tgt,
        ];
        overviewEdges.push({
          id: e.id,
          sourceNode: meta.sourceNode,
          targetNode: meta.targetNode,
          points: cleanPoints,
          mapping: meta.mapping,
        });
      } else {
        // Fallback: use ELK points as-is
        overviewEdges.push({
          id: e.id,
          sourceNode: meta.sourceNode,
          targetNode: meta.targetNode,
          points,
          mapping: meta.mapping,
        });
      }
    }
  }

  return {
    nodes,
    edges: overviewEdges,
    width: result.width ?? 800,
    height: result.height ?? 600,
  };
}

function overviewVisualAnchor(node: LayoutNode, side: "source" | "target"): { x: number; y: number } {
  const x = side === "source" ? node.x + node.width : node.x;
  const namespaceOffset = node.hasNamespace ? NAMESPACE_PILL_HEIGHT : 0;

  if (node.kind === "mapping") {
    // Center on the visual card area below the namespace pill
    return { x, y: node.y + namespaceOffset + (node.height - namespaceOffset) / 2 };
  }

  return { x, y: node.y + namespaceOffset + HEADER_HEIGHT / 2 };
}

// ---- ELK type stubs (minimal) ----

interface ElkGraph {
  id: string;
  layoutOptions: Record<string, string>;
  children: ElkNode[];
  edges: ElkEdge[];
}

interface ElkNode {
  id: string;
  width?: number;
  height?: number;
  layoutOptions?: Record<string, string>;
  ports: ElkPort[];
  children: ElkNode[];
  edges: ElkEdge[];
}

interface ElkPort {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
}

interface ElkLayoutResult {
  width?: number;
  height?: number;
  children?: ElkLayoutNode[];
  edges?: ElkLayoutEdge[];
}

interface ElkLayoutNode {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  ports?: Array<{ id: string; x?: number; y?: number }>;
  children?: ElkLayoutNode[];
}

interface ElkLayoutEdge {
  id: string;
  sections?: Array<{
    startPoint?: { x: number; y: number };
    endPoint?: { x: number; y: number };
    bendPoints?: Array<{ x: number; y: number }>;
  }>;
}
